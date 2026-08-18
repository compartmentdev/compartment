#!/bin/sh
set -eu

seed_root=/var/lib/buildkit-seed/seed
buildkit_root=/var/lib/buildkit
manifest_root="$seed_root/manifest"
snapshot_source="$seed_root/state/runc-overlayfs/snapshots/snapshots"
snapshot_target="$buildkit_root/runc-overlayfs/snapshots/snapshots"

require_file() {
  if [ ! -f "$1" ]; then
    echo "BuildKit seed is missing required file: $1" >&2
    exit 1
  fi
}

require_directory() {
  if [ ! -d "$1" ]; then
    echo "BuildKit seed is missing required directory: $1" >&2
    exit 1
  fi
}

require_exact_value() {
  require_file "$1"
  observed="$(cat "$1")"
  if [ "$observed" != "$2" ]; then
    echo "BuildKit seed compatibility check failed for $(basename "$1")." >&2
    exit 1
  fi
}

require_digest_ref() {
  if ! printf '%s\n' "$2" | grep -Eq '^.+:[^/@:]+@sha256:[a-f0-9]{64}$'; then
    echo "$1 must be a tag-and-digest-pinned image reference." >&2
    exit 1
  fi
}

: "${COMPARTMENT_RAILPACK_BUILDER_IMAGE:?COMPARTMENT_RAILPACK_BUILDER_IMAGE is required.}"
: "${COMPARTMENT_RAILPACK_RUNTIME_IMAGE:?COMPARTMENT_RAILPACK_RUNTIME_IMAGE is required.}"

require_digest_ref COMPARTMENT_RAILPACK_BUILDER_IMAGE "$COMPARTMENT_RAILPACK_BUILDER_IMAGE"
require_digest_ref COMPARTMENT_RAILPACK_RUNTIME_IMAGE "$COMPARTMENT_RAILPACK_RUNTIME_IMAGE"
worker_buildkit_runtime_digest="$(
  sha256sum \
    /usr/local/bin/buildkitd \
    /usr/local/bin/buildctl \
    /usr/local/bin/buildkit-runc-gvisor \
    /usr/local/bin/start-seeded-buildkit |
    sha256sum |
    cut -d ' ' -f 1
)"
require_exact_value "$manifest_root/worker-buildkit-runtime-digest" "$worker_buildkit_runtime_digest"
require_exact_value "$manifest_root/railpack-builder-image" "$COMPARTMENT_RAILPACK_BUILDER_IMAGE"
require_exact_value "$manifest_root/railpack-runtime-image" "$COMPARTMENT_RAILPACK_RUNTIME_IMAGE"
require_file "$manifest_root/link-snapshots"

if find "$buildkit_root" -mindepth 1 -print -quit | grep -q .; then
  echo "BuildKit writable root must be empty before seed initialization." >&2
  exit 1
fi

mkdir -p \
  "$buildkit_root/runc-overlayfs/cachemounts" \
  "$buildkit_root/runc-overlayfs/content/blobs" \
  "$buildkit_root/runc-overlayfs/content/ingest" \
  "$buildkit_root/runc-overlayfs/executor" \
  "$snapshot_target"

for file in cache.db history.db; do
  require_file "$seed_root/state/$file"
  cp "$seed_root/state/$file" "$buildkit_root/$file"
done
for file in containerdmeta.db metadata_v2.db workerid; do
  require_file "$seed_root/state/runc-overlayfs/$file"
  cp "$seed_root/state/runc-overlayfs/$file" "$buildkit_root/runc-overlayfs/$file"
done
require_file "$seed_root/state/runc-overlayfs/snapshots/metadata.db"
cp "$seed_root/state/runc-overlayfs/snapshots/metadata.db" "$buildkit_root/runc-overlayfs/snapshots/metadata.db"
seed_blob_directory="$seed_root/state/runc-overlayfs/content/blobs/sha256"
blob_directory="$buildkit_root/runc-overlayfs/content/blobs/sha256"
require_directory "$seed_blob_directory"
mkdir "$blob_directory"
for seed_blob in "$seed_blob_directory"/*; do
  require_file "$seed_blob"
  ln -s "$seed_blob" "$blob_directory/$(basename "$seed_blob")"
done

link_snapshot() {
  snapshot_id="$1"
  [ -n "$snapshot_id" ] || return
  if [ ! -d "$snapshot_source/$snapshot_id" ]; then
    echo "BuildKit seed linked snapshot $snapshot_id is missing." >&2
    exit 1
  fi
  ln -s "$snapshot_source/$snapshot_id" "$snapshot_target/$snapshot_id"
}

while IFS= read -r snapshot_id; do link_snapshot "$snapshot_id"; done < "$manifest_root/link-snapshots"

seed_snapshot_count="$(find "$snapshot_source" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
initialized_snapshot_count="$(find "$snapshot_target" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
if [ "$seed_snapshot_count" != "$initialized_snapshot_count" ]; then
  echo "BuildKit seed manifest does not account for every snapshot." >&2
  exit 1
fi

exec /usr/local/bin/buildkitd --root "$buildkit_root" "$@"
