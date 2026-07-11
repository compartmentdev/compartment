#!/usr/bin/env bash
set -euo pipefail
readonly CONTEXT="${1:?usage: $0 <context>}"
readonly VERSION=v2.10.0
kubectl --context "${CONTEXT}" apply -f "https://raw.githubusercontent.com/cloudnativelabs/kube-router/${VERSION}/daemonset/kube-router-firewall-daemonset.yaml"
kubectl --context "${CONTEXT}" -n kube-system patch daemonset kube-router --type=json -p='[
  {"op":"remove","path":"/spec/template/spec/initContainers"},
  {"op":"replace","path":"/spec/template/spec/containers/0/args","value":["--run-router=false","--run-firewall=true","--run-service-proxy=false"]},
  {"op":"remove","path":"/spec/template/spec/containers/0/volumeMounts/2"},
  {"op":"remove","path":"/spec/template/spec/volumes/3"}
]'
kubectl --context "${CONTEXT}" -n kube-system rollout status daemonset/kube-router --timeout=5m
