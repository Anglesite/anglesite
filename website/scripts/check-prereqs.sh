#!/bin/zsh
# Pairadocs Farm — prerequisite check
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
for name in node_modules dist .astro .wrangler; do
    if [[ -L "$PROJECT_DIR/$name" && -d "$PROJECT_DIR/${name}.nosync" ]]; then
        echo "nosync_${name}=ok"
    elif [[ -d "$PROJECT_DIR/${name}.nosync" ]]; then
        echo "nosync_${name}=dir_only (symlink missing)"
    else
        echo "nosync_${name}=missing"
    fi
done
