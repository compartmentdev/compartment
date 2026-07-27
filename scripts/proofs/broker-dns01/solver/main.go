package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	extapi "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/client-go/rest"

	"github.com/cert-manager/cert-manager/pkg/acme/webhook"
	acme "github.com/cert-manager/cert-manager/pkg/acme/webhook/apis/acme/v1alpha1"
	"github.com/cert-manager/cert-manager/pkg/acme/webhook/cmd"
)

const solverName = "managed-domain-broker"

type solverConfig struct {
	AllocationID string `json:"allocationId"`
	BrokerURL    string `json:"brokerURL"`
	Token        string `json:"token"`
}

type challengeBody struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type brokerSolver struct {
	client *http.Client
}

var _ webhook.Solver = (*brokerSolver)(nil)

func main() {
	groupName := os.Getenv("GROUP_NAME")
	if groupName == "" {
		panic("GROUP_NAME is required")
	}
	cmd.RunWebhookServer(groupName, &brokerSolver{})
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

func (s *brokerSolver) Initialize(_ *rest.Config, _ <-chan struct{}) error {
	s.client = &http.Client{Timeout: 10 * time.Second}
	return nil
}

func (s *brokerSolver) request(method string, ch *acme.ChallengeRequest) error {
	config, err := loadConfig(ch.Config)
	if err != nil {
		return err
	}
	body, err := json.Marshal(challengeBody{Name: ch.ResolvedFQDN, Value: ch.Key})
	if err != nil {
		return fmt.Errorf("encode broker challenge request: %w", err)
	}
	url := fmt.Sprintf(
		"%s/allocations/%s/challenges",
		strings.TrimSuffix(config.BrokerURL, "/"),
		config.AllocationID,
	)
	request, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create broker challenge request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+config.Token)
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("call managed-domain broker: %w", err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf(
			"managed-domain broker %s %s returned %d: %s",
			method,
			url,
			response.StatusCode,
			strings.TrimSpace(string(responseBody)),
		)
	}
	fmt.Printf(
		"broker_dns01 method=%s allocation=%s fqdn=%s status=%d\n",
		method,
		config.AllocationID,
		ch.ResolvedFQDN,
		response.StatusCode,
	)
	return nil
}

func loadConfig(raw *extapi.JSON) (solverConfig, error) {
	var config solverConfig
	if raw == nil {
		return config, fmt.Errorf("solver config is required")
	}
	if err := json.Unmarshal(raw.Raw, &config); err != nil {
		return config, fmt.Errorf("decode solver config: %w", err)
	}
	if config.AllocationID == "" || config.BrokerURL == "" || config.Token == "" {
		return config, fmt.Errorf("allocationId, brokerURL, and token are required")
	}
	return config, nil
}
