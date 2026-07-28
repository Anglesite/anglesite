# Cloudflare Sandbox Image Pipeline

This lowercase `container/` directory is **not** the active macOS runtime image
source.

The active Apple Containerization image lives in
[`../Containers/anglesite-dev/`](../Containers/anglesite-dev/) and is vendored
into the app bundle by [`../scripts/vendor-container-image.sh`](../scripts/vendor-container-image.sh).
Docker/buildx is used there only to manufacture an OCI root filesystem; macOS
runtime execution is Apple's Containerization framework, not Docker.

This directory is retained for the Cloudflare Sandbox / remote-runtime image
pipeline from issue [#62](https://github.com/Anglesite/Anglesite/issues/62):
a canonical dev-server image plus the Cloudflare-specific wrapper
[`Dockerfile.cloudflare`](Dockerfile.cloudflare). It is future-facing for
`RemoteSandboxSiteRuntime` / iOS and spike work, not the source of
`Resources/container-image/`.

Original design intent: one behavior-defining OCI image, with substrate-specific
packaging where needed. The Astro dev server and the MCP sidecar run
inside the Linux container so the dev server behaves consistently:

| Substrate | Current source |
|---|---|
| **Apple Containerization** (local macOS) | `../Containers/anglesite-dev/`, vendored into the app bundle |
| **Cloudflare Sandbox** (remote / iOS) | this directory, extended via [`Dockerfile.cloudflare`](Dockerfile.cloudflare) |

This realizes the [design doc](../docs/specs/2026-05-30-cloudflare-sandbox-dev-server-design.md) §0 ("platform-split, one container image") and answers follow-up **Q-D** (image distribution).

## What's in the image

- **Node**, pinned to [`scripts/node-version.txt`](../scripts/node-version.txt) (passed as `NODE_VERSION` at build).
- **`git`** — Git is the source of truth (design §3.1 option A); the container clones the site on start, edits commit/push. No host-share, no embedded Node.
- **The Astro / site toolchain**, pre-installed from the app template's lockfile (`@opt/anglesite/baked`).
- **The MCP sidecar runtime** — `server/*.mjs` plus its production deps, baked at `/opt/anglesite/mcp-sidecar` (`ANGLESITE_MCP_ENTRY`).
- **`tini`** as PID 1 for signal/zombie reaping.

Defaults to **`linux/arm64`** for historical/local builds. Cloudflare Sandbox is
currently **`linux/amd64`**, so build with `PLATFORM=linux/amd64` or push a
multi-arch manifest when exercising this remote path.

## Pre-baked dependencies (skip `npm ci` on cold start)

Design decision **#5b**: cold starts must not pay for `npm ci`. At build time the template's full dependency closure is installed once, which:

1. **warms the npm cache** (`/opt/anglesite/npm-cache`) for any cloned site, and
2. keeps the resolved **`node_modules`** at `/opt/anglesite/baked`.

On start, [`hydrate.sh`](hydrate.sh) installs the cloned site's deps the fastest way available:

- lockfile **identical** to the baked template → hardlink the baked `node_modules` (**zero install** — the common case for template-derived sites);
- otherwise → `npm ci --prefer-offline` against the warm cache.

## Build

```sh
# Build + load the Cloudflare/shared image locally. This is not the app-bundled
# macOS image; use ../scripts/vendor-container-image.sh for that.
scripts/build-container-image.sh

# Build + push to the registry by digest, and print the digest to pin.
scripts/build-container-image.sh --push
```

Env overrides: `IMAGE_REPO` (default `ghcr.io/anglesite/anglesite-devserver`), `IMAGE_TAG` (default `dev`), and `ANGLESITE_SIDECAR_SRC` (default `../anglesite`; `ANGLESITE_PLUGIN_SRC` remains a compatibility alias).

The script stages a clean build context (MCP sidecar + template manifests + helper scripts), so the `Dockerfile` is **not** buildable on its own — build through the script.

## Runtime contract

The default `ENTRYPOINT` ([`entrypoint.sh`](entrypoint.sh)) hydrates then execs the CMD; substrates may override either:

| Variable | Purpose |
|---|---|
| `ANGLESITE_GIT_URL` | repo to clone into `$SITE_DIR` when it's empty |
| `ANGLESITE_GIT_REF` | branch/tag/sha to check out after clone |
| `SITE_DIR` | working tree (default `/workspace`) |
| `PORT` | Astro dev port (default `4321`) |
| `ANGLESITE_MCP_ENTRY` | path to the baked MCP server entry |

The default CMD ([`start-dev-server.sh`](start-dev-server.sh)) runs `astro dev` bound to `0.0.0.0`. The network-reachable MCP server starts here once the sidecar grows an HTTP/SSE transport and the remote runtime wires its matching HTTP transport; until then the MCP runtime is baked in and started over stdio by the runtime layer.

## Distribution decision (Q-D)

**Build and push by digest for the Cloudflare remote path.**

- The Cloudflare/shared image is pushed to a registry (default GHCR). For reproducibility, pin the **base image by digest** and consume the **resulting image by digest** — not by floating tag.
- **Apple Containerization** no longer consumes this lowercase path in the app. It uses the vendored OCI layout produced from `../Containers/anglesite-dev/`.
- **Cloudflare Sandbox** can't run the base image entirely unmodified: the Sandbox SDK needs its standalone init binary in the image. [`Dockerfile.cloudflare`](Dockerfile.cloudflare) `FROM`s the base image (by digest) and adds **only** that binary. Cloudflare builds/pushes this thin wrapper to its own registry at `wrangler deploy`; the exact init source pin is finalized by the Cloudflare spike (#61).

This keeps the *behavior-defining* layers (Node, git, Astro toolchain, MCP sidecar, baked deps) reusable for the remote substrate while keeping the active macOS image source unambiguous.
