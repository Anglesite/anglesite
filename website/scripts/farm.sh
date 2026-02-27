#!/bin/zsh
# Pairadocs Farm — task menu
# Called by the app launcher after first-run checks pass.

# Re-exec under zsh if invoked with bash
if [ -z "${ZSH_VERSION-}" ]; then exec /bin/zsh "$0" "$@"; fi

set -uo pipefail

# Self-locate: derive project dir from this script's location
SCRIPT_DIR="${0:a:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
CONFIG_FILE="$PROJECT_DIR/.farm-config"
LOG_DIR="$HOME/.pairadocs/logs"
mkdir -p "$LOG_DIR"
PORT=4321
LIVE_URL="https://www.pairadocs.farm"
ANALYTICS_URL="https://dash.cloudflare.com/?to=/:account/web-analytics"

# Ensure fnm/Node is in PATH
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env --shell zsh 2>/dev/null)" || true

# --- Read config ---
read_config() {
    local key="$1"
    if [[ -f "$CONFIG_FILE" ]]; then
        grep "^${key}=" "$CONFIG_FILE" 2>/dev/null | head -1 | cut -d'=' -f2-
    fi
}

# --- Write config ---
write_config() {
    local key="$1"
    local value="$2"
    if [[ -f "$CONFIG_FILE" ]] && grep -q "^${key}=" "$CONFIG_FILE" 2>/dev/null; then
        sed -i '' "s|^${key}=.*|${key}=${value}|" "$CONFIG_FILE"
    else
        echo "${key}=${value}" >> "$CONFIG_FILE"
    fi
}

# --- Keep PROJECT_DIR in config accurate ---
STORED_DIR=$(read_config "PROJECT_DIR")
if [[ -n "$STORED_DIR" && "$STORED_DIR" != "$PROJECT_DIR" ]]; then
    write_config "PROJECT_DIR" "$PROJECT_DIR"
fi

# --- Show menu ---
CHOICE=$(osascript -e '
choose from list {"🌱  Start Local Server", "🛑  Stop Local Server", "✏️  Edit Posts", "📤  Publish to Farm", "🔍  Check Farm Site", "📊  View Analytics", "🗂️  Open Airtable", "🌐  View Live Website", "🤖  Chat with Webmaster"} with title "Pairadocs Farm" with prompt "What would you like to do?"
')

# User cancelled
[[ "$CHOICE" == "false" ]] && exit 0

cd "$PROJECT_DIR" || {
    osascript -e 'display notification "Project folder not found." with title "Farm Site Error"'
    exit 1
}

# --- Helper: start dev server if not running, wait for ready ---
ensure_dev_server() {
    if lsof -i :"$PORT" &>/dev/null; then
        return 0
    fi
    npm run dev >> "$LOG_DIR/dev.log" 2>&1 &
    local attempts=0
    while ! curl -s "http://localhost:$PORT" > /dev/null 2>&1; do
        sleep 1
        attempts=$((attempts + 1))
        if [[ $attempts -ge 30 ]]; then
            osascript -e 'display notification "Dev server did not start in time. Ask your Webmaster." with title "Farm Site Error"'
            return 1
        fi
    done
}

# --- Actions ---
case "$CHOICE" in

*"Start Local Server"*)
    if lsof -i :"$PORT" &>/dev/null; then
        osascript -e 'display notification "Already running." with title "🌱 Local Server"'
        open "http://localhost:$PORT"
    else
        ensure_dev_server && {
            open "http://localhost:$PORT"
            osascript -e 'display notification "Running at localhost:4321" with title "🌱 Local Server Started"'
        }
    fi
    ;;

*"Stop Local Server"*)
    PID=$(lsof -ti :"$PORT" 2>/dev/null)
    if [[ -z "$PID" ]]; then
        osascript -e 'display notification "Local server is not running." with title "🛑 Local Server"'
    else
        kill "$PID" 2>/dev/null
        sleep 2
        lsof -ti :"$PORT" &>/dev/null && kill -9 $(lsof -ti :"$PORT") 2>/dev/null
        osascript -e 'display notification "Local server stopped." with title "🛑 Local Server Stopped"'
    fi
    ;;

*"Edit Posts"*)
    ensure_dev_server && {
        open "http://localhost:$PORT/keystatic/collection/posts"
        osascript -e 'display notification "Blog editor is ready." with title "✏️ Edit Posts"'
    }
    ;;

*"Publish to Farm"*)
    BUILD_LOG="$LOG_DIR/build.log"
    DEPLOY_LOG="$LOG_DIR/deploy.log"

    osascript -e 'display notification "Building site..." with title "📤 Publishing"'

    if ! npm run build >> "$BUILD_LOG" 2>&1; then
        osascript -e 'display notification "Build failed. Ask your Webmaster." with title "📤 Publish Failed"'
        exit 1
    fi

    if ! npx wrangler pages deploy dist/ --project-name pairadocs-farm >> "$DEPLOY_LOG" 2>&1; then
        osascript -e 'display notification "Deploy failed. Ask your Webmaster." with title "📤 Publish Failed"'
        exit 1
    fi

    TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
    git add -A -- ':!.env' ':!.env.*' 2>/dev/null
    git commit -m "Publish: $TIMESTAMP" --allow-empty 2>/dev/null

    osascript -e 'display notification "Site is live! Changes appear in about a minute." with title "📤 Published to Farm"'
    ;;

*"Check Farm Site"*)
    CHECK_LOG="$LOG_DIR/check.log"
    FAILED=0

    osascript -e 'display notification "Running checks..." with title "🔍 Checking"'

    echo "=== astro check ===" > "$CHECK_LOG"
    npx astro check >> "$CHECK_LOG" 2>&1 || FAILED=1

    echo "=== npm run build ===" >> "$CHECK_LOG"
    npm run build >> "$CHECK_LOG" 2>&1 || FAILED=1

    if [[ $FAILED -eq 0 ]]; then
        osascript -e 'display notification "All checks passed." with title "🔍 Farm Site OK"'
    else
        osascript -e 'display notification "Some checks failed. Ask your Webmaster." with title "🔍 Check Failed"'
    fi
    ;;

*"View Analytics"*)
    open "$ANALYTICS_URL"
    ;;

*"Open Airtable"*)
    AIRTABLE_URL=$(read_config "AIRTABLE_BASE_URL")
    if [[ -n "$AIRTABLE_URL" ]]; then
        open "$AIRTABLE_URL"
    else
        osascript -e '
        display dialog "Airtable is not set up yet.

Open your Webmaster in Claude and type:
/setup-airtable" buttons {"OK"} default button 1 with title "Airtable Setup Needed"
        '
        open "$PROJECT_DIR"
    fi
    ;;

*"View Live Website"*)
    open "$LIVE_URL"
    ;;

*"Chat with Webmaster"*)
    open "$PROJECT_DIR"
    osascript -e '
    display dialog "Open your Webmaster:

1. Open the Claude app
2. Click the Code tab (</> icon)
3. Open the \"Pairadocs Farm\" project
   (the folder is now open in Finder)" buttons {"OK"} default button 1 with title "Chat with Webmaster"
    '
    ;;

esac
