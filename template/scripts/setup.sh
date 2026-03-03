#!/bin/zsh
# Anglesite — First-time setup
# Installs Node.js via fnm (no Homebrew needed), creates iCloud-safe
# symlinks, then npm install. Safe to rerun (idempotent).

# Re-exec under zsh if invoked with bash
if [ -z "${ZSH_VERSION-}" ]; then exec /bin/zsh "$0" "$@"; fi

set -euo pipefail

# Self-locate: derive project dir from this script's location
SCRIPT_DIR="${0:a:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
CONFIG_FILE="$PROJECT_DIR/.site-config"
LOG_DIR="$HOME/.anglesite/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/setup.log"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }
fail() { log "ERROR: $1"; osascript -e "display notification \"$1\" with title \"Setup Failed\""; exit 1; }

echo "" > "$LOG"
log "Starting site setup..."
log "Project directory: $PROJECT_DIR"

# --- Xcode Command Line Tools (includes git) ---
if ! xcode-select -p &>/dev/null; then
    log "Installing Xcode command line tools (includes Git)..."
    log "A macOS dialog will appear — click Install and wait for it to finish."
# Simple flags
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=true; shift ;;
    -h|--help) echo "Usage: $0 [--dry-run]"; exit 0 ;;
    --) shift; break ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

    xcode-select --install
    until xcode-select -p &>/dev/null; do
        sleep 5
    done
    log "Xcode tools installed."
else
    log "Xcode tools already installed."
fi

# --- fnm (Fast Node Manager) ---
if ! command -v fnm &>/dev/null && [[ ! -f "$HOME/.local/share/fnm/fnm" ]]; then
    log "Installing fnm (Node.js manager)..."
    FNM_INSTALLER=$(mktemp)
    curl -fsSL https://fnm.vercel.app/install -o "$FNM_INSTALLER"
    if ! head -1 "$FNM_INSTALLER" | grep -q '^#!'; then
        rm -f "$FNM_INSTALLER"
        fail "fnm installer download failed or was corrupted"
    fi
    bash "$FNM_INSTALLER" --skip-shell >> "$LOG" 2>&1
    rm -f "$FNM_INSTALLER"
fi

# Ensure fnm is in PATH for this session
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env --shell zsh 2>/dev/null)" || true
log "fnm ready."

# --- Node.js ---
if ! command -v node &>/dev/null; then
    log "Installing Node.js (LTS)..."
    fnm install --lts >> "$LOG" 2>&1
    fnm default lts-latest >> "$LOG" 2>&1
    eval "$(fnm env --shell zsh)"
fi
log "Node.js $(node --version) ready."

# --- Ensure fnm loads in future shells ---
ZSHRC="$HOME/.zshrc"
if [[ ! -f "$ZSHRC" ]] || ! grep -q "fnm env" "$ZSHRC" 2>/dev/null; then
    log "Adding fnm to shell profile..."
    {
        echo ''
        echo '# fnm (Node.js manager)'
        echo 'export PATH="$HOME/.local/share/fnm:$PATH"'
        echo 'eval "$(fnm env --shell zsh)"'
    } >> "$ZSHRC"
fi

# --- Project directory ---
cd "$PROJECT_DIR" || fail "Project folder not found at $PROJECT_DIR"

# --- iCloud .nosync symlinks ---
# Heavy directories get .nosync suffix so iCloud Drive skips them.
# A symlink with the standard name lets npm/Astro work normally.
setup_nosync() {
    local name="$1"
    if [[ -d "$name" && ! -L "$name" ]]; then
        # Real directory exists (e.g., npm replaced our symlink) — convert it.
        # Remove stale .nosync dir first so mv doesn't nest inside it.
        if [[ -d "${name}.nosync" ]]; then
            rm -rf "${name}.nosync"
        fi
        mv "$name" "${name}.nosync"
        ln -s "${name}.nosync" "$name"
        log "Converted $name to .nosync symlink"
    elif [[ ! -e "${name}.nosync" ]]; then
        # Nothing exists yet — create the .nosync dir and symlink
        mkdir -p "${name}.nosync"
        ln -sf "${name}.nosync" "$name"
        log "Created .nosync symlink for $name"
    elif [[ ! -L "$name" ]]; then
        # .nosync exists but symlink is missing — recreate it
        ln -sf "${name}.nosync" "$name"
        log "Recreated symlink for $name"
    fi
}

