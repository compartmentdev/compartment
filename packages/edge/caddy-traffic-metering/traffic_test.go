package caddytrafficmetering

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

func TestCountsKnownRequestAndResponseSizes(t *testing.T) {
	handler := newTestHandler()
	request := httptest.NewRequest(http.MethodPost, "http://app.example.com/invoices", strings.NewReader("hello"))
	request.Header.Set(upstreamHostHeader, "app-env-service.cpt-project.svc")
	request.Header.Set("X-Test", "abc")
	response := httptest.NewRecorder()
	next := caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		if r.Header.Get(upstreamHostHeader) == "" {
			t.Fatal("upstream routing identity was removed before reverse proxy")
		}
		if _, err := io.ReadAll(r.Body); err != nil {
			t.Fatalf("read request body: %v", err)
		}
		w.WriteHeader(http.StatusNotFound)
		_, err := w.Write([]byte("missing"))
		return err
	})

	if err := handler.ServeHTTP(response, request, next); err != nil {
		t.Fatalf("serve request: %v", err)
	}
	batch := sealSingleBatch(t, handler)
	metric := batch.Metrics[0]
	if metric.RequestBytes != 62 {
		t.Fatalf("expected 62 request bytes, got %d", metric.RequestBytes)
	}
	if metric.ResponseBytes != 7 || metric.RequestCount != 1 || metric.Status4xxCount != 1 || metric.Status5xxCount != 0 {
		t.Fatalf("unexpected metric: %+v", metric)
	}
}

func TestBodylessRequestDoesNotInventContentLengthOrWrapBody(t *testing.T) {
	handler := newTestHandler()
	request := httptest.NewRequest(http.MethodGet, "http://app.example.com/health", nil)
	request.Header.Set(upstreamHostHeader, "app-env-service.cpt-project.svc")
	next := caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		if r.Body != http.NoBody {
			t.Fatal("bodyless request was wrapped")
		}
		w.WriteHeader(http.StatusOK)
		return nil
	})

	if err := handler.ServeHTTP(httptest.NewRecorder(), request, next); err != nil {
		t.Fatalf("serve request: %v", err)
	}
	metric := sealSingleBatch(t, handler).Metrics[0]
	if metric.RequestBytes != 25 {
		t.Fatalf("expected 25 request header bytes, got %d", metric.RequestBytes)
	}
}

func TestCountsHijackedConnectionTraffic(t *testing.T) {
	handler := newTestHandler()
	request := httptest.NewRequest(http.MethodGet, "http://app.example.com/socket", nil)
	request.Header.Set(upstreamHostHeader, "app-env-service.cpt-project.svc")
	response := newHijackingResponseWriter()
	next := caddyhttp.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) error {
		connection, readWriter, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return err
		}
		defer connection.Close()
		clientDone := make(chan struct{})
		go func() {
			defer close(clientDone)
			if _, writeErr := response.client.Write([]byte("in")); writeErr != nil {
				t.Errorf("write hijacked request: %v", writeErr)
				return
			}
			output := make([]byte, 3)
			if _, readErr := io.ReadFull(response.client, output); readErr != nil {
				t.Errorf("read hijacked response: %v", readErr)
			}
		}()
		input := make([]byte, 2)
		if _, err = io.ReadFull(readWriter, input); err != nil {
			return err
		}
		if _, err = readWriter.Write([]byte("out")); err != nil {
			return err
		}
		if err = readWriter.Flush(); err != nil {
			return err
		}
		<-clientDone
		return nil
	})

	if err := handler.ServeHTTP(response, request, next); err != nil {
		t.Fatalf("serve hijacked request: %v", err)
	}
	metric := sealSingleBatch(t, handler).Metrics[0]
	if metric.RequestBytes != 27 || metric.ResponseBytes != 3 {
		t.Fatalf("unexpected hijacked traffic metric: %+v", metric)
	}
	_ = response.client.Close()
	_ = response.server.Close()
}

func TestConcurrentRecordingAndSealingIsExact(t *testing.T) {
	handler := newTestHandler()
	handler.MaxPendingBatches = 10_000
	const requestTotal = 2_000
	var waitGroup sync.WaitGroup
	var completed atomic.Int64
	waitGroup.Add(requestTotal)
	for range requestTotal {
		go func() {
			defer waitGroup.Done()
			handler.record("app-concurrent.cpt-project.svc", time.Now().UTC(), 11, 13, http.StatusInternalServerError)
			completed.Add(1)
		}()
	}
	for completed.Load() < requestTotal {
		handler.enqueueCurrentMetrics()
	}
	waitGroup.Wait()
	handler.enqueueCurrentMetrics()

	var requestBytes uint64
	var responseBytes uint64
	var requestCount uint64
	var status5xxCount uint64
	handler.queueMu.Lock()
	for _, batch := range handler.pending {
		for _, metric := range batch.Metrics {
			requestBytes += metric.RequestBytes
			responseBytes += metric.ResponseBytes
			requestCount += metric.RequestCount
			status5xxCount += metric.Status5xxCount
		}
	}
	handler.queueMu.Unlock()
	if requestCount != requestTotal ||
		requestBytes != requestTotal*11 ||
		responseBytes != requestTotal*13 ||
		status5xxCount != requestTotal {
		t.Fatalf(
			"concurrent flush totals were not exact: requests=%d requestBytes=%d responseBytes=%d status5xx=%d",
			requestCount,
			requestBytes,
			responseBytes,
			status5xxCount,
		)
	}
}

