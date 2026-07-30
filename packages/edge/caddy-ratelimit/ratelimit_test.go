package caddyratelimit

import (
	"container/list"
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestAppBucketRejectsAndRecovers(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	handler := newTestHandler(1, 2, 0, 0, 0, &now)
	assertStatus(t, handler, "billing.example.com", "192.0.2.1", http.StatusOK)
	assertStatus(t, handler, "billing.example.com", "192.0.2.1", http.StatusOK)
	response := serve(handler, "billing.example.com", "192.0.2.1", immediateNext)
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", response.Code)
	}
	if response.Header().Get("Retry-After") != "1" {
		t.Fatalf("expected Retry-After 1, got %q", response.Header().Get("Retry-After"))
	}
	now = now.Add(time.Second)
	assertStatus(t, handler, "billing.example.com", "192.0.2.1", http.StatusOK)
}

func TestVeryLowRateStillRejectsAnEmptyBucket(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	handler := newTestHandler(1e-20, 1, 0, 0, 0, &now)
	assertStatus(t, handler, "billing.example.com", "192.0.2.1", http.StatusOK)
	assertStatus(t, handler, "billing.example.com", "192.0.2.1", http.StatusTooManyRequests)
}

func TestClientBucketsAreIndependent(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	handler := newTestHandler(0, 0, 1, 1, 0, &now)
	assertStatus(t, handler, "billing.example.com", "192.0.2.1", http.StatusOK)
	assertStatus(t, handler, "billing.example.com", "192.0.2.1", http.StatusTooManyRequests)
	assertStatus(t, handler, "billing.example.com", "192.0.2.2", http.StatusOK)
	assertStatus(t, handler, "reports.example.com", "192.0.2.1", http.StatusOK)
	if total := testutil.ToFloat64(handler.rejections.WithLabelValues("rate_limit")); total != 1 {
		t.Fatalf("expected one rate rejection, got %f", total)
	}
	if handler.rateTotal.Load() != 1 {
		t.Fatalf("expected logged rate total 1, got %d", handler.rateTotal.Load())
	}
}

func TestInFlightCapRejectsAndReleases(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	handler := newTestHandler(0, 0, 0, 0, 1, &now)
	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	blockingNext := caddyhttp.HandlerFunc(func(http.ResponseWriter, *http.Request) error {
		close(entered)
		<-release
		return nil
	})
	go func() {
		response := httptest.NewRecorder()
		request := testRequest("billing.example.com", "192.0.2.1")
		done <- handler.ServeHTTP(response, request, blockingNext)
	}()
	<-entered
	assertStatus(t, handler, "billing.example.com", "192.0.2.2", http.StatusServiceUnavailable)
	assertStatus(t, handler, "reports.example.com", "192.0.2.1", http.StatusOK)
	if total := testutil.ToFloat64(handler.rejections.WithLabelValues("in_flight_limit")); total != 1 {
		t.Fatalf("expected one capacity rejection, got %f", total)
	}
	if handler.capTotal.Load() != 1 {
		t.Fatalf("expected logged capacity total 1, got %d", handler.capTotal.Load())
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("first request failed: %v", err)
	}
	assertStatus(t, handler, "billing.example.com", "192.0.2.2", http.StatusOK)
}

func TestZeroConfigurationDisablesLimits(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	handler := newTestHandler(0, 0, 0, 0, 0, &now)
	for range 1_000 {
		assertStatus(t, handler, "billing.example.com", "192.0.2.1", http.StatusOK)
	}
}

func TestHostsHaveIndependentAppBuckets(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	handler := newTestHandler(1, 1, 0, 0, 0, &now)
	assertStatus(t, handler, "billing.example.com", "192.0.2.1", http.StatusOK)
	assertStatus(t, handler, "billing.example.com", "192.0.2.2", http.StatusTooManyRequests)
	assertStatus(t, handler, "reports.example.com", "192.0.2.1", http.StatusOK)
}

func TestValidateAcceptsAnyZeroAsDisabled(t *testing.T) {
	testCases := []Handler{
		{AppRequestsPerSecond: 1},
		{AppBurst: 1},
		{ClientRequestsPerSecond: 1},
		{ClientBurst: 1},
	}
	for index := range testCases {
		if err := testCases[index].Validate(); err != nil {
			t.Fatalf("expected zero-disabled bucket %d to validate: %v", index, err)
		}
	}
}

