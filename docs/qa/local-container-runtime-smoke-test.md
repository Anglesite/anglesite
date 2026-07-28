# Local Container Runtime Manual Smoke Test

**Issues:** [#59](https://github.com/Anglesite/Anglesite/issues/59), [#69](https://github.com/Anglesite/Anglesite/issues/69)  
**Scope:** Phase 1 author smoke for `LocalContainerSiteRuntime` on macOS with Apple Containerization.  
**Target:** the `Anglesite` scheme — the single sandboxed Mac App Store target.

## Purpose

Verify the local container runtime can replace the host subprocess runtime for a real `.anglesite` site:

- Boot an Apple-Containerization Linux VM from the bundled/provisioned image artifacts.
- Clone the package's `Source/` repo into the guest.
- Start Astro and the app-owned MCP sidecar in the guest.
- Expose preview and MCP over host `127.0.0.1` ports through the vsock proxy.
- Route an `apply_edit` through the in-container MCP endpoint.
- Tear down the VM and proxies on window close.

This smoke intentionally exercises the real substrate. It is not expected to run on CI.

## Preconditions

- Apple Silicon Mac.
- macOS 26 or newer.
- Xcode 27 or newer.
- Docker Desktop or another Docker buildx-compatible runtime with `linux/arm64` support.
- A build signed with `Resources/Anglesite.entitlements` (any identity — the default ad-hoc
  Debug signing carries `com.apple.security.virtualization` and boots VMs; the entitlement is
  unrestricted).
- The sibling plugin checkout exists at `/Users/dwk/Developer/github.com/Anglesite/anglesite-skills`, or `ANGLESITE_PLUGIN_SRC` points at it.
- A test `.anglesite` package whose `Source/` directory is a git repo.

Docker is a build-time dependency only. `scripts/vendor-container-image.sh` uses Docker buildx to
produce a portable OCI image layout in `Resources/container-image/`. The app does not run Docker at
runtime; `ContainerizationControl` imports that OCI layout with Apple's Containerization APIs,
unpacks it to an ext4 rootfs, and boots it through `VZVirtualMachineManager`.

## Artifact Provisioning

`LiveSiteRuntimeFactory` selects `LocalContainerSiteRuntime` only when both conditions are true:

- `LocalContainerSupport.isAvailable(...)` passes.
- `BundledImage.isProvisioned` passes.

`BundledImage.isProvisioned` requires all three artifacts:

- `Resources/container-image/` contains an OCI layout with `index.json`.
- `Resources/container-kernel/vmlinux` exists.
- `Resources/container-initfs/` contains an OCI layout with `index.json`.

### Build The App Image

```sh
ANGLESITE_PLUGIN_SRC=/Users/dwk/Developer/github.com/Anglesite/anglesite-skills \
  ./scripts/vendor-container-image.sh
```

Expected:

- `Resources/container-image/oci-layout` exists.
- `Resources/container-image/index.json` exists.
- `Resources/container-image/blobs/sha256/` contains blobs.
- The image reference matches `docker.io/library/anglesite-dev:latest`.

### Vendor Kernel And Initfs

```sh
./scripts/vendor-container-kernel.sh
```

Expected:

- `Resources/container-kernel/vmlinux` exists and is larger than 1 MiB.
- `Resources/container-initfs/oci-layout` exists.
- `Resources/container-initfs/index.json` exists.
- `Resources/container-initfs/blobs/sha256/` contains blobs.

If you do not want to vendor artifacts into `Resources/` for a temporary smoke, use overrides:

```sh
export ANGLESITE_CONTAINER_IMAGE=/absolute/path/to/container-image
export ANGLESITE_CONTAINER_KERNEL=/absolute/path/to/vmlinux
export ANGLESITE_CONTAINER_INITFS=/absolute/path/to/container-initfs
```

## Build

Regenerate the project and build the app with the real plugin source:

```sh
xcodegen generate
env ANGLESITE_PLUGIN_SRC=/Users/dwk/Developer/github.com/Anglesite/anglesite-skills \
  xcodebuild -project Anglesite.xcodeproj -scheme Anglesite -configuration Debug build
```

For the boot smoke, use a signed run of the app that actually carries `com.apple.security.virtualization`. A `CODE_SIGNING_ALLOWED=NO` build only proves compilation; it cannot boot the VM.

## Smoke Matrix

| Case | Result | Notes |
|---|---|---|
| 1. Artifacts are provisioned |  |  |
| 2. App signature has virtualization entitlement |  |  |
| 3. Runtime selection chooses `LocalContainerSiteRuntime` |  |  |
| 4. VM boots and guest clone succeeds |  |  |
| 5. Preview loads through loopback proxy |  |  |
| 6. MCP connects through loopback proxy |  |  |
| 7. `apply_edit` writes through in-container sidecar |  |  |
| 8. Window close tears down VM/proxies/artifacts |  |  |
| 9. Unprovisioned or unentitled build selects `UnavailableSiteRuntime` (preview disabled, no host fallback) |  |  |

Use `PASS`, `FAIL`, or `N/A`, and explain any `N/A`.

## Test Cases

### 1. Verify Provisioned Artifacts

Run:

```sh
test -f Resources/container-image/index.json
test -f Resources/container-kernel/vmlinux
test -f Resources/container-initfs/index.json
```

Expected:

- All three commands exit 0.
- `BundledImage.isProvisioned` should be true in an app run with the same environment/bundle resources.

Fail if any artifact is missing or empty.

### 2. Verify Entitlement

Launch the app (ad-hoc Debug signing is fine) and confirm the runtime gate can see `com.apple.security.virtualization`.

Expected:

- `VirtualizationEntitlement.isPresent` is true for the running app.
- An unsigned or unentitled build does not select the container runtime.

Fail if the app is signed but the entitlement probe returns false.

### 3. Confirm Runtime Selection

1. Launch the signed app (ad-hoc Debug is fine) with provisioned artifacts.
2. Open a test `.anglesite` package.
3. Watch the debug pane during preview startup.

Expected:

- The preview runtime is `LocalContainerSiteRuntime`.
- The debug pane includes `runtime/stdout selected LocalContainerSiteRuntime`.
- There is no fallback to a host subprocess runtime once artifacts and entitlement are available.
- If artifacts or entitlement are deliberately removed, the app fails preview startup with the
  unavailable runtime message instead of starting host Node.
- Fallback logs include `runtime/stdout no host runtime fallback; local container unavailable: ...`
  with the failed host gate and/or missing artifact named (`container image`, `Linux kernel`, or
  `vminit initfs`).

Fail if the container runtime is selected when artifacts are missing, or if a host subprocess runtime
starts preview.

### 4. Boot VM And Clone Site

1. With the test site open, wait for startup.
2. Inspect debug output from `ContainerizationControl`.

Expected:

- Image import/unpack succeeds.
- Kernel/initfs load succeeds.
- VM/container create/start succeeds.
- Guest `git clone` of the host-shared `Source/` repo succeeds.
- Guest checkout of `HEAD` succeeds.

Fail if clone uses network instead of the host share, cannot see the repo, or leaves the runtime stuck in `.starting`.

### 5. Preview Through Loopback Proxy

1. Wait for the runtime to report ready.
2. Confirm the preview URL is loopback, for example `http://127.0.0.1:<port>`.
3. Interact with the preview.

Expected:

- WKWebView loads the site from a loopback proxy URL.
- The page renders normal Astro content.
- HMR/websocket behavior remains stable during a small source edit.

Fail if the preview uses a guest IP, exposes a non-loopback host, or hangs on first load.

### 6. MCP Through Loopback Proxy

1. Confirm the runtime returned an MCP URL ending in `/mcp`.
2. Trigger a content graph refresh or another MCP call that is safe to run.

Expected:

- `MCPClient` connects over HTTP to the loopback MCP proxy.
- The in-guest sidecar responds.
- Debug output distinguishes MCP startup/connect failures from Astro preview failures.

Fail if MCP is still using the host stdio/plugin path while the preview is container-backed.

### 7. `apply_edit` Round Trip

1. Open a simple page in the preview.
2. Use the app edit overlay or another app path that calls `apply_edit`.
3. Apply a harmless text edit.

Expected:

- The edit request reaches the in-container MCP sidecar.
- The file under the package's `Source/` changes.
- The preview refreshes to show the edit.
- The edit is logged in the debug pane and app edit history/chat surface when visible.

Fail if the write happens through the host plugin/runtime, changes the wrong file, or does not appear in the preview.

### 8. Teardown On Window Close

1. Record any running Virtualization/container processes before closing the site window.
2. Close the site window.
3. Wait a few seconds.
4. Check process list and temporary artifact locations.

Expected:

- The container stops.
- Both vsock proxies stop.
- Per-site ext4 artifacts are removed or accounted for.
- No orphaned `com.apple.Virtualization` process remains.

Fail if closing the window leaves a live VM, live proxy listener, or unbounded ext4 files.

### 9. Unavailable Path (no host fallback)

Run one negative-control pass:

- Missing artifacts, or
- Unentitled build.

Expected:

- The app selects `UnavailableSiteRuntime`. There is NO host-subprocess preview fallback (#69).
- The preview settles to the `.failed` state, showing the human-readable reason
  (`Local container runtime is required, but it is not available yet (<reasons>).`).
- The debug pane logs `runtime/stdout no host runtime fallback; local container unavailable:
  <reasons>` with the failed host gate and/or missing artifact named in the `; `-joined reasons.
- No host subprocess (npm dependency tree) is spawned to serve the preview.

Fail if the build spins up a host-subprocess preview, crashes instead of surfacing `.failed`, or
selects the container runtime when artifacts/entitlement are absent.

## Evidence To Record On #69

Record:

- Commit SHA and build scheme.
- macOS and Xcode versions.
- Signing identity/profile used.
- Whether artifacts came from bundled `Resources/` or env overrides.
- First boot wall-clock time.
- Subsequent boot wall-clock time, if different.
- Approximate memory footprint per live container.
- Preview URL shape.
- MCP URL shape.
- `apply_edit` result.
- Teardown result.
- Any failure logs and follow-up issue numbers.

## Closeout Criteria For #69 Local Smoke

The local runtime smoke is complete when:

- The signed app selects `LocalContainerSiteRuntime` with provisioned artifacts.
- Preview and MCP both run through loopback vsock proxies.
- `apply_edit` writes through the in-container sidecar.
- Window close tears down the VM/proxies.
- A build without artifacts or entitlement settles to `UnavailableSiteRuntime` (preview `.failed`
  with reasons), with no host-subprocess preview fallback (#69).