setup_nosync "node_modules"
setup_nosync "dist"
setup_nosync ".astro"
setup_nosync ".wrangler"
setup_nosync ".certs"

# --- Install dependencies ---
log "Installing project dependencies (this may take a minute)..."
npm install >> "$LOG" 2>&1
log "Dependencies installed."

# --- Re-verify .nosync symlinks ---
# npm install can replace the node_modules symlink with a real directory.
# Re-run setup_nosync to convert it back.
setup_nosync "node_modules"
setup_nosync "dist"
setup_nosync ".astro"
setup_nosync ".wrangler"
setup_nosync ".certs"

# --- mkcert (local HTTPS certificates) ---
MKCERT_BIN="$HOME/.local/bin/mkcert"
if [[ ! -x "$MKCERT_BIN" ]]; then
    log "Installing mkcert (for local HTTPS)..."
    mkdir -p "$HOME/.local/bin"
    ARCH=$(uname -m)
    case "$ARCH" in
        arm64) MKCERT_ARCH="arm64" ;;
        x86_64) MKCERT_ARCH="amd64" ;;
        *) fail "Unsupported architecture: $ARCH" ;;
    esac
    MKCERT_URL="https://dl.filippo.io/mkcert/latest?for=darwin/$MKCERT_ARCH"
    curl -fsSL "$MKCERT_URL" -o "$MKCERT_BIN" || fail "Failed to download mkcert"
    chmod +x "$MKCERT_BIN"
    log "mkcert installed."
else
    log "mkcert already installed."
fi
export PATH="$HOME/.local/bin:$PATH"

# --- Trust the local CA (one-time macOS Keychain prompt) ---
CA_ROOT=$("$MKCERT_BIN" -CAROOT 2>/dev/null)
if [[ ! -f "$CA_ROOT/rootCA.pem" ]]; then
    log "Trusting the local certificate authority..."
    log "A macOS Keychain dialog will appear — enter your password or click Allow."
    "$MKCERT_BIN" -install >> "$LOG" 2>&1 || fail "Failed to install mkcert CA"
    log "Local CA trusted."
else
    log "Local CA already trusted."
fi

# --- Generate local HTTPS certificate ---
CERTS_DIR="$PROJECT_DIR/.certs"
[[ -L "$PROJECT_DIR/.certs" ]] && CERTS_DIR="$PROJECT_DIR/.certs.nosync"
mkdir -p "$CERTS_DIR"

DEV_HOSTNAME="localhost"
if [[ -f "$CONFIG_FILE" ]] && grep -q "^DEV_HOSTNAME=" "$CONFIG_FILE" 2>/dev/null; then
    DEV_HOSTNAME=$(grep "^DEV_HOSTNAME=" "$CONFIG_FILE" | cut -d= -f2-)
fi

CERT_FILE="$CERTS_DIR/cert.pem"
KEY_FILE="$CERTS_DIR/key.pem"
HOSTNAME_FILE="$CERTS_DIR/.hostname"

if [[ ! -f "$CERT_FILE" ]] || [[ ! -f "$HOSTNAME_FILE" ]] || [[ "$(cat "$HOSTNAME_FILE" 2>/dev/null)" != "$DEV_HOSTNAME" ]]; then
    log "Generating HTTPS certificate for $DEV_HOSTNAME..."
    "$MKCERT_BIN" -cert-file "$CERT_FILE" -key-file "$KEY_FILE" \
        "$DEV_HOSTNAME" localhost 127.0.0.1 >> "$LOG" 2>&1 \
        || fail "Failed to generate certificate"
    echo "$DEV_HOSTNAME" > "$HOSTNAME_FILE"
    log "Certificate generated for $DEV_HOSTNAME."
