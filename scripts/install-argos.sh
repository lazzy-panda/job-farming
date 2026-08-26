#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN=${PYTHON_BIN:-python3}
ENV_DIR=${ENV_DIR:-storage/argos-env}
LANG_PAIRS=(en_ru ru_en en_de de_en en_pl pl_en en_tr tr_en en_fr fr_en)

mkdir -p "$ENV_DIR"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python binary not found in PATH: $PYTHON_BIN" >&2
  exit 1
fi

if [ ! -d "$ENV_DIR/bin" ]; then
  "$PYTHON_BIN" -m venv "$ENV_DIR"
fi

source "$ENV_DIR/bin/activate"

pip install --upgrade pip >/dev/null
pip install --upgrade argostranslate >/dev/null

for PAIR in "${LANG_PAIRS[@]}"; do
  FROM=${PAIR%_*}
  TO=${PAIR#*_}
  echo "Installing Argos model $FROM->$TO"
  python - <<PY
from argostranslate import package
from_code = "$FROM"
to_code = "$TO"
packages = package.get_available_packages()
match = None
for p in packages:
    if p.from_code == from_code and p.to_code == to_code:
        match = p
        break
if not match:
    print(f"No Argos package found for {from_code}->{to_code}")
else:
    path = match.download()
    package.install_from_path(path)
    print(f"Installed {from_code}->{to_code}")
PY
done

deactivate >/dev/null || true

echo "Argos installation complete in $ENV_DIR"
