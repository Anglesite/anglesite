import AnglesiteCore
import Foundation

/// Sentinel for `Bundle(for:)`-based resource-bundle discovery (no NSObject subclass needed elsewhere).
private final class BundleToken {}

/// Resolves the vendored boot artifacts that ship inside AnglesiteContainer's resource bundle.
///
/// The arm64 OCI app layout (`Resources/container-image/`, copied in via Package.swift, vendored by
/// `scripts/vendor-container-image.sh`) is paired with the boot artifacts produced by
/// `scripts/vendor-container-kernel.sh`: a **Linux kernel binary** and a **vminit initfs** OCI
/// layout. Each artifact can also be overridden with an env var for local bring-up, but the bundled
/// resource path is the normal provisioning path.
///
/// Settings/dev overrides (mirroring `TemplateRuntime`'s dev override) let a developer point each
/// artifact at a freshly-built copy without rebuilding the app.
public enum BundledImage {
    /// The AnglesiteContainer resource bundle.
    ///
    /// We can't use the SwiftPM-generated `Bundle.module`: under the `swiftbuild` build system
    /// (the SwiftPM default since Swift 6.x, and what CI's `swift test` uses) the generated accessor
    /// is compiled out (`SWIFT_MODULE_RESOURCE_BUNDLE_UNAVAILABLE`) and `Bundle.module` is internal +
    /// unavailable, so referencing it fails to compile. Instead we locate the conventionally-named
    /// `Anglesite_AnglesiteContainer.bundle` next to the loaded module/executable — robust across both
    /// the `native` and `swiftbuild` systems and the final `.app`. Override the whole layout with
    /// `ANGLESITE_CONTAINER_IMAGE` to skip bundle lookup entirely.
    static var resourceBundle: Bundle? {
        let bundleName = "Anglesite_AnglesiteContainer.bundle"
        var candidates: [URL] = []
        // Alongside the loader's bundle (the .app's framework dir, or the test bundle).
        let host = Bundle(for: BundleToken.self).bundleURL
        candidates.append(host.deletingLastPathComponent())
        candidates.append(host)
        // Alongside the main executable (xctest / CLI).
        candidates.append(Bundle.main.bundleURL)
        candidates.append(Bundle.main.bundleURL.deletingLastPathComponent())
        // Inside a real .app's Contents/Resources/ — where SwiftPM-generated resource bundles
        // actually land for a statically-linked target (Bundle(for:).bundleURL above resolves to
        // Bundle.main itself in that case, never Contents/Resources, so none of the candidates
        // above match without this).
        if let resourceURL = Bundle.main.resourceURL {
            candidates.append(resourceURL)
        }
        for base in candidates {
            let url = base.appendingPathComponent(bundleName)
            if let b = Bundle(url: url) { return b }
        }
        return nil
    }

    /// The on-disk OCI layout (`oci-layout` + `index.json` + `blobs/`) for the Anglesite dev image.
    /// Override with `ANGLESITE_CONTAINER_IMAGE`.
    ///
    /// `throws` (mirroring `kernelURL()`/`initfsLayoutURL()`) rather than `fatalError`-ing: a missing
    /// bundle is a recoverable provisioning gap that `start()` surfaces as `imageUnavailable`, not a
    /// crash. Resolved inside `start()` (not in `init`) so constructing the type can never trap.
    public static func layoutURL() throws -> URL {
        if let override = ProcessInfo.processInfo.environment["ANGLESITE_CONTAINER_IMAGE"] {
            let url = URL(fileURLWithPath: override)
            if FileManager.default.fileExists(atPath: url.appendingPathComponent("index.json").path) {
                return url
            }
            throw BundledImageError.imageLayoutNotProvisioned
        }
        // The `.copy` rule always bundles the `container-image/` dir (with its `.gitkeep`) even when
        // the image isn't vendored, so resolving the dir is not enough — verify the OCI layout's
        // `index.json` is actually present (mirrors `initfsLayoutURL()`), else `isProvisioned` would
        // spuriously report ready and select the container runtime without an image.
        if let dirURL = resourceBundle?.url(forResource: "container-image", withExtension: nil) {
            let indexURL = dirURL.appendingPathComponent("index.json")
            if FileManager.default.fileExists(atPath: indexURL.path) {
                return dirURL
            }
        }
        throw BundledImageError.imageLayoutNotProvisioned
    }

