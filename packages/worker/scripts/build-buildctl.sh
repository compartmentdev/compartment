#!/bin/sh
set -eu

: "${COMPARTMENT_BUILDKIT_VERSION:?}"
: "${TARGETARCH:?}"
: "${TARGETOS:?}"

git clone --depth 1 --branch "${COMPARTMENT_BUILDKIT_VERSION}" https://github.com/moby/buildkit.git .
# Keep this override until the selected BuildKit release embeds a fixed containerd version.
export GOFLAGS=-mod=mod
go get github.com/containerd/containerd/v2@v2.2.4
go mod tidy
mkdir -p /out
GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/buildctl ./cmd/buildctl
