#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-}"
VERSION="${2:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/opt/tgjk}"
SERVICE_NAME="${SERVICE_NAME:-tgjk}"
HTTP_PORT="${HTTP_PORT:-5005}"

if [[ -z "$REPO" ]]; then
  echo "Usage: curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/install-linux.sh | bash -s -- <owner>/<repo> [version]"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root or use sudo."
  exit 1
fi

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)
      echo "Unsupported architecture: $(uname -m)"
      exit 1
      ;;
  esac
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

need_cmd curl
need_cmd tar
need_cmd systemctl

ARCH="$(detect_arch)"
ASSET_NAME="tgjk-linux-${ARCH}.tar.gz"

if [[ "$VERSION" == "latest" ]]; then
  API_URL="https://api.github.com/repos/${REPO}/releases/latest"
else
  API_URL="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Fetching release metadata from ${API_URL}"
DOWNLOAD_URL="$(curl -fsSL "$API_URL" | grep "browser_download_url" | grep "$ASSET_NAME" | head -n 1 | cut -d '"' -f 4)"

if [[ -z "$DOWNLOAD_URL" ]]; then
  echo "Could not find asset ${ASSET_NAME} in GitHub release ${VERSION}."
  exit 1
fi

echo "Downloading ${ASSET_NAME}"
curl -fL "$DOWNLOAD_URL" -o "$TMP_DIR/$ASSET_NAME"

mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR"/*
tar -xzf "$TMP_DIR/$ASSET_NAME" -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/tgjk"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=TGJK Telegram Monitor
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/tgjk
Restart=always
RestartSec=5
Environment=ASPNETCORE_URLS=http://0.0.0.0:${HTTP_PORT}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo
echo "Install complete."
echo "Service: ${SERVICE_NAME}"
echo "Install dir: ${INSTALL_DIR}"
echo "Status: systemctl status ${SERVICE_NAME}"
echo "Logs: journalctl -u ${SERVICE_NAME} -f"
echo "Panel:"
echo "  http://<server-ip>:${HTTP_PORT}/telegram.html"
echo "  http://<server-ip>:${HTTP_PORT}/keywords.html"
