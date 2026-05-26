#!/bin/sh
set -eu

: "${COMPARTMENT_RAILPACK_VERSION:?}"
: "${TARGETARCH:?}"
: "${TARGETOS:?}"

git clone --depth 1 --branch "${COMPARTMENT_RAILPACK_VERSION}" https://github.com/railwayapp/railpack.git .
# Keep these overrides until the selected Railpack release embeds fixed vulnerable Go dependencies.
go get \
  github.com/containerd/containerd/v2@v2.2.4 \
  golang.org/x/crypto@v0.52.0 \
  golang.org/x/net@v0.55.0 \
  go.opentelemetry.io/otel@v1.43.0 \
  go.opentelemetry.io/otel/exporters/otlp/otlptrace@v1.43.0 \
  go.opentelemetry.io/otel/metric@v1.43.0 \
  go.opentelemetry.io/otel/sdk@v1.43.0 \
  go.opentelemetry.io/otel/trace@v1.43.0
go mod tidy
mkdir -p /out
GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/railpack ./cmd/cli
