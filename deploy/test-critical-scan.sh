#!/bin/sh
# Black-box check of the release scanner: a known critical npm package, then an empty image.
set -eu
work=$(mktemp -d)
# Trivy may leave its cache unwritable (seen on GitHub's runners): open it up, fall back to sudo, and never let the
# cleanup change the result of the check.
trap 'chmod -R u+w "$work" 2>/dev/null; rm -rf "$work" 2>/dev/null || sudo -n rm -rf "$work" 2>/dev/null || true' EXIT
# Keep this identical to the pinned scanner used by images.yml.
scanner=aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969
mkdir -p "$work/context" "$work/cache"
printf '%s\n' 'FROM scratch' 'COPY package.json /usr/local/lib/node_modules/jsonpath-plus/package.json' > "$work/context/Dockerfile"
# Use Trivy's upstream database; the default GCR mirror can return stale blob URLs (404). Trivy runs as this user,
# as in images.yml, so the trap can delete the cache it wrote.
scan() {
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$work:/work" "$scanner" image --db-repository ghcr.io/aquasecurity/trivy-db:2 --java-db-repository ghcr.io/aquasecurity/trivy-java-db:1 --input "/work/$archive" --cache-dir /work/cache --scanners vuln --pkg-types os,library --severity CRITICAL --exit-code 1 --format json --output /work/result.json
}
build() {
  image=$(docker build -q "$work/context")
  archive="${image#sha256:}.tar"
  docker save "$image" -o "$work/$archive"
  docker image rm "$image" >/dev/null
}
# GHSA-pppg-cpfq-h7wr: jsonpath-plus before 10.0.7 permits remote code execution.
# https://github.com/advisories/GHSA-pppg-cpfq-h7wr
printf '%s\n' '{"name":"jsonpath-plus","version":"9.0.0"}' > "$work/context/package.json"
build
code=0
scan || code=$?
[ "$code" -eq 1 ]
node -e 'const r=require(process.argv[1]); if(!r.Results?.some(x=>x.Vulnerabilities?.some(v=>v.Severity==="CRITICAL"&&v.PkgName==="jsonpath-plus")))process.exit(1)' "$work/result.json"
printf '%s\n' 'FROM scratch' 'COPY marker /fixture.txt' > "$work/context/Dockerfile"
printf '%s\n' 'clean fixture' > "$work/context/marker"
build
scan
printf '%s\n' 'Critical fixture rejected; clean fixture accepted.'
