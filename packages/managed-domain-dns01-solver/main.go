package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/cert-manager/cert-manager/pkg/acme/webhook"
	acme "github.com/cert-manager/cert-manager/pkg/acme/webhook/apis/acme/v1alpha1"
	"github.com/cert-manager/cert-manager/pkg/acme/webhook/cmd"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

const solverName = "managed-domain-broker"
const acmeDnsTxtPath = "/v1/managed-domains/acme-dns/txt"

var brokerRetryDelays = []time.Duration{
	250 * time.Millisecond,
	500 * time.Millisecond,
	1 * time.Second,
}

type solverConfig struct {
	BrokerURL      string
	TokenSecretRef secretKeyRef
}

type secretKeyRef struct {
	Key       string
	Name      string
	Namespace string
}

type challengeBody struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type brokerRequestError struct {
	err error
}

func (e *brokerRequestError) Error() string {
	return fmt.Sprintf("call managed-domain broker: %v", e.err)
}

func (e *brokerRequestError) Unwrap() error {
	return e.err
}

type brokerStatusError struct {
	body       string
	method     string
	statusCode int
}

func (e *brokerStatusError) Error() string {
	return fmt.Sprintf(
		"managed-domain broker %s returned %d: %s",
		e.method,
		e.statusCode,
		e.body,
	)
}

type brokerSolver struct {
	client     *http.Client
	config     solverConfig
	kubernetes kubernetes.Interface
}

var _ webhook.Solver = (*brokerSolver)(nil)

func main() {
	groupName := os.Getenv("GROUP_NAME")
	if groupName == "" {
		panic("GROUP_NAME is required")
	}
	config, err := loadEnvironmentConfig()
	if err != nil {
		panic(err)
	}
	cmd.RunWebhookServer(groupName, &brokerSolver{config: config})
}

func (s *brokerSolver) Name() string {
	return solverName
}

func (s *brokerSolver) Present(ch *acme.ChallengeRequest) error {
	return s.request(http.MethodPut, ch)
}

func (s *brokerSolver) CleanUp(ch *acme.ChallengeRequest) error {
	return s.request(http.MethodDelete, ch)
}

func (s *brokerSolver) Initialize(config *rest.Config, _ <-chan struct{}) error {
	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		return fmt.Errorf("create Kubernetes client: %w", err)
	}
	s.kubernetes = client
	s.client = &http.Client{Timeout: 15 * time.Second}
	return nil
}

func (s *brokerSolver) request(method string, ch *acme.ChallengeRequest) error {
	token, err := s.readToken(s.config.TokenSecretRef)
	if err != nil {
		return err
	}
	body, err := json.Marshal(challengeBody{Name: ch.ResolvedFQDN, Value: ch.Key})
	if err != nil {
		return fmt.Errorf("encode broker challenge request: %w", err)
	}
	return s.requestWithRetry(context.Background(), method, token, body)
}

func (s *brokerSolver) requestWithRetry(ctx context.Context, method string, token string, body []byte) error {
	var requestError error
	for attempt := 0; attempt <= len(brokerRetryDelays); attempt++ {
		requestError = s.sendRequest(ctx, method, token, body)
		if requestError == nil {
			return nil
		}
		if !shouldRetryBrokerRequest(requestError) || attempt == len(brokerRetryDelays) {
			return requestError
		}
		if err := waitBeforeBrokerRetry(ctx, brokerRetryDelays[attempt]); err != nil {
			return fmt.Errorf("managed-domain broker retry canceled: %w", err)
		}
	}
	return requestError
}

func (s *brokerSolver) sendRequest(ctx context.Context, method string, token string, body []byte) error {
	url := strings.TrimSuffix(s.config.BrokerURL, "/") + acmeDnsTxtPath
	request, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create broker challenge request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("call managed-domain broker: %w", err)
		}
		return &brokerRequestError{err: err}
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	if response.StatusCode != http.StatusNoContent {
		return &brokerStatusError{
			body:       strings.TrimSpace(string(responseBody)),
			method:     method,
			statusCode: response.StatusCode,
		}
	}
	return nil
}

func shouldRetryBrokerRequest(err error) bool {
	var requestError *brokerRequestError
	if errors.As(err, &requestError) {
		return true
	}
	var statusError *brokerStatusError
	if errors.As(err, &statusError) {
		return statusError.statusCode == http.StatusRequestTimeout ||
			statusError.statusCode == http.StatusTooManyRequests ||
			statusError.statusCode >= http.StatusInternalServerError
	}
	return false
}

func waitBeforeBrokerRetry(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *brokerSolver) readToken(ref secretKeyRef) (string, error) {
	secret, err := s.kubernetes.CoreV1().Secrets(ref.Namespace).Get(context.Background(), ref.Name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("read broker token Secret: %w", err)
	}
	token := strings.TrimSpace(string(secret.Data[ref.Key]))
	if token == "" {
		return "", fmt.Errorf("broker token Secret %s/%s has no %s", ref.Namespace, ref.Name, ref.Key)
	}
	return token, nil
}

func loadEnvironmentConfig() (solverConfig, error) {
	config := solverConfig{
		BrokerURL: os.Getenv("BROKER_URL"),
		TokenSecretRef: secretKeyRef{
			Key:       os.Getenv("TOKEN_SECRET_KEY"),
			Name:      os.Getenv("TOKEN_SECRET_NAME"),
			Namespace: os.Getenv("TOKEN_SECRET_NAMESPACE"),
		},
	}
	if config.BrokerURL == "" ||
		config.TokenSecretRef.Name == "" ||
		config.TokenSecretRef.Key == "" ||
		config.TokenSecretRef.Namespace == "" {
		return config, fmt.Errorf(
			"BROKER_URL, TOKEN_SECRET_NAMESPACE, TOKEN_SECRET_NAME, and TOKEN_SECRET_KEY are required",
		)
	}
	return config, nil
}
