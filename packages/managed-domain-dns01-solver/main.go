package main

import (
	"bytes"
	"context"
	"encoding/json"
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

type solverConfig struct {
	AllocationID   string
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
	return s.request(http.MethodPost, ch)
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
	s.client = &http.Client{Timeout: 10 * time.Second}
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
	url := fmt.Sprintf(
		"%s/v1/managed-domains/allocations/%s/challenges",
		strings.TrimSuffix(s.config.BrokerURL, "/"),
		s.config.AllocationID,
	)
	request, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create broker challenge request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("call managed-domain broker: %w", err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf(
			"managed-domain broker %s returned %d: %s",
			method,
			response.StatusCode,
			strings.TrimSpace(string(responseBody)),
		)
	}
	return nil
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
		AllocationID: os.Getenv("ALLOCATION_ID"),
		BrokerURL:    os.Getenv("BROKER_URL"),
		TokenSecretRef: secretKeyRef{
			Key:       os.Getenv("TOKEN_SECRET_KEY"),
			Name:      os.Getenv("TOKEN_SECRET_NAME"),
			Namespace: os.Getenv("TOKEN_SECRET_NAMESPACE"),
		},
	}
	if config.AllocationID == "" ||
		config.BrokerURL == "" ||
		config.TokenSecretRef.Name == "" ||
		config.TokenSecretRef.Key == "" ||
		config.TokenSecretRef.Namespace == "" {
		return config, fmt.Errorf(
			"ALLOCATION_ID, BROKER_URL, TOKEN_SECRET_NAMESPACE, TOKEN_SECRET_NAME, and TOKEN_SECRET_KEY are required",
		)
	}
	return config, nil
}
