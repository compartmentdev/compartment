package caddytrafficmetering

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

const (
	trafficMetricsPath = "/internal/edge/traffic-metrics"
	upstreamHostHeader = "X-Compartment-Upstream-Host"
	defaultQueueLimit  = 60
	maxMetricsPerBatch = 10_000
	requestTimeout     = 10 * time.Second
)

func init() {
	caddy.RegisterModule(new(Handler))
	httpcaddyfile.RegisterHandlerDirective("compartment_traffic_meter", parseCaddyfile)
}

// Handler meters authorized hosted application traffic and flushes bounded batches to the API.
type Handler struct {
	APIURL            string         `json:"api_url,omitempty"`
	EdgeToken         string         `json:"edge_token,omitempty"`
	FlushInterval     caddy.Duration `json:"flush_interval,omitempty"`
	MaxPendingBatches int            `json:"max_pending_batches,omitempty"`

	counters sync.Map
	queueMu  sync.Mutex
	pending  []trafficBatch
	sourceID string
	sequence atomic.Uint64
	client   *http.Client
	cancel   context.CancelFunc
	flushCtx context.Context
	logger   *zap.Logger
	stop     chan struct{}
	done     chan struct{}
}

type metricKey struct {
	hourUnix     int64
	upstreamHost string
}

type metricCounters struct {
	closed         atomic.Bool
	references     atomic.Int64
	requestBytes   atomic.Uint64
	responseBytes  atomic.Uint64
	requestCount   atomic.Uint64
	status4xxCount atomic.Uint64
	status5xxCount atomic.Uint64
}

type trafficMetric struct {
	UpstreamHost   string `json:"upstreamHost"`
	ObservedAt     string `json:"observedAt"`
	RequestBytes   uint64 `json:"requestBytes"`
	RequestCount   uint64 `json:"requestCount"`
	ResponseBytes  uint64 `json:"responseBytes"`
	Status4xxCount uint64 `json:"status4xxCount"`
	Status5xxCount uint64 `json:"status5xxCount"`
}

type trafficBatch struct {
	BatchID  string          `json:"batchId"`
	Metrics  []trafficMetric `json:"metrics"`
	SourceID string          `json:"sourceId"`
}

type countingReadCloser struct {
	io.ReadCloser
	bytesRead uint64
}

func (r *countingReadCloser) Read(buffer []byte) (int, error) {
	count, err := r.ReadCloser.Read(buffer)
	r.bytesRead += uint64(count)
	return count, err
}

type meteringResponseWriter struct {
	http.ResponseWriter
	hijackedRequestBytes atomic.Uint64
	bytesWritten         atomic.Uint64
	status               int
}

type meteringConn struct {
	net.Conn
	requestBytes  *atomic.Uint64
	responseBytes *atomic.Uint64
}

func (w *meteringResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *meteringResponseWriter) WriteHeader(status int) {
	if w.status != 0 && w.status >= http.StatusOK {
		return
	}
	if status >= http.StatusOK {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *meteringResponseWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	count, err := w.ResponseWriter.Write(body)
	w.bytesWritten.Add(uint64(count))
	return count, err
}

func (w *meteringResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, supported := w.ResponseWriter.(http.Hijacker)
	if !supported {
		return nil, nil, fmt.Errorf("response writer does not support hijacking")
	}
	connection, readWriter, err := hijacker.Hijack()
	if err != nil {
		return nil, nil, err
	}
	bufferedRequest := make([]byte, readWriter.Reader.Buffered())
	if _, err = io.ReadFull(readWriter.Reader, bufferedRequest); err != nil {
		_ = connection.Close()
		return nil, nil, err
	}
	if err = readWriter.Writer.Flush(); err != nil {
		_ = connection.Close()
		return nil, nil, err
	}
	w.hijackedRequestBytes.Add(uint64(len(bufferedRequest)))
	meteredConnection := &meteringConn{
		Conn:          connection,
		requestBytes:  &w.hijackedRequestBytes,
		responseBytes: &w.bytesWritten,
	}
	meteredReader := bufio.NewReader(io.MultiReader(bytes.NewReader(bufferedRequest), meteredConnection))
	meteredWriter := bufio.NewWriter(meteredConnection)
	return meteredConnection, bufio.NewReadWriter(meteredReader, meteredWriter), nil
}

func (c *meteringConn) Read(buffer []byte) (int, error) {
	count, err := c.Conn.Read(buffer)
	c.requestBytes.Add(uint64(count))
	return count, err
}

func (c *meteringConn) Write(buffer []byte) (int, error) {
	count, err := c.Conn.Write(buffer)
	c.responseBytes.Add(uint64(count))
	return count, err
}

// CaddyModule returns the Caddy module information.
func (*Handler) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.compartment_traffic_meter",
		New: func() caddy.Module { return new(Handler) },
	}
}

