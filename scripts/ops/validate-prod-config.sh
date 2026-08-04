#!/usr/bin/env bash
set -euo pipefail

# Validate Compose without echoing interpolation warnings: those warnings can
# contain fragments of values from .env.production (for example an unescaped
# dollar sequence in a password hash).
# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_production_env

echo "Docker Compose production configuration is valid and warning-free."
