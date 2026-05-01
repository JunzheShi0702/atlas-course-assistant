#!/usr/bin/env bash
set -euo pipefail

if ! command -v latexmk >/dev/null 2>&1; then
  echo "latexmk is required but not installed."
  echo "Install MacTeX or TeX Live, then rerun."
  exit 1
fi

TEX_FILE="${1:-slides.tex}"
MODE="${2:-watch}"

if [[ ! -f "$TEX_FILE" ]]; then
  echo "TeX file not found: $TEX_FILE"
  echo "Usage: ./autocompile.sh [tex-file] [watch|once]"
  exit 1
fi

COMMON_FLAGS=(-pdf -interaction=nonstopmode -synctex=1)

case "$MODE" in
  once)
    latexmk "${COMMON_FLAGS[@]}" "$TEX_FILE"
    ;;
  watch)
    latexmk "${COMMON_FLAGS[@]}" -pvc "$TEX_FILE"
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo "Usage: ./autocompile.sh [tex-file] [watch|once]"
    exit 1
    ;;
esac
