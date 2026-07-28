#!/usr/bin/env bash
# Shared staging step for scripts that build Containers/anglesite-dev/Dockerfile (the app's
# local dev-server image), whichever tool builds it (Apple `container` CLI or podman).
#
# Stages the MCP sidecar (from the sibling Anglesite plugin repo) and the website template's dependency
# manifests into the build context, and registers a cleanup trap so the staged, gitignored
# copies don't linger after the build. Source this file, then call stage_dev_image_context "$CTX".
#
# The EXIT trap it registers runs in the *caller's* shell (this function is sourced, not
# subshelled) and overwrites any EXIT trap already set there — fine today since both callers
# invoke this exactly once and set no other EXIT trap, but worth remembering if a future caller
# needs its own EXIT cleanup too.

stage_dev_image_context() {
    local ctx="$1"
    local root
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

    # Honor $ANGLESITE_SIDECAR_SRC for the MCP-server source boundary. The sibling
    # checkout remains the published Anglesite plugin; ANGLESITE_PLUGIN_SRC remains
    # a compatibility alias for existing local development environments.
    local default_sidecar_src="$(cd "$root/.." && pwd)/anglesite"
    local sidecar_src="${ANGLESITE_SIDECAR_SRC:-${ANGLESITE_PLUGIN_SRC:-$default_sidecar_src}}"

    if [[ ! -d "$sidecar_src" ]]; then
        echo "ERROR: MCP sidecar source not found at $sidecar_src" >&2
        echo "       Set ANGLESITE_SIDECAR_SRC or clone github.com/Anglesite/anglesite-skills as a sibling." >&2
        exit 1
    fi
    if [[ ! -f "$sidecar_src/server/index.mjs" || ! -f "$sidecar_src/package.json" ]]; then
        echo "ERROR: $sidecar_src does not look like an Anglesite MCP sidecar" >&2
        echo "       Expected server/index.mjs and package.json." >&2
        exit 1
    fi

    local sidecar_stage="$ctx/mcp-sidecar"
    echo "Staging MCP sidecar from $sidecar_src → $sidecar_stage"
    rm -rf "$sidecar_stage"
    mkdir -p "$sidecar_stage"

    # Copy the sidecar's server/ directory + package manifests (no node_modules, no .git).
    rsync -a --delete \
        --exclude='node_modules/' \
        --exclude='.git/' \
        "$sidecar_src/server/" "$sidecar_stage/server/"
    cp "$sidecar_src/package.json" "$sidecar_stage/"
    cp "$sidecar_src/package-lock.json" "$sidecar_stage/"

    echo "Sidecar staged: $(ls "$sidecar_stage")"

    # Stage the website template's dependency manifests + the hydrate script into the build
    # context, so the image can bake the template's full node_modules (design §5b, same pattern
    # as container/Dockerfile). hydrate.sh is shared with the Cloudflare image —
    # container/hydrate.sh is the single source.
    local template_stage="$ctx/template"
    echo "Staging template manifests from $root/Resources/Template → $template_stage"
    rm -rf "$template_stage"
    mkdir -p "$template_stage"
    cp "$root/Resources/Template/package.json" "$template_stage/"
    cp "$root/Resources/Template/package-lock.json" "$template_stage/"
    cp "$root/container/hydrate.sh" "$ctx/hydrate.sh"

    # Clean up the staged sidecar + template + hydrate script on exit (success or failure) so
    # they don't accumulate in the build context. These are gitignored. The trap body is built
    # as a string with the paths substituted now — `local`s go out of scope with this function's
    # stack frame, so a trap naming them by variable (rather than value) would see them unbound
    # by the time EXIT actually fires.
    trap "rm -rf '$sidecar_stage' '$template_stage' '$ctx/hydrate.sh'" EXIT
}