    /// The reference under which the imported app image is addressed in the on-disk `ImageStore`.
    /// Apple `container image save` (scripts/vendor-container-image.sh) records the reference
    /// unqualified — `anglesite-dev:latest`, not Docker buildx's `docker.io/library/…` canonical
    /// form — in the layout's `io.containerd.image.name` annotation. This constant must match
    /// that recorded form exactly so `ImageStore.get(reference:)` finds the image after
    /// `load(from:)`.
    public static let imageReference = "anglesite-dev:latest"

    /// Path to the Linux kernel binary the VM boots.
    ///
    /// Vendored by `scripts/vendor-container-kernel.sh` into `Resources/container-kernel/vmlinux`.
    /// The bundled-resource branch checks that `vmlinux` actually exists inside the directory before
    /// returning it — otherwise `isProvisioned` would spuriously return `true` on an unvendored build
    /// (the `.copy` rule always bundles the `.gitkeep`-containing dir even when vmlinux is absent).
    /// Override with `ANGLESITE_CONTAINER_KERNEL` to point at a freshly-built kernel for local dev.
    public static func kernelURL() throws -> URL {
        if let override = ProcessInfo.processInfo.environment["ANGLESITE_CONTAINER_KERNEL"] {
            let url = URL(fileURLWithPath: override)
            if FileManager.default.fileExists(atPath: url.path) {
                return url
            }
            throw BundledImageError.kernelNotProvisioned
        }
        if let dirURL = resourceBundle?.url(forResource: "container-kernel", withExtension: nil) {
            let kernelURL = dirURL.appendingPathComponent("vmlinux")
            if FileManager.default.fileExists(atPath: kernelURL.path) {
                return kernelURL
            }
        }
        throw BundledImageError.kernelNotProvisioned
    }

    /// Path to the vminit initfs OCI layout (the guest-agent root filesystem the VM mounts first).
    ///
    /// Vendored by `scripts/vendor-container-kernel.sh` into `Resources/container-initfs/` as an
    /// OCI image layout. The bundled-resource branch checks that `index.json` exists inside the
    /// directory before returning it — the `.copy` rule always bundles the `.gitkeep`-containing dir
    /// even when the layout blobs are absent, so we must verify the real artifact is present.
    /// Override with `ANGLESITE_CONTAINER_INITFS` to point at a different layout for local dev.
    public static func initfsLayoutURL() throws -> URL {
        if let override = ProcessInfo.processInfo.environment["ANGLESITE_CONTAINER_INITFS"] {
            let url = URL(fileURLWithPath: override)
            if FileManager.default.fileExists(atPath: url.appendingPathComponent("index.json").path) {
                return url
            }
            throw BundledImageError.initfsNotProvisioned
        }
        if let dirURL = resourceBundle?.url(forResource: "container-initfs", withExtension: nil) {
            let indexURL = dirURL.appendingPathComponent("index.json")
            if FileManager.default.fileExists(atPath: indexURL.path) {
                return dirURL
            }
        }
        throw BundledImageError.initfsNotProvisioned
    }

    /// True only when the container can actually boot: the app OCI image (`layoutURL()`), the
    /// `kernelURL()`, and the `initfsLayoutURL()` all resolve without throwing. Returns false when any
    /// of them is absent and no env override is set — keeping `PreviewModel` on the host
    /// runtime until provisioning is complete, so `ContainerizationControl` is never selected in a
    /// state where `start()` would fail with `.imageUnavailable`.
    public static var isProvisioned: Bool {
        provisioningReport.isProvisioned
    }

    /// Per-artifact provisioning breakdown behind ``isProvisioned`` — resolves each of the three
    /// bundled artifacts and captures the failure reason for any that's missing, so settings/debug
    /// UI can say *which* artifact is absent instead of a bare "not provisioned".
    public static var provisioningReport: BundledImageProvisioningReport {
        BundledImageProvisioningReport(
            image: artifactStatus { try layoutURL() },
            kernel: artifactStatus { try kernelURL() },
            initfs: artifactStatus { try initfsLayoutURL() }
        )
    }

