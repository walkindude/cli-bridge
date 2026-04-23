#!/usr/bin/env sh
# Set up the eval target: clone gin into a /tmp dir (outside any CLAUDE.md
# chain) and build the gosymdb index. Writes the absolute path into
# eval/current-isolate.txt where runner.mjs reads it.

set -eu

EVAL_DIR=$(cd "$(dirname "$0")" && pwd)
TS=$(date +%s)
ISOLATE_DIR="/tmp/gosymdb-eval-$TS"

echo "Cloning gin into $ISOLATE_DIR"
git clone --depth 50 https://github.com/gin-gonic/gin.git "$ISOLATE_DIR"

echo "Indexing gin..."
(cd "$ISOLATE_DIR" && gosymdb index --root . --db gosymdb.sqlite --force)

echo "$ISOLATE_DIR" > "$EVAL_DIR/current-isolate.txt"
echo "Target: $ISOLATE_DIR"
