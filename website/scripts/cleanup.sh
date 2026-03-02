#!/bin/zsh
# Anglesite — remove system modifications
# Reverses /etc/hosts entry and pfctl port forwarding rules.
# Does NOT delete project files, certificates, or mkcert CA.

if [ -z "${ZSH_VERSION-}" ]; then exec /bin/zsh "$0" "$@"; fi

set -uo pipefail

SCRIPT_DIR="${0:a:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
CONFIG_FILE="$PROJECT_DIR/.site-config"
PFCTL_ANCHOR="com.anglesite"

DEV_HOSTNAME="localhost"
if [[ -f "$CONFIG_FILE" ]] && grep -q "^DEV_HOSTNAME=" "$CONFIG_FILE" 2>/dev/null; then
    DEV_HOSTNAME=$(grep "^DEV_HOSTNAME=" "$CONFIG_FILE" | cut -d= -f2-)
fi

echo "This will remove Anglesite's system modifications:"
if [[ "$DEV_HOSTNAME" != "localhost" ]]; then
    echo "  - /etc/hosts entry for $DEV_HOSTNAME"
fi
if [[ -f "/etc/pf.anchors/$PFCTL_ANCHOR" ]]; then
    echo "  - pfctl port forwarding rules (443 → 4321)"
fi
echo ""
echo "Your website files, certificates, and tools will NOT be deleted."
echo ""
echo "Your Mac password is needed for this."

sudo -v || { echo "Admin access required."; exit 1; }

# Remove /etc/hosts entry
if [[ "$DEV_HOSTNAME" != "localhost" ]] && grep -q "$DEV_HOSTNAME" /etc/hosts 2>/dev/null; then
    echo "Removing $DEV_HOSTNAME from /etc/hosts..."
    sudo sed -i '' "/$DEV_HOSTNAME/d" /etc/hosts
fi

# Remove pfctl anchor
if [[ -f "/etc/pf.anchors/$PFCTL_ANCHOR" ]]; then
    echo "Removing pfctl rules..."
    sudo rm -f "/etc/pf.anchors/$PFCTL_ANCHOR"
    sudo sed -i '' "/$PFCTL_ANCHOR/d" /etc/pf.conf
    sudo pfctl -f /etc/pf.conf 2>/dev/null || true
fi

echo ""
echo "System modifications removed."
echo "To also remove the certificate authority from Keychain:"
echo "  $HOME/.local/bin/mkcert -uninstall"