func TestDownstreamErrorCountsAsServerError(t *testing.T) {
	handler := newTestHandler()
	request := httptest.NewRequest(http.MethodGet, "http://app.example.com/error", nil)
	request.Header.Set(upstreamHostHeader, "app-env-service.cpt-project.svc")
	expectedError := context.Canceled

	err := handler.ServeHTTP(
		httptest.NewRecorder(),
		request,
		caddyhttp.HandlerFunc(func(http.ResponseWriter, *http.Request) error { return expectedError }),
	)
	if err != expectedError {
		t.Fatalf("expected downstream error, got %v", err)
	}
	metric := sealSingleBatch(t, handler).Metrics[0]
	if metric.Status5xxCount != 1 {
		t.Fatalf("expected downstream error to count as 5xx, got %+v", metric)
	}
}

func TestInformationalResponseDoesNotHideFinalStatus(t *testing.T) {
	handler := newTestHandler()
	request := httptest.NewRequest(http.MethodGet, "http://app.example.com/hints", nil)
	request.Header.Set(upstreamHostHeader, "app-env-service.cpt-project.svc")
	next := caddyhttp.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) error {
		w.WriteHeader(http.StatusEarlyHints)
		w.WriteHeader(http.StatusBadGateway)
		return nil
	})

	if err := handler.ServeHTTP(httptest.NewRecorder(), request, next); err != nil {
		t.Fatalf("serve request: %v", err)
	}
	metric := sealSingleBatch(t, handler).Metrics[0]
	if metric.Status5xxCount != 1 {
		t.Fatalf("expected final status to count as 5xx, got %+v", metric)
	}
}

func TestConcurrentRecordingIsExact(t *testing.T) {
	handler := newTestHandler()
	const requestTotal = 2_000
	var waitGroup sync.WaitGroup
	waitGroup.Add(requestTotal)
	for range requestTotal {
		go func() {
			defer waitGroup.Done()
			handler.record("app-concurrent.cpt-project.svc", time.Now().UTC(), 11, 13, http.StatusInternalServerError)
		}()
	}
	waitGroup.Wait()

	metric := sealSingleBatch(t, handler).Metrics[0]
	if metric.RequestCount != requestTotal ||
		metric.RequestBytes != requestTotal*11 ||
		metric.ResponseBytes != requestTotal*13 ||
		metric.Status5xxCount != requestTotal {
		t.Fatalf("concurrent totals were not exact: %+v", metric)
	}
}

func TestFlushLoopPublishesOnConfiguredInterval(t *testing.T) {
	published := make(chan trafficBatch, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var batch trafficBatch
		if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
			t.Errorf("decode batch: %v", err)
		}
		published <- batch
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	handler := newTestHandler()
	handler.APIURL = server.URL
	handler.FlushInterval = caddy.Duration(10 * time.Millisecond)
	handler.stop = make(chan struct{})
	handler.done = make(chan struct{})
	handler.record("app-interval.cpt-project.svc", time.Now().UTC(), 1, 2, http.StatusOK)
	go handler.runFlushLoop()
	defer func() {
		close(handler.stop)
		<-handler.done
	}()

	select {
	case batch := <-published:
		if batch.Metrics[0].RequestCount != 1 {
			t.Fatalf("unexpected batch: %+v", batch)
		}
	case <-time.After(time.Second):
		t.Fatal("flush interval did not publish")
	}
}

func TestCleanupCancelsInFlightFlush(t *testing.T) {
	requestStarted := make(chan struct{})
	releaseServer := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(requestStarted)
		select {
		case <-r.Context().Done():
		case <-releaseServer:
		}
	}))
	defer func() {
		close(releaseServer)
		server.Close()
	}()

	handler := newTestHandler()
	handler.APIURL = server.URL
	handler.FlushInterval = caddy.Duration(time.Millisecond)
	handler.stop = make(chan struct{})
	handler.done = make(chan struct{})
	handler.flushCtx, handler.cancel = context.WithCancel(context.Background())
	handler.record("app-cleanup.cpt-project.svc", time.Now().UTC(), 1, 1, http.StatusOK)
	go handler.runFlushLoop()

	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("flush request did not start")
	}
	cleanupDone := make(chan struct{})
	go func() {
		defer close(cleanupDone)
		if err := handler.Cleanup(); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	}()
	select {
	case <-cleanupDone:
	case <-time.After(time.Second):
		t.Fatal("cleanup did not cancel the in-flight flush")
	}
}

