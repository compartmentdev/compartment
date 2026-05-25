package compartmentbroker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/libdns/libdns"
)

const acmeDnsTxtPath = "/v1/managed-domains/acme-dns/txt"

var brokerRetryDelays = []time.Duration{
	250 * time.Millisecond,
	500 * time.Millisecond,
	1 * time.Second,
}

func init() {
	caddy.RegisterModule(Provider{})
}

type Provider struct {
	BrokerURL string `json:"broker_url,omitempty"`
	Token     string `json:"token,omitempty"`

	httpClient *http.Client
}

type brokerTxtRecordRequest struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type brokerRequestError struct {
	err error
}

func (e *brokerRequestError) Error() string {
	return fmt.Sprintf("send broker TXT request: %v", e.err)
}

func (e *brokerRequestError) Unwrap() error {
	return e.err
}

type brokerStatusError struct {
	statusCode int
	body       string
}

func (e *brokerStatusError) Error() string {
	return fmt.Sprintf("broker TXT request failed with status %d: %s", e.statusCode, e.body)
}

func (Provider) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "dns.providers.compartment_broker",
		New: func() caddy.Module { return new(Provider) },
	}
}

func (p *Provider) Provision(_ caddy.Context) error {
	replacer := caddy.NewReplacer()
	p.BrokerURL = strings.TrimRight(replacer.ReplaceAll(p.BrokerURL, ""), "/")
	p.Token = replacer.ReplaceAll(p.Token, "")

	if p.BrokerURL == "" {
		return fmt.Errorf("broker_url is required")
	}

	if p.Token == "" {
		return fmt.Errorf("token is required")
	}

	p.httpClient = &http.Client{Timeout: 15 * time.Second}
	return nil
}

func (p *Provider) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		if d.NextArg() {
			return d.ArgErr()
		}

		for nesting := d.Nesting(); d.NextBlock(nesting); {
			switch d.Val() {
			case "broker_url":
				if p.BrokerURL != "" {
					return d.Err("broker_url already set")
				}

				if !d.NextArg() {
					return d.ArgErr()
				}

				p.BrokerURL = d.Val()
				if d.NextArg() {
					return d.ArgErr()
				}

			case "token":
				if p.Token != "" {
					return d.Err("token already set")
				}

				if !d.NextArg() {
					return d.ArgErr()
				}

				p.Token = d.Val()
				if d.NextArg() {
					return d.ArgErr()
				}

			default:
				return d.Errf("unrecognized subdirective '%s'", d.Val())
			}
		}
	}

	if p.BrokerURL == "" {
		return d.Err("missing broker_url")
	}

	if p.Token == "" {
		return d.Err("missing token")
	}

	return nil
}

func (p *Provider) AppendRecords(ctx context.Context, zone string, records []libdns.Record) ([]libdns.Record, error) {
	for _, record := range records {
		if err := p.sendTxtRecordRequest(ctx, http.MethodPut, zone, record); err != nil {
			return nil, err
		}
	}

	return records, nil
}

func (p *Provider) DeleteRecords(ctx context.Context, zone string, records []libdns.Record) ([]libdns.Record, error) {
	for _, record := range records {
		if err := p.sendTxtRecordRequest(ctx, http.MethodDelete, zone, record); err != nil {
			return nil, err
		}
	}

	return records, nil
}

func (p *Provider) sendTxtRecordRequest(ctx context.Context, method string, zone string, record libdns.Record) error {
	rr := record.RR()
	if rr.Type != "TXT" {
		return fmt.Errorf("unsupported DNS record type %s", rr.Type)
	}

	requestBody, err := json.Marshal(brokerTxtRecordRequest{
		Name:  libdns.AbsoluteName(rr.Name, zone),
		Value: strings.Trim(rr.Data, `"`),
	})
	if err != nil {
		return fmt.Errorf("marshal broker TXT request: %w", err)
	}

	return p.sendBrokerTxtRequestWithRetry(ctx, method, requestBody)
}

func (p *Provider) sendBrokerTxtRequestWithRetry(ctx context.Context, method string, requestBody []byte) error {
	var requestError error

	for attempt := 0; attempt <= len(brokerRetryDelays); attempt++ {
		requestError = p.sendBrokerTxtRequest(ctx, method, requestBody)
		if requestError == nil {
			return nil
		}

		if !shouldRetryBrokerTxtRequest(requestError) || attempt == len(brokerRetryDelays) {
			return requestError
		}

		if err := waitBeforeBrokerRetry(ctx, brokerRetryDelays[attempt]); err != nil {
			return fmt.Errorf("broker TXT request retry canceled: %w", err)
		}
	}

	return requestError
}

func (p *Provider) sendBrokerTxtRequest(ctx context.Context, method string, requestBody []byte) error {
	request, err := http.NewRequestWithContext(ctx, method, p.BrokerURL+acmeDnsTxtPath, bytes.NewReader(requestBody))
	if err != nil {
		return fmt.Errorf("create broker TXT request: %w", err)
	}

	request.Header.Set("Authorization", "Bearer "+p.Token)
	request.Header.Set("Content-Type", "application/json")

	response, err := p.httpClient.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("send broker TXT request: %w", err)
		}

		return &brokerRequestError{err: err}
	}
	defer response.Body.Close()

	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}

	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
	return &brokerStatusError{
		statusCode: response.StatusCode,
		body:       strings.TrimSpace(string(responseBody)),
	}
}

func shouldRetryBrokerTxtRequest(err error) bool {
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

var (
	_ caddyfile.Unmarshaler = (*Provider)(nil)
	_ caddy.Provisioner     = (*Provider)(nil)
	_ libdns.RecordAppender = (*Provider)(nil)
	_ libdns.RecordDeleter  = (*Provider)(nil)
)
