#!/bin/sh
set -eu

# Prints the e2e image tag for PLAYWRIGHT_PORT, matching e2e/fixtures/environment.ts.
port=${PLAYWRIGHT_PORT:-4173}
if [ "$port" = 4173 ]; then echo stlquest-e2e; else echo "stlquest-e2e-$port"; fi
