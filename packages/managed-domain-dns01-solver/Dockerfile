ARG COMPARTMENT_GO_BUILD_IMAGE=golang:1.26.5-bookworm
FROM ${COMPARTMENT_GO_BUILD_IMAGE} AS build
WORKDIR /src
COPY packages/managed-domain-dns01-solver/go.mod packages/managed-domain-dns01-solver/go.sum ./
RUN go mod download
COPY packages/managed-domain-dns01-solver/main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /managed-domain-dns01-solver .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /managed-domain-dns01-solver /managed-domain-dns01-solver
USER 65532:65532
ENTRYPOINT ["/managed-domain-dns01-solver"]
