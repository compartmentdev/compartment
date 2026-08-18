#!/bin/sh
set -eu

if [ "$#" -ne 4 ]; then
  echo "Usage: generate-buildkit-seed.sh <worker-image> <railpack-builder@digest> <railpack-runtime@digest> <output-directory>" >&2
  exit 2
fi

worker_image="$1"
railpack_builder_image="$2"
railpack_runtime_image="$3"
output_directory="$4"
container_name="compartment-buildkit-seed-$$"
seed_directory="$output_directory/seed"
state_directory="$seed_directory/state"
manifest_directory="$seed_directory/manifest"
host_uid="$(id -u)"
host_gid="$(id -g)"

require_digest_ref() {
  case "$2" in
    *@sha256:????????????????????????????????????????????????????????????????) ;;
    *)
      echo "$1 must be a digest-pinned image reference." >&2
      exit 1
      ;;
  esac
}

require_digest_ref railpack-builder-image "$railpack_builder_image"
require_digest_ref railpack-runtime-image "$railpack_runtime_image"
if [ -e "$output_directory" ]; then
  echo "BuildKit seed output directory already exists: $output_directory" >&2
  exit 1
fi

mkdir -p "$state_directory" "$manifest_directory"
chmod 0777 "$state_directory"

restore_output_ownership() {
  docker run --rm \
    --user 0 \
    --volume "$seed_directory:/seed" \
    --entrypoint sh \
    "$worker_image" \
    -c 'chown -R "$1:$2" /seed' sh "$host_uid" "$host_gid"
}

cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
  restore_output_ownership >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run \
  --detach \
  --name "$container_name" \
  --privileged \
  --user 0 \
  --volume "$state_directory:/var/lib/buildkit" \
  --entrypoint /usr/local/bin/buildkitd \
  "$worker_image" \
  --addr unix:///run/buildkit/buildkitd.sock \
  --oci-worker=true \
  --oci-worker-binary=/usr/local/bin/buildkit-runc-gvisor \
  --oci-worker-gc=false \
  --oci-worker-snapshotter=overlayfs >/dev/null

attempt=0
until docker exec "$container_name" buildctl --addr unix:///run/buildkit/buildkitd.sock debug workers >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 120 ]; then
    docker logs "$container_name" >&2
    echo "Timed out waiting for seed BuildKit." >&2
    exit 1
  fi
  sleep 1
done

docker exec "$container_name" mkdir -p /tmp/seed-context
printf 'FROM %s\nRUN true\n' "$railpack_builder_image" | docker exec --interactive "$container_name" sh -c 'cat > /tmp/seed-context/Dockerfile'
docker exec "$container_name" buildctl --addr unix:///run/buildkit/buildkitd.sock build \
  --progress=plain \
  --frontend dockerfile.v0 \
  --local context=/tmp/seed-context \
  --local dockerfile=/tmp/seed-context

docker stop "$container_name" >/dev/null
docker rm "$container_name" >/dev/null
restore_output_ownership
trap - EXIT INT TERM

docker run --rm --entrypoint sh "$worker_image" -c \
  'sha256sum /usr/local/bin/buildkitd /usr/local/bin/buildctl /usr/local/bin/buildkit-runc-gvisor /usr/local/bin/start-seeded-buildkit | sha256sum | cut -d " " -f 1' \
  > "$manifest_directory/worker-buildkit-runtime-digest"
printf '%s\n' "$railpack_builder_image" > "$manifest_directory/railpack-builder-image"
printf '%s\n' "$railpack_runtime_image" > "$manifest_directory/railpack-runtime-image"
: > "$manifest_directory/copy-snapshots"
: > "$manifest_directory/link-snapshots"

snapshot_directory="$state_directory/runc-overlayfs/snapshots/snapshots"
for snapshot in "$snapshot_directory"/*; do
  snapshot_id="$(basename "$snapshot")"
  snapshot_kib="$(du -sk "$snapshot" | cut -f1)"
  if [ "$snapshot_kib" -le 1024 ]; then
    printf '%s\n' "$snapshot_id" >> "$manifest_directory/copy-snapshots"
  else
    printf '%s\n' "$snapshot_id" >> "$manifest_directory/link-snapshots"
  fi
done

chmod -R a+rX "$seed_directory"
