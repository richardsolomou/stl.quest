#!/bin/sh
set -eu

# CI runs E2E against the release image, whose build bakes in PostHog settings. Print `docker run`
# arguments that clear the runtime ones and send the build-time ingest proxy to a closed loopback port,
# so test traffic never reaches the production telemetry project.
config=$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${1:-stlquest-e2e}")
token=$(printf '%s\n' "$config" | sed -n 's/^VITE_POSTHOG_PROJECT_TOKEN=//p')
host=$(printf '%s\n' "$config" | sed -n 's|^VITE_POSTHOG_HOST=[a-z]*://\([^/:]*\).*|\1|p')
if [ -n "$token" ] && [ -z "$host" ]; then host=us.i.posthog.com; fi

printf '%s' '-e VITE_POSTHOG_PROJECT_TOKEN= -e VITE_POSTHOG_HOST='
if [ -n "$host" ]; then printf ' --add-host %s:127.0.0.1' "$host"; fi
