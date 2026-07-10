#!/bin/sh
set -eu

: "${COMPARTMENT_BUILDKIT_VERSION:?}"
: "${TARGETARCH:?}"
: "${TARGETOS:?}"

git clone --depth 1 --branch "${COMPARTMENT_BUILDKIT_VERSION}" https://github.com/moby/buildkit.git .
# Keep these overrides until the selected BuildKit release embeds fixed vulnerable Go dependencies.
export GOFLAGS=-mod=mod
go get \
  github.com/containerd/containerd/v2@v2.2.5 \
  golang.org/x/crypto@v0.53.0 \
  golang.org/x/net@v0.55.0
go mod tidy
mkdir -p /out
GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/buildctl ./cmd/buildctl