func TestEitherBucketValueZeroDisablesStateTracking(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	handler := newTestHandler(1, 0, 1, 0, 0, &now)
	for range 1_000 {
		assertStatus(t, handler, "billing.example.com", "192.0.2.1", http.StatusOK)
	}
	if len(handler.apps) != 0 || len(handler.clients) != 0 {
		t.Fatalf("expected disabled buckets not to retain state, got %d apps and %d clients", len(handler.apps), len(handler.clients))
	}
}

func TestCleanupWorkIsBoundedPerRequest(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	handler := newTestHandler(0, 0, 1, 1, 0, &now)
	expiredAt := now.Add(-stateIdleTTL - time.Second)
	for index := range maxCleanupEntries + 10 {
		key := strconv.Itoa(index)
		state := &clientState{lastSeen: expiredAt}
		handler.clients[key] = state
		state.idle = handler.idleClients.PushBack(key)
	}

	handler.cleanup(now)
	if remaining := len(handler.clients); remaining != 10 {
		t.Fatalf("expected 10 entries after bounded cleanup, got %d", remaining)
	}
	handler.cleanup(now)
	if remaining := len(handler.clients); remaining != 0 {
		t.Fatalf("expected cleanup continuation to remove remaining entries, got %d", remaining)
	}
}

func TestConcurrentRequestsRespectInFlightCap(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	handler := newTestHandler(0, 0, 0, 0, 8, &now)
	release := make(chan struct{})
	var entered atomic.Int64
	next := caddyhttp.HandlerFunc(func(http.ResponseWriter, *http.Request) error {
		entered.Add(1)
		<-release
		return nil
	})
	done := make(chan struct{}, 8)
	for index := range 8 {
		go func(client int) {
			response := serve(handler, "billing.example.com", "192.0.2."+strconv.Itoa(client+1), next)
			if response.Code != http.StatusOK {
				t.Errorf("expected admitted request, got %d", response.Code)
			}
			done <- struct{}{}
		}(index)
	}
	deadline := time.After(5 * time.Second)
	for entered.Load() != 8 {
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for admitted requests; entered %d", entered.Load())
		default:
			time.Sleep(time.Millisecond)
		}
	}
	assertStatus(t, handler, "billing.example.com", "198.51.100.1", http.StatusServiceUnavailable)
	close(release)
	for range 8 {
		<-done
	}
}

func TestRateLimitStillAppliesAtInFlightCapacity(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	handler := newTestHandler(1, 2, 0, 0, 1, &now)
	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	blockingNext := caddyhttp.HandlerFunc(func(http.ResponseWriter, *http.Request) error {
		close(entered)
		<-release
		return nil
	})
	go func() {
		response := httptest.NewRecorder()
		done <- handler.ServeHTTP(response, testRequest("billing.example.com", "192.0.2.1"), blockingNext)
	}()
	<-entered
	assertStatus(t, handler, "billing.example.com", "192.0.2.2", http.StatusServiceUnavailable)
	response := serve(handler, "billing.example.com", "192.0.2.2", immediateNext)
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("expected saturated traffic to reach rate limit, got %d", response.Code)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("held request failed: %v", err)
	}
}

func newTestHandler(
	appRate float64,
	appBurst uint64,
	clientRate float64,
	clientBurst uint64,
	inFlight uint64,
	now *time.Time,
) *Handler {
	return &Handler{
		AppRequestsPerSecond:    appRate,
		AppBurst:                appBurst,
		ClientRequestsPerSecond: clientRate,
		ClientBurst:             clientBurst,
		AppInFlight:             inFlight,
		apps:                    make(map[string]*appState),
		clients:                 make(map[string]*clientState),
		idleApps:                list.New(),
		idleClients:             list.New(),
		now:                     func() time.Time { return *now },
		rejections:              newRejectionCounter(),
	}
}

func assertStatus(t *testing.T, handler *Handler, host string, clientIP string, expected int) {
	t.Helper()
	response := serve(handler, host, clientIP, immediateNext)
	if response.Code != expected {
		t.Fatalf("expected %d, got %d", expected, response.Code)
	}
}

func serve(handler *Handler, host string, clientIP string, next caddyhttp.Handler) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	request := testRequest(host, clientIP)
	if err := handler.ServeHTTP(response, request, next); err != nil {
		panic(err)
	}
	return response
}

func testRequest(host string, clientIP string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, "http://"+host+"/", nil)
	request = request.WithContext(context.WithValue(request.Context(), caddyhttp.VarsCtxKey, map[string]any{}))
	caddyhttp.SetVar(request.Context(), caddyhttp.ClientIPVarKey, clientIP)
	return request
}

var immediateNext = caddyhttp.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) error {
	w.WriteHeader(http.StatusOK)
	return nil
})
