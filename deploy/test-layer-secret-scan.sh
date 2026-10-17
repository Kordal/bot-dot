#!/bin/sh
# Black-box check of the image secret scan (#534), with the scanner and rules images.yml uses: an image whose lower
# layer adds credentials that the layer above deletes (OCI whiteouts), so they are not in its final filesystem, must
# fail and be named by layer and file; an image with no secret must pass. The images are made by hand (a
# docker-archive tarball), so the check needs no registry and no build.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# Keep this identical to the pinned scanner used by images.yml.
scanner=aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969
mkdir -p "$work/cache"

# image <name> <created_by of layer 1> [<created_by of layer 2> ...]: $work/<name>.tar from the folders
# $work/<name>/1, $work/<name>/2, ... (one layer each, bottom first). $lowest is the bottom layer's diff ID.
image() {
  name=$1; shift
  diffs='' history='' layers='' n=0
  for step in "$@"; do
    n=$((n + 1))
    (cd "$work/$name/$n" && tar --owner=0 --group=0 --numeric-owner --sort=name --mtime=@0 -cf "$work/$name/$n.tar" -- *)
    diff=$(sha256sum "$work/$name/$n.tar" | cut -d' ' -f1)
    diffs="$diffs${diffs:+,}\"sha256:$diff\""
    history="$history${history:+,}{\"created_by\":\"$step\"}"
    layers="$layers${layers:+,}\"$n.tar\""
    if [ "$n" -eq 1 ]; then lowest="sha256:$diff"; fi
  done
  printf '{"architecture":"amd64","os":"linux","config":{},"rootfs":{"type":"layers","diff_ids":[%s]},"history":[%s]}' \
    "$diffs" "$history" > "$work/$name/config.json"
  config=$(sha256sum "$work/$name/config.json" | cut -d' ' -f1)
  mv "$work/$name/config.json" "$work/$name/$config.json"
  printf '[{"Config":"%s.json","RepoTags":["botdot-fixture/%s:534"],"Layers":[%s]}]' "$config" "$name" "$layers" > "$work/$name/manifest.json"
  (cd "$work/$name" && tar -cf "$work/$name.tar" manifest.json "$config.json" $(seq -f '%g.tar' 1 "$n"))
}

# The same command as the secret scan in images.yml, on an archive instead of the pushed digest.
scan() {
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$work:/work" \
    -v "$here/trivy-secret.yaml:/secret.yaml:ro" "$scanner" image --input "/work/$1.tar" --cache-dir /work/cache \
    --scanners secret --secret-config /secret.yaml --exit-code 1 --format json --output "/work/$1.json"
}

# Made-up credentials, put together here so that no scanner of this repository's source finds them in this file.
aws_key="$(printf '%s%s' 'AK' 'IAZ7YQWERTYUIOPASD')"
github_token="$(printf '%s%s' 'gh' 'p_aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5')"

# Layer 1 adds a key where botdot's files go, and a token where Trivy by default looks away (a test folder inside
# node_modules under /usr/lib); layer 2 deletes both, one file and one whole folder.
mkdir -p "$work/leaked/1/opt/botdot" "$work/leaked/1/usr/lib/node_modules/fixture/test" "$work/leaked/2/opt/botdot" "$work/leaked/2/usr/lib/node_modules"
printf 'AWS_ACCESS_KEY_ID=%s\n' "$aws_key" > "$work/leaked/1/opt/botdot/leak.env"
printf 'token: %s\n' "$github_token" > "$work/leaked/1/usr/lib/node_modules/fixture/test/token.yml"
printf 'kept\n' > "$work/leaked/2/opt/botdot/kept.txt"
: > "$work/leaked/2/opt/botdot/.wh.leak.env"
: > "$work/leaked/2/usr/lib/node_modules/.wh.fixture"
image leaked 'COPY leak.env token.yml (fixture lower layer)' 'RUN rm (fixture upper layer)'
code=0
scan leaked || code=$?
[ "$code" -eq 1 ] || { echo "The secret scan exited $code on an image with secrets in a deleted lower layer"; exit 1; }
[ -s "$work/leaked.json" ] || { echo "The secret scan wrote no report"; exit 1; }
node "$here/layer-secrets.js" "$work/leaked.json" > "$work/leaked.log" || true
cat "$work/leaked.log"
grep -qxF "Secret aws-access-key-id in /opt/botdot/leak.env line 1, added by layer $lowest (COPY leak.env token.yml (fixture lower layer))" "$work/leaked.log"
grep -qxF "Secret github-pat in /usr/lib/node_modules/fixture/test/token.yml line 1, added by layer $lowest (COPY leak.env token.yml (fixture lower layer))" "$work/leaked.log"
if grep -qF -e "$aws_key" -e "$github_token" "$work/leaked.log"; then echo 'The log shows a secret'; exit 1; fi

mkdir -p "$work/clean/1/opt/botdot"
printf 'clean fixture\n' > "$work/clean/1/opt/botdot/marker.txt"
image clean 'COPY marker.txt (fixture)'
scan clean
node "$here/layer-secrets.js" "$work/clean.json"
printf '%s\n' 'Secrets in a deleted lower layer rejected, named by layer and file; clean fixture accepted.'
