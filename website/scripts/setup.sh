#!/bin/zsh
# Pairadocs Farm — First-time setup
# Installs Node.js via fnm (no Homebrew needed), creates iCloud-safe
# symlinks, then npm install. Safe to rerun (idempotent).

# Re-exec under zsh if invoked with bash
if [ -z "${ZSH_VERSION-}" ]; then exec /bin/zsh "$0" "$@"; fi

set -euo pipefail

# Self-locate: derive project dir from this script's location
SCRIPT_DIR="${0:a:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
CONFIG_FILE="$PROJECT_DIR/.farm-config"
LOG_DIR="$HOME/.pairadocs/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/setup.log"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }
fail() { log "ERROR: $1"; osascript -e "display notification \"$1\" with title \"Setup Failed\""; exit 1; }

echo "" > "$LOG"
log "Starting Pairadocs Farm setup..."
log "Project directory: $PROJECT_DIR"

# --- Xcode Command Line Tools (includes git) ---
if ! xcode-select -p &>/dev/null; then
    log "Installing Xcode command line tools (includes Git)..."
    log "A macOS dialog will appear — click Install and wait for it to finish."
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
log "Project directory saved to .farm-config"

log "✅ Setup complete!"
osascript -e 'display notification "Everything is installed and ready." with title "Farm Site Setup Complete"'
