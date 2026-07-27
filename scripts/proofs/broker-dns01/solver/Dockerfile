FROM golang@sha256:d4c4845f5d60c6a974c6000ce58ae079328d03ab7f721a0734277e69905473e5 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /broker-dns01-solver .

FROM gcr.io/distroless/static-debian12@sha256:f5b485ea962d9bd1186b2f6b3a061191539b905b82ec395de78cbfae51f20e35
LABEL io.compartment.proof="broker-dns01"
COPY --from=build /broker-dns01-solver /broker-dns01-solver
USER nonroot:nonroot
ENTRYPOINT ["/broker-dns01-solver"]
