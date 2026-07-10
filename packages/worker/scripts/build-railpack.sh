#!/bin/sh
set -eu

: "${COMPARTMENT_RAILPACK_VERSION:?}"
: "${TARGETARCH:?}"
: "${TARGETOS:?}"

git clone --depth 1 --branch "${COMPARTMENT_RAILPACK_VERSION}" https://github.com/railwayapp/railpack.git .
mkdir -p /out
GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/railpack ./cmd/cli
