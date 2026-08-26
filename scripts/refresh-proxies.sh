#!/usr/bin/env bash
# Импортирует свежие публичные прокси и сразу прогоняет проверку.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# npm run задает npm_config_prefix, который конфликтует с nvm
if [ -n "${npm_config_prefix-}" ]; then
  unset npm_config_prefix
fi

if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "${HOME}/.nvm/nvm.sh"
  nvm use 20 >/dev/null
fi

DB_URL="file:./dev.db"
DB_PATH="dev.db"

IMPORT_TEST_CONCURRENCY="${IMPORT_TEST_CONCURRENCY:-40}"
IMPORT_COOKIE_CONCURRENCY="${IMPORT_COOKIE_CONCURRENCY:-12}"
IMPORT_TEST_TIMEOUT_MS="${IMPORT_TEST_TIMEOUT_MS:-7000}"
VERIFY_TEST_CONCURRENCY="${VERIFY_TEST_CONCURRENCY:-60}"
VERIFY_TEST_TIMEOUT_MS="${VERIFY_TEST_TIMEOUT_MS:-5000}"

echo "[1/3] Импорт открытых прокси..."
DATABASE_URL="$DB_URL" \
  PROXY_TEST_CONCURRENCY="$IMPORT_TEST_CONCURRENCY" \
  PROXY_COOKIE_CONCURRENCY="$IMPORT_COOKIE_CONCURRENCY" \
  PROXY_TEST_TIMEOUT_MS="$IMPORT_TEST_TIMEOUT_MS" \
  node scripts/import-open-proxies.js

echo "[2/3] Верификация прокси..."
DATABASE_PATH="$DB_PATH" \
  PROXY_TEST_URL="https://api.ipify.org?format=json" \
  PROXY_TEST_CONCURRENCY="$VERIFY_TEST_CONCURRENCY" \
  PROXY_TEST_TIMEOUT_MS="$VERIFY_TEST_TIMEOUT_MS" \
  node scripts/verify-proxies.js

echo "[3/3] Статус пула:"
sqlite3 "$DB_PATH" "SELECT count(*) AS total, sum(CASE WHEN active THEN 1 ELSE 0 END) AS active FROM Proxy;"
