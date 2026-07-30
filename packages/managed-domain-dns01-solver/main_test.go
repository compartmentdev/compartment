package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	acme "github.com/cert-manager/cert-manager/pkg/acme/webhook/apis/acme/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

type recordedBrokerRequest struct {
	authorization string
	body          challengeBody
	method        string
	path          string
}

func TestAcmeDnsRequestsUseMainBrokerContract(t *testing.T) {
	t.Parallel()

	var mutex sync.Mutex
	requests := make([]recordedBrokerRequest, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("read request body: %v", err)
			return
		}
		var challenge challengeBody
		if err := json.Unmarshal(body, &challenge); err != nil {
			t.Errorf("decode request body: %v", err)
			return
		}
		mutex.Lock()
		requests = append(requests, recordedBrokerRequest{
			authorization: request.Header.Get("Authorization"),
			body:          challenge,
			method:        request.Method,
			path:          request.URL.Path,
		})
		mutex.Unlock()
		response.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	solver := brokerSolver{
		client: &http.Client{},
		config: solverConfig{
			BrokerURL: server.URL,
			TokenSecretRef: secretKeyRef{
				Key:       "managed-domain-acme-dns-token",
				Name:      "compartment-install-state",
				Namespace: "compartment",
			},
		},
		kubernetes: fake.NewSimpleClientset(&corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "compartment-install-state", Namespace: "compartment"},
			Data:       map[string][]byte{"managed-domain-acme-dns-token": []byte("acme-token")},
		}),
	}
	challenge := &acme.ChallengeRequest{
		Key:          "proof-value",
		ResolvedFQDN: "_acme-challenge.apps.example.com.",
	}
	if err := solver.Present(challenge); err != nil {
		t.Fatalf("Present request failed: %v", err)
	}
	if err := solver.CleanUp(challenge); err != nil {
		t.Fatalf("CleanUp request failed: %v", err)
	}

	mutex.Lock()
	defer mutex.Unlock()
	if len(requests) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(requests))
	}
	for index, request := range requests {
		expectedMethod := []string{http.MethodPut, http.MethodDelete}[index]
		if request.method != expectedMethod {
			t.Errorf("request %d method = %s, want %s", index, request.method, expectedMethod)
		}
		if request.path != acmeDnsTxtPath {
			t.Errorf("request %d path = %s, want %s", index, request.path, acmeDnsTxtPath)
		}
		if request.authorization != "Bearer acme-token" {
			t.Errorf("request %d authorization = %q", index, request.authorization)
		}
		if request.body.Name != "_acme-challenge.apps.example.com." || request.body.Value != "proof-value" {
			t.Errorf("request %d body = %#v", index, request.body)
		}
	}
}

func TestAcmeDnsRequestRequiresNoContent(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	solver := brokerSolver{client: &http.Client{}, config: solverConfig{BrokerURL: server.URL}}

	err := solver.requestWithRetry(context.Background(), http.MethodPut, "acme-token", []byte(`{"name":"n","value":"v"}`))
	if err == nil {
		t.Fatal("expected status 200 to be rejected")
	}
}

func TestAcmeDnsRequestRetriesTransientStatuses(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		if attempts.Add(1) < 4 {
			response.WriteHeader(http.StatusBadGateway)
			return
		}
		response.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	solver := brokerSolver{client: &http.Client{}, config: solverConfig{BrokerURL: server.URL}}

	if err := solver.requestWithRetry(
		context.Background(),
		http.MethodPut,
		"acme-token",
		[]byte(`{"name":"n","value":"v"}`),
	); err != nil {
		t.Fatalf("request failed after transient responses: %v", err)
	}
	if attempts.Load() != 4 {
		t.Fatalf("attempts = %d, want 4", attempts.Load())
	}
}
