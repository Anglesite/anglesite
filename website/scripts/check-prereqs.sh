#!/bin/zsh
# Anglesite — prerequisite check
# Reports tool status as key=value pairs. Safe to rerun anytime.
# Single command: no chaining needed by the caller.

if [ -z "${ZSH_VERSION-}" ]; then exec /bin/zsh "$0" "$@"; fi

set -uo pipefail

# Ensure fnm is in PATH if installed
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env --shell zsh 2>/dev/null)" || true

check() {
    local label="$1" cmd="$2"
    if command -v "$cmd" &>/dev/null; then
        local ver
        ver=$("$cmd" --version 2>/dev/null | head -1)
        echo "$label=installed $ver"
    else
        echo "$label=missing"
    fi
}

# Xcode CLT
if xcode-select -p &>/dev/null; then
    echo "xcode_clt=installed $(xcode-select -p)"
else
    echo "xcode_clt=missing"
fi

check node node
check npm npm
check git git
check fnm fnm

# node_modules
SCRIPT_DIR="${0:a:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
if [[ -d "$PROJECT_DIR/node_modules.nosync" ]]; then
    echo "node_modules=installed"
elif [[ -d "$PROJECT_DIR/node_modules" ]]; then
    echo "node_modules=installed (not nosync)"
else
    echo "node_modules=missing"
fi

# .nosync symlinks
for name in node_modules dist .astro .wrangler .certs; do
    if [[ -L "$PROJECT_DIR/$name" && -d "$PROJECT_DIR/${name}.nosync" ]]; then
        echo "nosync_${name}=ok"
    elif [[ -d "$PROJECT_DIR/${name}.nosync" ]]; then
        echo "nosync_${name}=dir_only (symlink missing)"
    else
        echo "nosync_${name}=missing"
    fi
done

# --- HTTPS ---
export PATH="$HOME/.local/bin:$PATH"

# mkcert
MKCERT_BIN="$HOME/.local/bin/mkcert"
if [[ -x "$MKCERT_BIN" ]]; then
    echo "mkcert=installed $("$MKCERT_BIN" --version 2>/dev/null | head -1)"
else
    echo "mkcert=missing"
fi

# Local HTTPS certificate
CONFIG_FILE="$PROJECT_DIR/.site-config"
CERTS_DIR="$PROJECT_DIR/.certs"
[[ -L "$CERTS_DIR" ]] && CERTS_DIR="$PROJECT_DIR/.certs.nosync"

if [[ -f "$CERTS_DIR/cert.pem" ]]; then
    if openssl x509 -in "$CERTS_DIR/cert.pem" -checkend 86400 -noout 2>/dev/null; then
        CERT_HOSTNAME=""
        if [[ -f "$CERTS_DIR/.hostname" ]]; then
            CERT_HOSTNAME=$(cat "$CERTS_DIR/.hostname")
        fi
        echo "https_cert=valid ($CERT_HOSTNAME)"
    else
        echo "https_cert=expiring"
    fi
else
    echo "https_cert=missing"
fi

# /etc/hosts entry
DEV_HOSTNAME="localhost"
if [[ -f "$CONFIG_FILE" ]] && grep -q "^DEV_HOSTNAME=" "$CONFIG_FILE" 2>/dev/null; then
    DEV_HOSTNAME=$(grep "^DEV_HOSTNAME=" "$CONFIG_FILE" | cut -d= -f2-)
fi
if [[ "$DEV_HOSTNAME" != "localhost" ]]; then
    if grep -q "$DEV_HOSTNAME" /etc/hosts 2>/dev/null; then
        echo "https_hosts=ok ($DEV_HOSTNAME)"
    else
        echo "https_hosts=missing ($DEV_HOSTNAME not in /etc/hosts)"
    fi
fi

# pfctl port forwarding
if [[ -f "/etc/pf.anchors/com.anglesite" ]]; then
    echo "https_portforward=configured"
else
    echo "https_portforward=missing"
fi