    private static func artifactStatus(_ resolve: () throws -> URL) -> BundledImageArtifactStatus {
        do {
            return .provisioned(path: try resolve().path)
        } catch {
            return .missing(reason: "\(error)")
        }
    }

    /// A writable directory for the on-disk `ImageStore` (content store + unpacked ext4 rootfs).
    /// `ImageStore`/`EXT4Unpacker` need a writable scratch path; the read-only app bundle can't host it.
    /// Override with `ANGLESITE_CONTAINER_STORE`; defaults under the app's Application Support.
    public static func storeURL() throws -> URL {
        if let override = ProcessInfo.processInfo.environment["ANGLESITE_CONTAINER_STORE"] {
            return URL(fileURLWithPath: override)
        }
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let dir = base.appendingPathComponent("Anglesite/container-store", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Stages a (possibly read-only, bundle-hosted) OCI layout into a writable directory.
    ///
    /// `ImageStore.load(from:)` writes ingest-tracking files (e.g. `ingest/`) directly inside the
    /// layout directory it reads from — not just into the destination store — so passing the
    /// bundled `layoutURL()`/`initfsLayoutURL()` straight in fails with EPERM on a real, read-only
    /// `.app`. `name` identifies the artifact (e.g. "app-image", "vminit-initfs") and namespaces its
    /// staged copy under `storeURL()` so repeated launches reuse it instead of re-copying every time.
    /// A staged copy whose `index.json` no longer matches the source's (an app update shipped a new
    /// bundled image) is replaced, so installs never keep booting a stale image.
    ///
    /// Implemented by `OCILayoutStaging` in AnglesiteCore (pure Foundation) so the staging/staleness
    /// behavior stays unit-tested on CI, which never compiles this module.
    public static func stagedLayoutURL(source: URL, name: String) throws -> URL {
        try OCILayoutStaging.stagedLayoutURL(source: source, name: name, storeRoot: storeURL())
    }
}

/// A bundled container artifact failed to resolve — the app was built without the vendored
/// container resources (see `scripts/vendor-container-image.sh`) and no env override points at a
/// local copy.
public enum BundledImageError: Error, Equatable {
    /// The OCI app layout is not vendored and no `ANGLESITE_CONTAINER_IMAGE` override was set.
    case imageLayoutNotProvisioned
    /// The Linux kernel binary is not vendored and no `ANGLESITE_CONTAINER_KERNEL` override was set.
    case kernelNotProvisioned
    /// The vminit initfs is not vendored and no `ANGLESITE_CONTAINER_INITFS` override was set.
    case initfsNotProvisioned
}

/// Resolution status of all three bundled artifacts the container runtime needs to boot
/// (see ``BundledImage/provisioningReport``).
public struct BundledImageProvisioningReport: Sendable, Equatable {
    /// Status of the app OCI image layout.
    public let image: BundledImageArtifactStatus
    /// Status of the Linux kernel binary.
    public let kernel: BundledImageArtifactStatus
    /// Status of the vminit initfs layout.
    public let initfs: BundledImageArtifactStatus

    /// `true` only when all three artifacts resolved — the condition under which
    /// `ContainerizationControl.start()` can succeed.
    public var isProvisioned: Bool {
        image.isProvisioned && kernel.isProvisioned && initfs.isProvisioned
    }

    /// Human-readable "label: reason" lines for each missing artifact (empty when fully
    /// provisioned) — ready for direct display in debug/settings UI.
    public var missingDescriptions: [String] {
        [
            image.missingDescription(label: "container image"),
            kernel.missingDescription(label: "Linux kernel"),
            initfs.missingDescription(label: "vminit initfs")
        ].compactMap { $0 }
    }
}

/// Resolution outcome for one bundled artifact.
public enum BundledImageArtifactStatus: Sendable, Equatable {
    /// The artifact resolved; carries the path it resolved to (bundle resource or env override).
    case provisioned(path: String)
    /// The artifact didn't resolve; carries the thrown error's description as the reason.
    case missing(reason: String)

    /// `true` for ``provisioned(path:)``.
    public var isProvisioned: Bool {
        if case .provisioned = self { true } else { false }
    }

    fileprivate func missingDescription(label: String) -> String? {
        guard case .missing(let reason) = self else { return nil }
        return "\(label): \(reason)"
    }
}