func TestBackpressureDropsOldestSealedBatch(t *testing.T) {
	handler := newTestHandler()
	handler.MaxPendingBatches = 2
	for range 3 {
		handler.record("app-queue.cpt-project.svc", time.Now().UTC(), 1, 1, http.StatusOK)
		handler.enqueueCurrentMetrics()
	}

	handler.queueMu.Lock()
	defer handler.queueMu.Unlock()
	if len(handler.pending) != 2 {
		t.Fatalf("expected bounded queue of 2, got %d", len(handler.pending))
	}
	if handler.pending[0].BatchID != "source:2" || handler.pending[1].BatchID != "source:3" {
		t.Fatalf("expected oldest batch eviction, got %+v", handler.pending)
	}
}

func TestSealingRemovesCompletedHourState(t *testing.T) {
	handler := newTestHandler()
	handler.record("app-old.cpt-project.svc", time.Now().UTC().Add(-2*time.Hour), 1, 1, http.StatusOK)
	handler.enqueueCurrentMetrics()

	stateCount := 0
	handler.counters.Range(func(_, _ any) bool {
		stateCount++
		return true
	})
	if stateCount != 0 {
		t.Fatalf("expected completed hour state cleanup, got %d states", stateCount)
	}
}

func TestLostAcknowledgementRetriesSameBatch(t *testing.T) {
	var attempts atomic.Int32
	var batchIDsMu sync.Mutex
	var batchIDs []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var batch trafficBatch
		if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
			t.Errorf("decode batch: %v", err)
		}
		batchIDsMu.Lock()
		batchIDs = append(batchIDs, batch.BatchID)
		batchIDsMu.Unlock()
		if attempts.Add(1) == 1 {
			hijacker := w.(http.Hijacker)
			connection, _, err := hijacker.Hijack()
			if err != nil {
				t.Errorf("hijack response: %v", err)
				return
			}
			_ = connection.Close()
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	handler := newTestHandler()
	handler.APIURL = server.URL
	handler.record("app-retry.cpt-project.svc", time.Now().UTC(), 1, 1, http.StatusOK)
	if err := handler.flushOnce(context.Background()); err == nil {
		t.Fatal("expected lost acknowledgement to fail")
	}
	if err := handler.flushOnce(context.Background()); err != nil {
		t.Fatalf("retry flush: %v", err)
	}

	batchIDsMu.Lock()
	defer batchIDsMu.Unlock()
	if len(batchIDs) != 2 || batchIDs[0] != batchIDs[1] {
		t.Fatalf("expected identical retried batch IDs, got %v", batchIDs)
	}
	if _, found := handler.peekPending(); found {
		t.Fatal("expected acknowledged retry to leave no pending batch")
	}
}

func TestRequestsOutsideAuthorizedApplicationRouteAreNotCounted(t *testing.T) {
	handler := newTestHandler()
	next := caddyhttp.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) error {
		w.WriteHeader(http.StatusOK)
		return nil
	})
	for _, rawURL := range []string{
		"http://console.example.com/projects",
		"http://app.example.com/_compartment/callback",
		"http://app.example.com/_compartment/logout",
	} {
		request := httptest.NewRequest(http.MethodGet, rawURL, nil)
		if err := handler.ServeHTTP(httptest.NewRecorder(), request, next); err != nil {
			t.Fatalf("serve excluded request: %v", err)
		}
	}
	handler.enqueueCurrentMetrics()
	if _, found := handler.peekPending(); found {
		t.Fatal("excluded traffic was metered")
	}
}

func newTestHandler() *Handler {
	return &Handler{
		APIURL:            "http://127.0.0.1",
		EdgeToken:         "edge-token",
		FlushInterval:     caddy.Duration(time.Minute),
		MaxPendingBatches: defaultQueueLimit,
		client:            &http.Client{Timeout: time.Second},
		flushCtx:          context.Background(),
		pending:           make([]trafficBatch, 0, defaultQueueLimit),
		sourceID:          "source",
	}
}

type hijackingResponseWriter struct {
	client net.Conn
	header http.Header
	server net.Conn
}

func newHijackingResponseWriter() *hijackingResponseWriter {
	server, client := net.Pipe()
	return &hijackingResponseWriter{client: client, header: make(http.Header), server: server}
}

func (w *hijackingResponseWriter) Header() http.Header {
	return w.header
}

func (w *hijackingResponseWriter) Write(body []byte) (int, error) {
	return w.server.Write(body)
}

func (w *hijackingResponseWriter) WriteHeader(int) {}

func (w *hijackingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return w.server, bufio.NewReadWriter(bufio.NewReader(w.server), bufio.NewWriter(w.server)), nil
}

func sealSingleBatch(t *testing.T, handler *Handler) trafficBatch {
	t.Helper()
	handler.enqueueCurrentMetrics()
	batch, found := handler.peekPending()
	if !found {
		t.Fatal("expected one sealed batch")
	}
	if len(batch.Metrics) != 1 {
		t.Fatalf("expected one metric, got %d", len(batch.Metrics))
	}
	return batch
}
