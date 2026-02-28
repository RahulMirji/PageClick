#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  echo "Usage: $0 <chrome_extension_id>"
  exit 1
fi

EXTENSION_ID="$1"
HOST_NAME="com.pageclick.host"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST_SCRIPT="$ROOT_DIR/scripts/native-host/pageclick-native-host.mjs"
NODE_BIN="$(command -v node || true)"
LAUNCHER_DIR="$HOME/.pageclick"
LAUNCHER_PATH="$LAUNCHER_DIR/pageclick-native-host-launcher.sh"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"

if [[ -z "$NODE_BIN" ]]; then
  echo "Error: 'node' was not found in PATH."
  echo "Install Node.js and rerun this installer."
  exit 1
fi

mkdir -p "$MANIFEST_DIR"
mkdir -p "$LAUNCHER_DIR"
chmod +x "$HOST_SCRIPT"

cat > "$LAUNCHER_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$NODE_BIN" "$HOST_SCRIPT"
EOF
chmod +x "$LAUNCHER_PATH"

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "$HOST_NAME",
  "description": "PageClick Native Messaging Host",
  "path": "$LAUNCHER_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo "Installed native host manifest:"
echo "  $MANIFEST_PATH"
echo "Native launcher:"
echo "  $LAUNCHER_PATH"
echo "Node binary:"
echo "  $NODE_BIN"
echo
echo "Allowed extension origin:"
echo "  chrome-extension://$EXTENSION_ID/"
echo
echo "Next:"
echo "1) Reload the extension in chrome://extensions"
echo "2) Restart Chrome if the host is not detected immediately"
