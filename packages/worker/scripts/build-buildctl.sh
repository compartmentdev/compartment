#!/bin/sh
set -eu

: "${COMPARTMENT_BUILDKIT_VERSION:?}"
: "${COMPARTMENT_BUILDKIT_COMMIT:?}"
: "${TARGETARCH:?}"
: "${TARGETOS:?}"

git clone --depth 1 --branch "${COMPARTMENT_BUILDKIT_VERSION}" https://github.com/moby/buildkit.git .
test "$(git rev-parse HEAD)" = "${COMPARTMENT_BUILDKIT_COMMIT}"
git apply --check /patches/buildkit-gvisor-overlay-xattr.patch
git apply /patches/buildkit-gvisor-overlay-xattr.patch
# Keep these overrides until the selected BuildKit release embeds fixed vulnerable Go dependencies.
export GOFLAGS=-mod=mod
go get \
  github.com/containerd/containerd/v2@v2.2.5 \
  golang.org/x/crypto@v0.53.0 \
  golang.org/x/net@v0.55.0 \
  golang.org/x/text@v0.40.0 \
  google.golang.org/grpc@v1.82.1
go mod tidy
mkdir -p /out
buildkit_ldflags="-s -w -X github.com/moby/buildkit/version.Version=${COMPARTMENT_BUILDKIT_VERSION}-compartment-gvisor -X github.com/moby/buildkit/version.Revision=${COMPARTMENT_BUILDKIT_COMMIT} -X github.com/moby/buildkit/version.Package=github.com/moby/buildkit"
GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" CGO_ENABLED=0 go build \
  -trimpath -ldflags "${buildkit_ldflags}" -o /out/buildctl ./cmd/buildctl
GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" CGO_ENABLED=1 go build \
  -trimpath \
  -tags "osusergo netgo static_build seccomp" \
  -ldflags "${buildkit_ldflags} -linkmode external -extldflags=-static" \
  -o /out/buildkitd \
  ./cmd/buildkitd
