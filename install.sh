#!/usr/bin/env sh
set -eu

REPO="lucacicii/herdr-code"
BIN_NAME="herdr-code"
INSTALL_DIR="${HERDR_CODE_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${HERDR_CODE_VERSION:-}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' not found" >&2
    exit 1
  fi
}

need_cmd curl
need_cmd tar
need_cmd uname

OS_RAW="$(uname -s)"
case "$OS_RAW" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *)
    echo "Error: unsupported OS '$OS_RAW' (supported: macOS, Linux)" >&2
    exit 1
    ;;
esac

ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  x86_64|amd64)  ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)
    echo "Error: unsupported architecture '$ARCH_RAW' (supported: amd64, arm64)" >&2
    exit 1
    ;;
esac

if [ -z "$VERSION" ]; then
  API_URL="https://api.github.com/repos/$REPO/releases/latest"
  VERSION="$(curl -fsSL "$API_URL" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  if [ -z "$VERSION" ]; then
    echo "Error: failed to resolve latest release tag from $API_URL" >&2
    exit 1
  fi
fi

VER_NUM="${VERSION#v}"
ARCHIVE="${BIN_NAME}_${VER_NUM}_${OS}_${ARCH}.tar.gz"
BASE_URL="https://github.com/$REPO/releases/download/$VERSION"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading $BIN_NAME $VERSION ($OS/$ARCH)..."
curl -fsSL "$BASE_URL/$ARCHIVE" -o "$TMP_DIR/$ARCHIVE"

if curl -fsSL "$BASE_URL/checksums.txt" -o "$TMP_DIR/checksums.txt" 2>/dev/null; then
  EXPECTED="$(awk -v file="$ARCHIVE" '$2 == file { print $1 }' "$TMP_DIR/checksums.txt")"
  if [ -n "$EXPECTED" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL="$(sha256sum "$TMP_DIR/$ARCHIVE" | awk '{ print $1 }')"
    elif command -v shasum >/dev/null 2>&1; then
      ACTUAL="$(shasum -a 256 "$TMP_DIR/$ARCHIVE" | awk '{ print $1 }')"
    else
      ACTUAL=""
    fi
    if [ -n "$ACTUAL" ] && [ "$ACTUAL" != "$EXPECTED" ]; then
      echo "Error: checksum mismatch for $ARCHIVE" >&2
      exit 1
    fi
  fi
fi

tar -xzf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR"
mkdir -p "$INSTALL_DIR"
install -m 0755 "$TMP_DIR/$BIN_NAME" "$INSTALL_DIR/$BIN_NAME"

if [ "$OS" = "darwin" ] && command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "$INSTALL_DIR/$BIN_NAME" 2>/dev/null || true
fi

echo "Installed $BIN_NAME $VERSION to $INSTALL_DIR/$BIN_NAME"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "Add $INSTALL_DIR to your PATH, then run:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
echo "Run: $BIN_NAME --open"
