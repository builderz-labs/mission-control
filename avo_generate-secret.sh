#!/usr/bin/env bash

set -euo pipefail

LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | dd bs=32 count=1 status=none
echo