// Provision initializes the process-local accumulator and flush loop.
func (h *Handler) Provision(ctx caddy.Context) error {
	if h.MaxPendingBatches == 0 {
		h.MaxPendingBatches = defaultQueueLimit
	}
	if err := h.Validate(); err != nil {
		return err
	}
	sourceID, err := newSourceID()
	if err != nil {
		return fmt.Errorf("create traffic metering source id: %w", err)
	}
	h.sourceID = sourceID
	h.client = &http.Client{Timeout: requestTimeout}
	h.flushCtx, h.cancel = context.WithCancel(context.Background())
	h.logger = ctx.Logger()
	h.stop = make(chan struct{})
	h.done = make(chan struct{})
	h.pending = make([]trafficBatch, 0, h.MaxPendingBatches)
	go h.runFlushLoop()
	return nil
}

// Validate rejects missing transport configuration and invalid bounds.
func (h *Handler) Validate() error {
	if !strings.HasPrefix(h.APIURL, "http://") && !strings.HasPrefix(h.APIURL, "https://") {
		return fmt.Errorf("api_url must be an absolute HTTP URL")
	}
	if h.EdgeToken == "" {
		return fmt.Errorf("edge_token is required")
	}
	if time.Duration(h.FlushInterval) <= 0 {
		return fmt.Errorf("flush_interval must be positive")
	}
	if h.MaxPendingBatches <= 0 {
		return fmt.Errorf("max_pending_batches must be positive")
	}
	return nil
}

// Cleanup stops the periodic flush loop.
func (h *Handler) Cleanup() error {
	if h.stop == nil {
		return nil
	}
	if h.cancel != nil {
		h.cancel()
	}
	close(h.stop)
	<-h.done
	return nil
}

// ServeHTTP records one authorized hosted application request.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	upstreamHost := r.Header.Get(upstreamHostHeader)
	if upstreamHost == "" {
		return next.ServeHTTP(w, r)
	}

	requestBytes := requestHeaderBytes(r)
	var bodyCounter *countingReadCloser
	if r.Body != nil && r.Body != http.NoBody {
		bodyCounter = &countingReadCloser{ReadCloser: r.Body}
		r.Body = bodyCounter
	}
	responseCounter := &meteringResponseWriter{ResponseWriter: w}
	err := next.ServeHTTP(responseCounter, r)
	if bodyCounter != nil {
		requestBytes += bodyCounter.bytesRead
	}
	requestBytes += responseCounter.hijackedRequestBytes.Load()
	status := responseCounter.status
	if status == 0 {
		if err == nil {
			status = http.StatusOK
		} else {
			status = http.StatusInternalServerError
		}
	}
	h.record(upstreamHost, time.Now().UTC(), requestBytes, responseCounter.bytesWritten.Load(), status)
	return err
}

func (h *Handler) record(
	upstreamHost string,
	observedAt time.Time,
	requestBytes uint64,
	responseBytes uint64,
	status int,
) {
	key := metricKey{hourUnix: observedAt.Truncate(time.Hour).Unix(), upstreamHost: upstreamHost}
	for {
		value, found := h.counters.Load(key)
		if !found {
			value, _ = h.counters.LoadOrStore(key, new(metricCounters))
		}
		counters := value.(*metricCounters)
		counters.references.Add(1)
		if counters.closed.Load() {
			counters.references.Add(-1)
			runtime.Gosched()
			continue
		}
		counters.requestBytes.Add(requestBytes)
		counters.responseBytes.Add(responseBytes)
		counters.requestCount.Add(1)
		if status >= 400 && status <= 499 {
			counters.status4xxCount.Add(1)
		}
		if status >= 500 && status <= 599 {
			counters.status5xxCount.Add(1)
		}
		counters.references.Add(-1)
		return
	}
}

func requestHeaderBytes(request *http.Request) uint64 {
	var total uint64 = 2
	for name, values := range request.Header {
		if len(name) >= len("X-Compartment-") && strings.EqualFold(name[:len("X-Compartment-")], "X-Compartment-") {
			continue
		}
		for _, value := range values {
			total += uint64(len(name) + 2 + len(value) + 2)
		}
	}
	if request.Host != "" {
		total += uint64(len("Host") + 2 + len(request.Host) + 2)
	}
	if request.ContentLength > 0 && request.Header.Get("Content-Length") == "" {
		total += uint64(len("Content-Length") + 2 + len(strconv.FormatInt(request.ContentLength, 10)) + 2)
	}
	if len(request.TransferEncoding) > 0 && request.Header.Get("Transfer-Encoding") == "" {
		for _, value := range request.TransferEncoding {
			total += uint64(len("Transfer-Encoding") + 2 + len(value) + 2)
		}
	}
	return total
}

func (h *Handler) runFlushLoop() {
	defer close(h.done)
	ticker := time.NewTicker(time.Duration(h.FlushInterval))
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err := h.flushOnce(h.flushCtx); err != nil && h.logger != nil && !errors.Is(err, context.Canceled) {
				h.logger.Warn("traffic metering flush failed", zap.Error(err))
			}
		case <-h.stop:
			return
		}
	}
}

func (h *Handler) flushOnce(ctx context.Context) error {
	h.enqueueCurrentMetrics()
	for {
		batch, found := h.peekPending()
		if !found {
			return nil
		}
		if err := h.publishBatch(ctx, batch); err != nil {
			return err
		}
		h.acknowledge(batch.BatchID)
	}
}

