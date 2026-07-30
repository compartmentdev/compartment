package caddyratelimit

import (
	"container/list"
	"fmt"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/prometheus/client_golang/prometheus"
	"go.uber.org/zap"
)

const (
	stateIdleTTL       = 10 * time.Minute
	stateCleanupPeriod = time.Minute
	maxAppStates       = 10_000
	maxClientStates    = 100_000
	maxCleanupEntries  = 128
)

func init() {
	caddy.RegisterModule(new(Handler))
	httpcaddyfile.RegisterHandlerDirective("compartment_rate_limit", parseCaddyfile)
}

// Handler applies per-host and per-client request limits and a per-host in-flight cap.
type Handler struct {
	AppRequestsPerSecond    float64 `json:"app_requests_per_second,omitempty"`
	AppBurst                uint64  `json:"app_burst,omitempty"`
	ClientRequestsPerSecond float64 `json:"client_requests_per_second,omitempty"`
	ClientBurst             uint64  `json:"client_burst,omitempty"`
	AppInFlight             uint64  `json:"app_in_flight,omitempty"`

	mu          sync.Mutex
	apps        map[string]*appState
	clients     map[string]*clientState
	idleApps    *list.List
	idleClients *list.List
	nextCleanup time.Time
	now         func() time.Time
	rejections  *prometheus.CounterVec
	logger      *zap.Logger
	rateTotal   atomic.Uint64
	capTotal    atomic.Uint64
}

type appState struct {
	bucket   tokenBucket
	inFlight uint64
	lastSeen time.Time
	idle     *list.Element
}

type clientState struct {
	bucket   tokenBucket
	lastSeen time.Time
	idle     *list.Element
}

type tokenBucket struct {
	tokens  float64
	updated time.Time
}

// CaddyModule returns the Caddy module information.
func (*Handler) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.compartment_rate_limit",
		New: func() caddy.Module { return new(Handler) },
	}
}

// Provision initializes the process-local limiter state.
func (h *Handler) Provision(ctx caddy.Context) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.apps = make(map[string]*appState)
	h.clients = make(map[string]*clientState)
	h.idleApps = list.New()
	h.idleClients = list.New()
	h.now = time.Now
	h.logger = ctx.Logger()
	h.rejections = newRejectionCounter()
	if err := ctx.GetMetricsRegistry().Register(h.rejections); err != nil {
		return fmt.Errorf("register rejection counter: %w", err)
	}
	return nil
}

// Validate rejects non-finite token-bucket rates.
func (h *Handler) Validate() error {
	if h.AppRequestsPerSecond < 0 || math.IsNaN(h.AppRequestsPerSecond) || math.IsInf(h.AppRequestsPerSecond, 0) {
		return fmt.Errorf("app_requests_per_second must be a finite non-negative number")
	}
	if h.ClientRequestsPerSecond < 0 || math.IsNaN(h.ClientRequestsPerSecond) || math.IsInf(h.ClientRequestsPerSecond, 0) {
		return fmt.Errorf("client_requests_per_second must be a finite non-negative number")
	}
	return nil
}

// ServeHTTP applies limits before invoking the remaining hosted-app handler chain.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	if !h.appBucketEnabled() && !h.clientBucketEnabled() && h.AppInFlight == 0 {
		return next.ServeHTTP(w, r)
	}
	app := normalizedHost(r.Host)
	clientIP := requestClientIP(r)
	allowed, retryAfter, rejection := h.acquire(app, clientIP, h.currentTime())
	switch rejection {
	case rejectionRate:
		h.recordRejection("rate_limit", &h.rateTotal)
		w.Header().Set("Retry-After", strconv.FormatUint(uint64(math.Ceil(retryAfter.Seconds())), 10))
		http.Error(w, http.StatusText(http.StatusTooManyRequests), http.StatusTooManyRequests)
		return nil
	case rejectionCapacity:
		h.recordRejection("in_flight_limit", &h.capTotal)
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return nil
	}
	if !allowed {
		return nil
	}
	defer h.release(app, h.currentTime())
	return next.ServeHTTP(w, r)
}

type rejectionKind uint8

const (
	rejectionNone rejectionKind = iota
	rejectionRate
	rejectionCapacity
)

