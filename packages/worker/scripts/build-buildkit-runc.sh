#!/bin/sh
set -eu

: "${COMPARTMENT_RUNC_VERSION:?}"
: "${COMPARTMENT_RUNC_X_NET_VERSION:?}"
: "${TARGETARCH:?}"
: "${TARGETOS:?}"

git clone --depth 1 --branch "${COMPARTMENT_RUNC_VERSION}" https://github.com/opencontainers/runc.git .

# runc v1.5.0 still pins x/net v0.50.0. Keep this transitive update only until
# a stable runc release embeds x/net v0.55.0 or later.
export GOFLAGS=-mod=mod
go get "golang.org/x/net@${COMPARTMENT_RUNC_X_NET_VERSION}"
go mod tidy
go mod verify

mkdir -p /out
GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" CGO_ENABLED=1 \
  go build -trimpath \
    -tags "apparmor seccomp netgo cgo static_build osusergo" \
    -ldflags "-s -w -extldflags=-static" \
    -o /out/buildkit-runc \
    .
