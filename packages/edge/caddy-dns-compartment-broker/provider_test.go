package compartmentbroker

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/libdns/libdns"
)

func TestAppendRecordsRetriesTransientBrokerFailures(t *testing.T) {
	withBrokerRetryDelays(t, []time.Duration{time.Millisecond, time.Millisecond})

	var requests []brokerTxtRecordRequest
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		assertBrokerRequest(t, request, http.MethodPut)

		var requestBody brokerTxtRecordRequest
		if err := json.NewDecoder(request.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		requests = append(requests, requestBody)

		if len(requests) < 3 {
			http.Error(response, "temporary broker failure", http.StatusServiceUnavailable)
			return
		}

		response.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	provider := newTestProvider(server)
	records, err := provider.AppendRecords(context.Background(), "example.com.", []libdns.Record{
		libdns.TXT{Name: "_acme-challenge", Text: "txt-value"},
	})

	if err != nil {
		t.Fatalf("append records: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected one appended record, got %d", len(records))
	}
	if len(requests) != 3 {
		t.Fatalf("expected three attempts, got %d", len(requests))
	}

	for _, request := range requests {
		assertBrokerTxtRecordRequest(t, request)
	}
}

func TestDeleteRecordsDoesNotRetryUnauthorizedBrokerFailure(t *testing.T) {
	withBrokerRetryDelays(t, []time.Duration{time.Millisecond, time.Millisecond})

	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		attempts++
		assertBrokerRequest(t, request, http.MethodDelete)
		http.Error(response, "unauthorized", http.StatusUnauthorized)
	}))
	defer server.Close()

	provider := newTestProvider(server)
	_, err := provider.DeleteRecords(context.Background(), "example.com.", []libdns.Record{
		libdns.TXT{Name: "_acme-challenge", Text: "txt-value"},
	})

	if err == nil {
		t.Fatal("expected unauthorized broker error")
	}
	if attempts != 1 {
		t.Fatalf("expected one attempt, got %d", attempts)
	}
}

func TestShouldRetryBrokerTxtRequest(t *testing.T) {
	tests := []struct {
		name        string
		err         error
		shouldRetry bool
	}{
		{
			name:        "network",
			err:         &brokerRequestError{err: context.DeadlineExceeded},
			shouldRetry: true,
		},
		{
			name:        "timeout status",
			err:         &brokerStatusError{statusCode: http.StatusRequestTimeout},
			shouldRetry: true,
		},
		{
			name:        "rate limited",
			err:         &brokerStatusError{statusCode: http.StatusTooManyRequests},
			shouldRetry: true,
		},
		{
			name:        "server error",
			err:         &brokerStatusError{statusCode: http.StatusBadGateway},
			shouldRetry: true,
		},
		{
			name:        "invalid request",
			err:         &brokerStatusError{statusCode: http.StatusBadRequest},
			shouldRetry: false,
		},
		{
			name:        "unauthorized",
			err:         &brokerStatusError{statusCode: http.StatusUnauthorized},
			shouldRetry: false,
		},
		{
			name:        "forbidden",
			err:         &brokerStatusError{statusCode: http.StatusForbidden},
			shouldRetry: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if shouldRetryBrokerTxtRequest(test.err) != test.shouldRetry {
				t.Fatalf("unexpected retry decision for %s", test.name)
			}
		})
	}
}

func newTestProvider(server *httptest.Server) *Provider {
	return &Provider{
		BrokerURL:  server.URL,
		Token:      "test-token",
		httpClient: server.Client(),
	}
}

func assertBrokerRequest(t *testing.T, request *http.Request, method string) {
	t.Helper()

	if request.Method != method {
		t.Fatalf("expected method %s, got %s", method, request.Method)
	}
	if request.URL.Path != acmeDnsTxtPath {
		t.Fatalf("expected path %s, got %s", acmeDnsTxtPath, request.URL.Path)
	}
	if request.Header.Get("Authorization") != "Bearer test-token" {
		t.Fatalf("unexpected authorization header")
	}
	if request.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("unexpected content type %q", request.Header.Get("Content-Type"))
	}
}

func assertBrokerTxtRecordRequest(t *testing.T, request brokerTxtRecordRequest) {
	t.Helper()

	if request.Name != "_acme-challenge.example.com." {
		t.Fatalf("unexpected TXT name %q", request.Name)
	}
	if request.Value != "txt-value" {
		t.Fatalf("unexpected TXT value %q", request.Value)
	}
}

func withBrokerRetryDelays(t *testing.T, retryDelays []time.Duration) {
	t.Helper()

	originalRetryDelays := brokerRetryDelays
	brokerRetryDelays = retryDelays
	t.Cleanup(func() {
		brokerRetryDelays = originalRetryDelays
	})
}