func (h *Handler) acquire(app string, clientIP string, now time.Time) (bool, time.Duration, rejectionKind) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.cleanup(now)
	appEntry := h.appState(app, now)
	if appEntry == nil {
		return false, 0, rejectionCapacity
	}

	var clientEntry *clientState
	if h.clientBucketEnabled() {
		clientEntry = h.clientState(app, clientIP, now)
	}
	appRetry := refillAndRetry(&appEntry.bucket, now, h.AppRequestsPerSecond, h.AppBurst)
	clientRetry := time.Duration(0)
	if clientEntry != nil {
		clientRetry = refillAndRetry(&clientEntry.bucket, now, h.ClientRequestsPerSecond, h.ClientBurst)
	}
	if appRetry > 0 || clientRetry > 0 {
		h.touchIdleApp(appEntry, now)
		if clientEntry != nil {
			h.touchIdleClient(clientEntry, now)
		}
		return false, maxDuration(appRetry, clientRetry), rejectionRate
	}

	if h.appBucketEnabled() {
		appEntry.bucket.tokens--
	}
	if clientEntry != nil {
		clientEntry.bucket.tokens--
		h.touchIdleClient(clientEntry, now)
	}
	if h.AppInFlight > 0 && appEntry.inFlight >= h.AppInFlight {
		h.touchIdleApp(appEntry, now)
		return false, 0, rejectionCapacity
	}
	if appEntry.inFlight == 0 && appEntry.idle != nil {
		h.idleApps.Remove(appEntry.idle)
		appEntry.idle = nil
	}
	appEntry.inFlight++
	appEntry.lastSeen = now
	return true, 0, rejectionNone
}

func (h *Handler) release(app string, now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.apps[app]
	if state == nil {
		return
	}
	if state.inFlight > 0 {
		state.inFlight--
	}
	state.lastSeen = now
	if state.inFlight == 0 && state.idle == nil {
		state.idle = h.idleApps.PushBack(app)
	}
}

func (h *Handler) appState(app string, now time.Time) *appState {
	if state := h.apps[app]; state != nil {
		return state
	}
	if len(h.apps) >= maxAppStates {
		if !h.evictOldestIdleApp() {
			return nil
		}
	}
	state := &appState{bucket: newTokenBucket(now, h.AppBurst), lastSeen: now}
	h.apps[app] = state
	state.idle = h.idleApps.PushBack(app)
	return state
}

func (h *Handler) clientState(app string, clientIP string, now time.Time) *clientState {
	key := app + "\x00" + clientIP
	if state := h.clients[key]; state != nil {
		return state
	}
	if len(h.clients) >= maxClientStates {
		h.evictOldestClient()
	}
	state := &clientState{bucket: newTokenBucket(now, h.ClientBurst), lastSeen: now}
	h.clients[key] = state
	state.idle = h.idleClients.PushBack(key)
	return state
}

func (h *Handler) cleanup(now time.Time) {
	if now.Before(h.nextCleanup) {
		return
	}
	expiredBefore := now.Add(-stateIdleTTL)
	removed := 0
	for h.idleClients.Len() > 0 && removed < maxCleanupEntries {
		element := h.idleClients.Front()
		key := element.Value.(string)
		state := h.clients[key]
		if state == nil || !state.lastSeen.Before(expiredBefore) {
			break
		}
		h.idleClients.Remove(element)
		delete(h.clients, key)
		removed++
	}
	for h.idleApps.Len() > 0 && removed < maxCleanupEntries {
		element := h.idleApps.Front()
		key := element.Value.(string)
		state := h.apps[key]
		if state == nil || !state.lastSeen.Before(expiredBefore) {
			break
		}
		h.idleApps.Remove(element)
		delete(h.apps, key)
		removed++
	}
	if removed == maxCleanupEntries {
		h.nextCleanup = now
	} else {
		h.nextCleanup = now.Add(stateCleanupPeriod)
	}
}

func (h *Handler) evictOldestIdleApp() bool {
	element := h.idleApps.Front()
	if element == nil {
		return false
	}
	h.idleApps.Remove(element)
	delete(h.apps, element.Value.(string))
	return true
}

func (h *Handler) evictOldestClient() {
	element := h.idleClients.Front()
	if element == nil {
		return
	}
	h.idleClients.Remove(element)
	delete(h.clients, element.Value.(string))
}

func (h *Handler) currentTime() time.Time {
	if h.now == nil {
		return time.Now()
	}
	return h.now()
}

func (h *Handler) touchIdleApp(state *appState, now time.Time) {
	state.lastSeen = now
	if state.idle != nil {
		h.idleApps.MoveToBack(state.idle)
	}
}

func (h *Handler) touchIdleClient(state *clientState, now time.Time) {
	state.lastSeen = now
	if state.idle != nil {
		h.idleClients.MoveToBack(state.idle)
	}
}

