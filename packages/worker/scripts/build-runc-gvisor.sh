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

GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" make static
mkdir -p /out
cp runc /out/buildkit-runc-gvisor
