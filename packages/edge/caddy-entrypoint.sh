#!/bin/sh
set -eu

case "${COMPARTMENT_CADDY_TLS_MODE:?COMPARTMENT_CADDY_TLS_MODE must be set}" in
  internal)
    config_path=/etc/caddy/Caddyfile.internal
    ;;
  managed)
    config_path=/etc/caddy/Caddyfile.managed
    ;;
  custom-cert)
    config_path=/etc/caddy/Caddyfile.custom-cert
    ;;
  custom-http)
    config_path=/etc/caddy/Caddyfile.custom-http
    ;;
  *)
    echo "Unsupported COMPARTMENT_CADDY_TLS_MODE: ${COMPARTMENT_CADDY_TLS_MODE}" >&2
    exit 1
    ;;
esac

exec caddy run --config "${config_path}" --adapter caddyfile
