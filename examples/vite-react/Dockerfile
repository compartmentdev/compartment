FROM node:24-alpine

# This fixture must be built through explicit Railpack strategy.
RUN echo "examples/vite-react must not build through Dockerfile autodetect" >&2 && exit 1
