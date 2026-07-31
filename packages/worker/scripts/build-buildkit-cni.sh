#!/bin/sh
set -eu

: "${COMPARTMENT_CNI_VERSION:?}"
: "${COMPARTMENT_CNI_X_SYS_VERSION:?}"
: "${TARGETARCH:?}"
: "${TARGETOS:?}"

git clone --depth 1 --branch "${COMPARTMENT_CNI_VERSION}" https://github.com/containernetworking/plugins.git .
# CNI plugins v1.9.1 still pin x/sys v0.35.0. Keep this direct dependency
# update until a stable CNI plugins release embeds x/sys v0.47.0 or later.
export GOFLAGS=-mod=mod
go get "golang.org/x/sys@${COMPARTMENT_CNI_X_SYS_VERSION}"
go mod tidy
go mod verify
mkdir -p /out

build_plugin() {
  name="$1"
  package="$2"
  GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" CGO_ENABLED=0 \
    go build -trimpath -ldflags "-s -w" -o "/out/buildkit-cni-${name}" "${package}"
}

build_plugin bridge ./plugins/main/bridge
build_plugin firewall ./plugins/meta/firewall
build_plugin host-local ./plugins/ipam/host-local
build_plugin loopback ./plugins/main/loopback
