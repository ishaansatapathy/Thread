#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f ".env" ]; then
  echo ".env file exists."
else
  cp .env.example .env
  echo "Created .env from .env.example"
fi

for dir in apps/* packages/*; do
  if [ -d "$dir" ]; then
    target="$dir/.env"
    if [ ! -e "$target" ]; then
      ln -sf "$(realpath .env)" "$target"
      echo "Linked .env -> $dir"
    fi
  fi
done

echo "Setup complete."