func (h *Handler) enqueueCurrentMetrics() {
	metrics := make([]trafficMetric, 0)
	currentHourUnix := time.Now().UTC().Truncate(time.Hour).Unix()
	h.counters.Range(func(keyValue any, countersValue any) bool {
		key := keyValue.(metricKey)
		counters := countersValue.(*metricCounters)
		if !counters.closed.CompareAndSwap(false, true) {
			return true
		}
		if key.hourUnix < currentHourUnix {
			h.counters.CompareAndDelete(key, counters)
		} else {
			h.counters.CompareAndSwap(key, counters, new(metricCounters))
		}
		for counters.references.Load() != 0 {
			runtime.Gosched()
		}
		metric, found := sealMetric(key, counters)
		if found {
			metrics = append(metrics, metric)
		}
		return true
	})
	if len(metrics) == 0 {
		return
	}
	for start := 0; start < len(metrics); start += maxMetricsPerBatch {
		end := min(start+maxMetricsPerBatch, len(metrics))
		h.enqueueBatch(metrics[start:end])
	}
}

func sealMetric(key metricKey, counters *metricCounters) (trafficMetric, bool) {
	metric := trafficMetric{
		UpstreamHost:   key.upstreamHost,
		ObservedAt:     time.Unix(key.hourUnix, 0).UTC().Format(time.RFC3339),
		RequestBytes:   counters.requestBytes.Swap(0),
		RequestCount:   counters.requestCount.Swap(0),
		ResponseBytes:  counters.responseBytes.Swap(0),
		Status4xxCount: counters.status4xxCount.Swap(0),
		Status5xxCount: counters.status5xxCount.Swap(0),
	}
	return metric, metric.RequestCount != 0
}

func (h *Handler) enqueueBatch(metrics []trafficMetric) {
	sequence := h.sequence.Add(1)
	batch := trafficBatch{
		BatchID:  h.sourceID + ":" + strconv.FormatUint(sequence, 10),
		Metrics:  metrics,
		SourceID: h.sourceID,
	}
	h.queueMu.Lock()
	defer h.queueMu.Unlock()
	if len(h.pending) == h.MaxPendingBatches {
		copy(h.pending, h.pending[1:])
		h.pending = h.pending[:len(h.pending)-1]
	}
	h.pending = append(h.pending, batch)
}

func (h *Handler) peekPending() (trafficBatch, bool) {
	h.queueMu.Lock()
	defer h.queueMu.Unlock()
	if len(h.pending) == 0 {
		return trafficBatch{}, false
	}
	return h.pending[0], true
}

func (h *Handler) acknowledge(batchID string) {
	h.queueMu.Lock()
	defer h.queueMu.Unlock()
	if len(h.pending) > 0 && h.pending[0].BatchID == batchID {
		h.pending = h.pending[1:]
	}
}

func (h *Handler) publishBatch(ctx context.Context, batch trafficBatch) error {
	body, err := json.Marshal(batch)
	if err != nil {
		return fmt.Errorf("encode traffic batch: %w", err)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		strings.TrimSuffix(h.APIURL, "/")+trafficMetricsPath,
		bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("create traffic batch request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+h.EdgeToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := h.client.Do(request)
	if err != nil {
		return fmt.Errorf("publish traffic batch: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("publish traffic batch: API returned %d", response.StatusCode)
	}
	return nil
}

func newSourceID() (string, error) {
	bytesValue := make([]byte, 16)
	if _, err := rand.Read(bytesValue); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytesValue), nil
}

func parseCaddyfile(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var handler Handler
	err := handler.UnmarshalCaddyfile(h.Dispenser)
	return &handler, err
}

// UnmarshalCaddyfile parses the compartment_traffic_meter directive.
func (h *Handler) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			option := d.Val()
			if !d.NextArg() {
				return d.ArgErr()
			}
			switch option {
			case "api_url":
				h.APIURL = d.Val()
			case "edge_token":
				h.EdgeToken = d.Val()
			case "flush_interval_ms":
				value, err := strconv.ParseUint(d.Val(), 10, 64)
				if err != nil {
					return d.Errf("flush_interval_ms must be a positive integer")
				}
				h.FlushInterval = caddy.Duration(time.Duration(value) * time.Millisecond)
			case "max_pending_batches":
				value, err := strconv.Atoi(d.Val())
				if err != nil {
					return d.Errf("max_pending_batches must be a positive integer")
				}
				h.MaxPendingBatches = value
			default:
				return d.Errf("unrecognized compartment_traffic_meter option: %s", option)
			}
		}
	}
	return nil
}

var (
	_ caddy.CleanerUpper          = (*Handler)(nil)
	_ caddy.Provisioner           = (*Handler)(nil)
	_ caddy.Validator             = (*Handler)(nil)
	_ caddyfile.Unmarshaler       = (*Handler)(nil)
	_ caddyhttp.MiddlewareHandler = (*Handler)(nil)
)
