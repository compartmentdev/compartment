#!/bin/sh
set -eu

: "${COMPARTMENT_RUNC_VERSION:?}"
: "${COMPARTMENT_RUNC_COMMIT:?}"
: "${TARGETARCH:?}"
: "${TARGETOS:?}"

git clone --depth 1 --branch "${COMPARTMENT_RUNC_VERSION}" https://github.com/opencontainers/runc.git .
test "$(git rev-parse HEAD)" = "${COMPARTMENT_RUNC_COMMIT}"
git apply --check /patches/runc-gvisor-mount-remap.patch
git apply /patches/runc-gvisor-mount-remap.patch
# Keep the patched runtime pinned to the selected runc release while replacing
# dependencies with versions that clear the worker image's vulnerability gate.
export GOFLAGS=-mod=mod
go get \
  golang.org/x/net@v0.56.0 \
  golang.org/x/text@v0.40.0
go mod tidy

GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" make static
mkdir -p /out
cp runc /out/buildkit-runc-gvisor
