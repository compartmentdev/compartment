#!/bin/sh
set -eu

: "${COMPARTMENT_BUILDKIT_TARGET:?}"
: "${COMPARTMENT_BUILDKIT_VERSION:?}"
: "${COMPARTMENT_BUILDKIT_X_CRYPTO_VERSION:?}"
: "${COMPARTMENT_CONTAINERD_VERSION:?}"
: "${TARGETARCH:?}"
: "${TARGETOS:?}"

case "${COMPARTMENT_BUILDKIT_TARGET}" in
  buildctl | builder) ;;
  *)
    echo "Unsupported BuildKit build target: ${COMPARTMENT_BUILDKIT_TARGET}" >&2
    exit 1
    ;;
esac

git clone --depth 1 --branch "${COMPARTMENT_BUILDKIT_VERSION}" https://github.com/moby/buildkit.git .
revision="$(git rev-parse HEAD)"

# BuildKit v0.31.1 still pins containerd v2.2.4 and x/crypto v0.52.0. Keep these
# dependency updates until a stable BuildKit release embeds the fixed versions.
export GOFLAGS=-mod=mod
go get \
  "github.com/containerd/containerd/v2@${COMPARTMENT_CONTAINERD_VERSION}" \
  "golang.org/x/crypto@${COMPARTMENT_BUILDKIT_X_CRYPTO_VERSION}"
go mod tidy
go mod verify

mkdir -p /out
buildkit_ldflags="-s -w -X github.com/moby/buildkit/version.Version=${COMPARTMENT_BUILDKIT_VERSION} -X github.com/moby/buildkit/version.Revision=${revision} -X github.com/moby/buildkit/version.Package=github.com/moby/buildkit"

GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" CGO_ENABLED=0 \
  go build -trimpath -ldflags "${buildkit_ldflags}" -o /out/buildctl ./cmd/buildctl

if [ "${COMPARTMENT_BUILDKIT_TARGET}" = builder ]; then
  GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" CGO_ENABLED=0 \
    go build -trimpath \
      -tags "osusergo netgo static_build seccomp" \
      -ldflags "${buildkit_ldflags} -extldflags '-static'" \
      -o /out/buildkitd \
      ./cmd/buildkitd
fi