func (h *Handler) appBucketEnabled() bool {
	return h.AppRequestsPerSecond > 0 && h.AppBurst > 0
}

func (h *Handler) clientBucketEnabled() bool {
	return h.ClientRequestsPerSecond > 0 && h.ClientBurst > 0
}

func (h *Handler) recordRejection(reason string, total *atomic.Uint64) {
	h.rejections.WithLabelValues(reason).Inc()
	count := total.Add(1)
	if h.logger != nil && count&(count-1) == 0 {
		h.logger.Info(
			"hosted app requests rejected",
			zap.String("reason", reason),
			zap.Uint64("rejected_total", count),
		)
	}
}

func newRejectionCounter() *prometheus.CounterVec {
	return prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "caddy",
			Subsystem: "compartment_edge",
			Name:      "rejected_requests_total",
			Help:      "Number of hosted application requests rejected by edge capacity protection.",
		},
		[]string{"reason"},
	)
}

func newTokenBucket(now time.Time, burst uint64) tokenBucket {
	return tokenBucket{tokens: float64(burst), updated: now}
}

func refillAndRetry(bucket *tokenBucket, now time.Time, rate float64, burst uint64) time.Duration {
	if rate == 0 || burst == 0 {
		return 0
	}
	elapsed := now.Sub(bucket.updated).Seconds()
	if elapsed > 0 {
		bucket.tokens = math.Min(float64(burst), bucket.tokens+elapsed*rate)
		bucket.updated = now
	}
	if bucket.tokens >= 1 {
		return 0
	}
	retrySeconds := (1 - bucket.tokens) / rate
	maxRetry := time.Duration(math.MaxInt64)
	if retrySeconds >= maxRetry.Seconds() {
		return maxRetry
	}
	return time.Duration(math.Ceil(retrySeconds * float64(time.Second)))
}

func normalizedHost(host string) string {
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}
	return strings.TrimSuffix(strings.ToLower(host), ".")
}

func requestClientIP(r *http.Request) string {
	clientIP, _ := caddyhttp.GetVar(r.Context(), caddyhttp.ClientIPVarKey).(string)
	return clientIP
}

func maxDuration(left time.Duration, right time.Duration) time.Duration {
	if left > right {
		return left
	}
	return right
}

func parseCaddyfile(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var handler Handler
	err := handler.UnmarshalCaddyfile(h.Dispenser)
	return &handler, err
}

// UnmarshalCaddyfile parses the compartment_rate_limit directive.
func (h *Handler) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "app_requests_per_second":
				value, err := parseFloatArg(d, "app_requests_per_second")
				if err != nil {
					return err
				}
				h.AppRequestsPerSecond = value
			case "app_burst":
				value, err := parseUintArg(d, "app_burst")
				if err != nil {
					return err
				}
				h.AppBurst = value
			case "client_requests_per_second":
				value, err := parseFloatArg(d, "client_requests_per_second")
				if err != nil {
					return err
				}
				h.ClientRequestsPerSecond = value
			case "client_burst":
				value, err := parseUintArg(d, "client_burst")
				if err != nil {
					return err
				}
				h.ClientBurst = value
			case "app_in_flight":
				value, err := parseUintArg(d, "app_in_flight")
				if err != nil {
					return err
				}
				h.AppInFlight = value
			default:
				return d.Errf("unrecognized compartment_rate_limit option: %s", d.Val())
			}
		}
	}
	return nil
}

func parseFloatArg(d *caddyfile.Dispenser, name string) (float64, error) {
	if !d.NextArg() {
		return 0, d.ArgErr()
	}
	value, err := strconv.ParseFloat(d.Val(), 64)
	if err != nil || value < 0 {
		return 0, d.Errf("%s must be a non-negative number", name)
	}
	return value, nil
}

func parseUintArg(d *caddyfile.Dispenser, name string) (uint64, error) {
	if !d.NextArg() {
		return 0, d.ArgErr()
	}
	value, err := strconv.ParseUint(d.Val(), 10, 64)
	if err != nil {
		return 0, d.Errf("%s must be a non-negative integer", name)
	}
	return value, nil
}

var (
	_ caddy.Provisioner           = (*Handler)(nil)
	_ caddy.Validator             = (*Handler)(nil)
	_ caddyfile.Unmarshaler       = (*Handler)(nil)
	_ caddyhttp.MiddlewareHandler = (*Handler)(nil)
)