else
    log "Certificate for $DEV_HOSTNAME already exists."
fi

# --- System changes requiring admin password ---
NEEDS_SUDO=false

if [[ "$DEV_HOSTNAME" != "localhost" ]]; then
    # Check /etc/hosts
    if ! grep -q "$DEV_HOSTNAME" /etc/hosts 2>/dev/null; then
        NEEDS_SUDO=true
    fi
fi

# Check pfctl anchor
PFCTL_ANCHOR="com.anglesite"
if [[ ! -f "/etc/pf.anchors/$PFCTL_ANCHOR" ]]; then
    NEEDS_SUDO=true
fi

if $NEEDS_SUDO; then
    log "Some setup steps need your Mac password (admin access)."
    log "Type your password below — nothing will appear as you type. Press Enter."
    sudo -v || fail "Admin access is required for local HTTPS setup"
fi

# --- /etc/hosts entry ---
if [[ "$DEV_HOSTNAME" != "localhost" ]]; then
    if ! grep -q "$DEV_HOSTNAME" /etc/hosts 2>/dev/null; then
        log "Adding $DEV_HOSTNAME to hosts file..."
        echo "127.0.0.1 $DEV_HOSTNAME" | sudo tee -a /etc/hosts >> "$LOG" 2>&1
        log "Hosts file updated."
    else
        log "$DEV_HOSTNAME already in hosts file."
    fi
fi

# --- pfctl port forwarding: 443 → 4321 ---
PFCTL_FILE="/etc/pf.anchors/$PFCTL_ANCHOR"
PFCTL_RULE="rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 4321"

if [[ ! -f "$PFCTL_FILE" ]]; then
    log "Setting up port forwarding (443 → 4321)..."
    sudo cp /etc/pf.conf /etc/pf.conf.anglesite-backup 2>/dev/null || true
    echo "$PFCTL_RULE" | sudo tee "$PFCTL_FILE" > /dev/null

    # Add anchor references to pf.conf if not present
    if ! sudo grep -q "$PFCTL_ANCHOR" /etc/pf.conf 2>/dev/null; then
        # Insert rdr-anchor after existing rdr-anchor lines, or before first rule
        sudo sed -i '' "/^rdr-anchor/a\\
rdr-anchor \"$PFCTL_ANCHOR\"" /etc/pf.conf 2>/dev/null \
            || echo "rdr-anchor \"$PFCTL_ANCHOR\"" | sudo tee -a /etc/pf.conf > /dev/null
        echo "load anchor \"$PFCTL_ANCHOR\" from \"/etc/pf.anchors/$PFCTL_ANCHOR\"" \
            | sudo tee -a /etc/pf.conf > /dev/null
    fi

    sudo pfctl -ef /etc/pf.conf >> "$LOG" 2>&1 || true
    log "Port forwarding configured."
else
    # Ensure rules are loaded (may have been lost after reboot)
    sudo pfctl -ef /etc/pf.conf >> "$LOG" 2>&1 || true
    log "Port forwarding already configured."
fi

# --- Git init ---
if [[ ! -d ".git" ]]; then
    log "Initializing git..."
    git init >> "$LOG" 2>&1
    git add -A >> "$LOG" 2>&1
    git commit -m "Initial setup" >> "$LOG" 2>&1
    log "Git initialized."
else
    log "Git already initialized."
fi

# --- Make scripts executable ---
chmod +x scripts/*.sh 2>/dev/null || true

# --- Write project directory to config ---
if [[ -f "$CONFIG_FILE" ]] && grep -q "^PROJECT_DIR=" "$CONFIG_FILE" 2>/dev/null; then
    sed -i '' "s|^PROJECT_DIR=.*|PROJECT_DIR=$PROJECT_DIR|" "$CONFIG_FILE"
else
    echo "PROJECT_DIR=$PROJECT_DIR" >> "$CONFIG_FILE"
fi
log "Project directory saved to .site-config"

log "✅ Setup complete!"
osascript -e 'display notification "Everything is installed and ready." with title "Site Setup Complete"'
