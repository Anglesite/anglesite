// swift-tools-version: 5.10
import PackageDescription
import Foundation

// The macOS app target itself is owned by Anglesite.xcodeproj (generated from
// project.yml via XcodeGen). This package exposes the supporting libraries
// that the app target links against, and drives CI via `swift test`.

// Step 1 of the Swift 6 migration: surface every data-race / isolation issue
// as a warning under Swift 5 mode. Once the tree is clean, flip these targets
// to the Swift 6 language mode (errors) by bumping swift-tools-version.
let strictConcurrency: [SwiftSetting] = [
    .enableUpcomingFeature("StrictConcurrency")
]

// #541: an Xcode 27 beta SDK can add symbols (e.g. FoundationModels' `Attachment(imageURL:orientation:)`)
// that the installed macOS 27 beta seed doesn't yet export. Without this, dyld aborts at process
// launch for *any* binary that transitively links AnglesiteCore — including every `swift test`
// bundle — since the missing symbol is resolved eagerly at load time. Weak-linking the framework
// defers that resolution: the binary launches, and only the (narrow, vision-only) code path that
// actually calls the missing symbol would fail if invoked on a mismatched OS/SDK pair.
// `.when(platforms: [.macOS])`: `-weak_framework` is a Darwin ld option — ld.gold on the Linux
// CI leg rejects it, and AnglesiteBridgeCoreTests (which carries this setting) is in the
// off-Darwin portable target set, so the flag must never reach a non-Darwin link.
let weakLinkFoundationModels: [LinkerSetting] = [
    .unsafeFlags(
        ["-Xlinker", "-weak_framework", "-Xlinker", "FoundationModels"],
        .when(platforms: [.macOS])
    )
]

// Anywhere runtime (#1208): stasel/WebRTC vends a real dynamic .xcframework (unlike the
// source packages above), and SwiftPM's build system places its resolved WebRTC.framework
// directly in .build/<config>/Products/<config>/ — a *sibling* of a flat executable product,
// but three directories above an .xctest bundle's actual Mach-O (…/Foo.xctest/Contents/MacOS/Foo).
// A flat executable's default @loader_path rpath already reaches that directory, so
// anglesite-p2p-demo needs no extra help; an .xctest bundle's rpaths (@loader_path,
// @loader_path/../Frameworks, and an empty PackageFrameworks/) never do, so dyld fails to
// find @rpath/WebRTC.framework/WebRTC at test-run time without this. Adding the matching
// relative rpath here keeps the fix in Package.swift (portable across machines/CI) rather
// than a manual symlink into the gitignored .build directory.
let webRTCTestRPath: [LinkerSetting] = [
    .unsafeFlags(
        ["-Xlinker", "-rpath", "-Xlinker", "@loader_path/../../.."],
        .when(platforms: [.macOS])
    )
]

// AnglesiteCore and AnglesiteAppCore (ChatView.swift) `import` FoundationModels. Swift embeds a *hard*
// `-framework FoundationModels` autolink hint in its compiled object code, which wins over the
// app target's explicit `-weak_framework FoundationModels` (project.yml) when the final app
// binary is linked — so the app still hard-links FoundationModels despite that flag. Disabling
// the autolink hint at the source makes the app target's weak-link flag the only (and effective)
// link request. See #541.
let disableFoundationModelsAutolink: [SwiftSetting] = [
    .unsafeFlags(["-Xfrontend", "-disable-autolink-framework", "-Xfrontend", "FoundationModels"])
]

// AnglesiteContainer imports apple/containerization — a Swift 6.2, macOS-15+ package that pulls in
// the native NIO/gRPC/protobuf graph and only links on Apple-Silicon machines with the
// virtualization entitlement. `swift build` / `swift test` compile ALL of a package's products, so
// an *unconditional* AnglesiteContainer product would force CI's macos-15 runner to compile that
// whole graph (slow, and it can't run there anyway). The target/product/dependency are therefore
// included BY DEFAULT — so the Xcode app build, which evaluates this manifest without being able to
// inject env, gets the product to link — and dropped only when ANGLESITE_SKIP_CONTAINER=1, which
// CI sets at the workflow level. The virtualization entitlement, not this flag, gates the runtime
// at launch (see the #69 design §3 / §2.6).
#if canImport(Darwin)
let includeContainer = ProcessInfo.processInfo.environment["ANGLESITE_SKIP_CONTAINER"] != "1"
#else
// Apple Containerization is the macOS substrate; off-Darwin platforms get their own
// SiteRuntime implementations (cross-platform port design §7), so the container target —
// and its apple/containerization dependency — never enter the manifest there.
let includeContainer = false
#endif

// AnglesiteIntentsTests is conditionally included only on Swift 6.4+ (Xcode 27).
// The test binary loads `AnglesiteIntents` whose AppIntent metadata references
// `AppIntent.supportedModes` — a macOS 26+ symbol not present on the macOS 15
// runtime of GH's `macos-15` runner (which currently caps at Xcode 26.3).
// Locally on Xcode 27 the tests build + run normally; on the older toolchain
// we drop them so `swift test` still passes. Tracking removal in #128.
// SwiftGit2 (Anglesite's patched fork — see #640) is Darwin-only: it has no Linux platform
// entry, and the App Sandbox problem it solves doesn't exist off-macOS in the first place.
// GitInitRunner/NativeContentOperations keep the plain subprocess-git path as their
// #if !canImport(Darwin) branch, which is correct there, not just a fallback.
var anglesiteCoreDependencies: [Target.Dependency] = ["AnglesiteSiteModel"]
#if canImport(Darwin)
anglesiteCoreDependencies.append(.product(name: "SwiftGit2", package: "SwiftGit2"))
#endif

// RepoRelocatorTests (#877) verifies migrated gitfiles resolve via libgit2 directly
// (Repository.at), matching the InProcessGitTests cross-check style — so the test target
// needs the same Darwin-only SwiftGit2 dependency as AnglesiteCore itself.
var anglesiteCoreTestsDependencies: [Target.Dependency] = ["AnglesiteCore", "AnglesiteSiteModel", "AnglesiteTestSupport"]
#if canImport(Darwin)
anglesiteCoreTestsDependencies.append(.product(name: "SwiftGit2", package: "SwiftGit2"))
#endif

var packageTargets: [Target] = [
    .target(
        name: "AnglesiteSiteModel",
        path: "Sources/AnglesiteSiteModel",
        swiftSettings: strictConcurrency
    ),
    .target(
        name: "AnglesiteQuickLookSupport",
        dependencies: ["AnglesiteSiteModel"],
        path: "Sources/AnglesiteQuickLookSupport",
        swiftSettings: strictConcurrency
    ),
    .target(
        name: "AnglesiteCore",
        dependencies: anglesiteCoreDependencies,
        path: "Sources/AnglesiteCore",
        swiftSettings: strictConcurrency + disableFoundationModelsAutolink
    ),
    // Webview-agnostic message schema + overlay-bundle lookup (cross-platform port design §6
    // "AnglesiteBridgeCore split") — no WebKit import, so it's portable off-Darwin. Each
    // platform's webview adapter (AnglesiteBridge/WKWebView today; WebKitGTK/WebView2 later)
    // wraps this in its own script-injection/message-handler API.
    .target(
        name: "AnglesiteBridgeCore",
        dependencies: ["AnglesiteCore"],
        path: "Sources/AnglesiteBridgeCore",
        swiftSettings: strictConcurrency
    ),
    .target(
        name: "AnglesiteBridge",
        dependencies: ["AnglesiteCore", "AnglesiteBridgeCore"],
        path: "Sources/AnglesiteBridge",
        swiftSettings: strictConcurrency
    ),
    .target(
        name: "AnglesiteIOS",
        dependencies: [],
        path: "Sources/AnglesiteIOS",
        swiftSettings: strictConcurrency
    ),
    .target(
        name: "AnglesiteIntents",
        dependencies: ["AnglesiteCore"],
        path: "Sources/AnglesiteIntents",
        swiftSettings: strictConcurrency
    ),
    .executableTarget(
        name: "AnglesiteLANHost",
        dependencies: ["AnglesiteCore"],
        path: "Sources/AnglesiteLANHost",
        swiftSettings: strictConcurrency,
        linkerSettings: weakLinkFoundationModels
    ),
    // Test-only support shared across the test targets (e.g. the e2e prerequisite probes used by
    // both AnglesiteCoreTests and AnglesiteBridgeTests). Not exposed as a `.library` product, so
    // the app/xcodeproj never links it — only `swift test` builds it.
    .target(
        name: "AnglesiteTestSupport",
        dependencies: ["AnglesiteCore"],
        path: "Tests/AnglesiteTestSupport",
        swiftSettings: strictConcurrency
    ),
    .testTarget(
        name: "AnglesiteSiteModelTests",
        dependencies: ["AnglesiteSiteModel"],
        path: "Tests/AnglesiteSiteModelTests",
        swiftSettings: strictConcurrency
    ),
    .testTarget(
        name: "AnglesiteQuickLookSupportTests",
        dependencies: ["AnglesiteQuickLookSupport"],
        path: "Tests/AnglesiteQuickLookSupportTests",
        swiftSettings: strictConcurrency
    ),
    .testTarget(
        name: "AnglesiteCoreTests",
        dependencies: anglesiteCoreTestsDependencies,
        path: "Tests/AnglesiteCoreTests",
        swiftSettings: strictConcurrency,
        linkerSettings: weakLinkFoundationModels
    ),
    .testTarget(
        name: "AnglesiteBridgeCoreTests",
        dependencies: ["AnglesiteBridgeCore", "AnglesiteCore"],
        path: "Tests/AnglesiteBridgeCoreTests",
        swiftSettings: strictConcurrency,
        // Depends on AnglesiteCore, so the bundle needs the same #541 weak link as its siblings —
        // without it dyld can't load the bundle on an SDK/OS mangling-skewed Xcode 27 beta host.
        linkerSettings: weakLinkFoundationModels
    ),
    .testTarget(
        name: "AnglesiteBridgeTests",
        dependencies: ["AnglesiteBridge", "AnglesiteTestSupport"],
        path: "Tests/AnglesiteBridgeTests",
        swiftSettings: strictConcurrency,
        linkerSettings: weakLinkFoundationModels
    )
]

if includeContainer {
    packageTargets.append(
        .target(
            name: "AnglesiteContainer",
            dependencies: [
                "AnglesiteCore",
                .product(name: "Containerization", package: "containerization"),
                .product(name: "ContainerizationOCI", package: "containerization"),
                .product(name: "ContainerizationExtras", package: "containerization")
            ],
            path: "Sources/AnglesiteContainer",
            // `swift-tools-version: 5.10` silently drops `.copy()` resources whose path
            // escapes the target directory (no warning, no error — the resource bundle
            // just never gets the content). `Resources/container-{image,kernel,initfs}/`
            // are symlinked in-target here so the copy stays within
            // Sources/AnglesiteContainer while the vendored artifacts still live at the
            // top-level Resources/ alongside the rest of the app's bundled resources.
            resources: [
                .copy("Resources/container-image"),
                .copy("Resources/container-kernel"),
                .copy("Resources/container-initfs")
            ],
            swiftSettings: strictConcurrency
        )
    )
    // Standalone, individually-codesignable CLI so the live vsock/boot gate can run entitled
    // with `com.apple.security.virtualization` (see Resources/container-probe.entitlements and
    // scripts/run-container-probe.sh) — `swift test`'s own runner (swiftpm-testing-helper) can
    // never carry that entitlement. Included under the same `includeContainer` conditional as
    // AnglesiteContainer itself so CI (ANGLESITE_SKIP_CONTAINER=1) never sees it.
    packageTargets.append(
        .executableTarget(
            name: "AnglesiteContainerProbe",
            dependencies: [
                "AnglesiteContainer",
                "AnglesiteCore",
                .product(name: "Containerization", package: "containerization")
            ],
            path: "Sources/AnglesiteContainerProbe",
            swiftSettings: strictConcurrency,
            linkerSettings: weakLinkFoundationModels
        )
    )
}

// canImport(Darwin) joins the compiler gate: these targets depend on AnglesiteBridge /
// AnglesiteIntents (WKWebView / AppIntents), so a future Swift 6.4 Linux toolchain must
// not pull them in.
#if compiler(>=6.4) && canImport(Darwin)
packageTargets.append(
    .target(
        name: "AnglesiteAppCore",
        dependencies: [
            "AnglesiteCore", "AnglesiteBridge", "AnglesiteIntents",
            .product(name: "STTextView", package: "STTextView"),
            // Module name is `STPluginNeon` (the target); the product name the dependency
            // resolver matches on is the package's own product name below.
            .product(name: "STTextView-Plugin-Neon", package: "STTextView-Plugin-Neon"),
            .product(name: "MarkdownEngine", package: "swift-markdown-engine"),
        ],
        path: "Sources/AnglesiteApp",
        exclude: ["AnglesiteApp.swift", "LiveSiteRuntimeFactory.swift"],
        // #541: ChatView.swift imports FoundationModels, so without this its object code embeds a
        // hard `-framework FoundationModels` autolink hint that overrides the test bundle's
        // weak-link flag below (same mechanism as AnglesiteCore's setting).
        swiftSettings: strictConcurrency + [.define("ANGLESITE_MAS")] + disableFoundationModelsAutolink
    )
)
packageTargets.append(
    .testTarget(
        name: "AnglesiteAppTests",
        dependencies: ["AnglesiteAppCore", "AnglesiteTestSupport"],
        path: "Tests/AnglesiteAppTests",
        swiftSettings: strictConcurrency,
        linkerSettings: weakLinkFoundationModels
    )
)
packageTargets.append(
    .testTarget(
        name: "AnglesiteIntentsTests",
        dependencies: ["AnglesiteIntents", "AnglesiteCore"],
        path: "Tests/AnglesiteIntentsTests",
        swiftSettings: strictConcurrency,
        linkerSettings: weakLinkFoundationModels
    )
)
#endif

// AnglesiteContainerLocalTests depends on AnglesiteContainer, which pulls in the native
// apple/containerization dependency and only links on Apple-Silicon dev machines with the
// virtualization entitlement. A bare `swift test` (CI) must NEVER compile it — so, mirroring
// the `#if compiler(>=6.4)` conditional-append above, the target is added only when
// ANGLESITE_CONTAINER_TESTS=1 is set in the build environment. Every test inside it also guards
// on ANGLESITE_CONTAINER_E2E at runtime. Run locally with:
//   ANGLESITE_CONTAINER_TESTS=1 ANGLESITE_CONTAINER_E2E=1 swift test --filter ContainerizationControlTests
if includeContainer && ProcessInfo.processInfo.environment["ANGLESITE_CONTAINER_TESTS"] == "1" {
    packageTargets.append(
        .testTarget(
            name: "AnglesiteContainerLocalTests",
            dependencies: [
                "AnglesiteContainer",
                "AnglesiteCore",
                .product(name: "Containerization", package: "containerization"),
                .product(name: "ContainerizationExtras", package: "containerization")
            ],
            path: "Tests/AnglesiteContainerLocalTests",
            swiftSettings: strictConcurrency,
            linkerSettings: weakLinkFoundationModels
        )
    )
}

// Anywhere runtime P0 (#1208): P2P transport core built on stasel/WebRTC's
// prebuilt libwebrtc xcframework (Darwin-only binary), so this target set
// only exists on Darwin — the dependency never enters the Linux graph.
#if canImport(Darwin)
packageTargets.append(contentsOf: [
    .target(
        name: "AnglesiteP2P",
        dependencies: [
            "AnglesiteCore",
            .product(name: "WebRTC", package: "WebRTC"),
        ],
        path: "Sources/AnglesiteP2P",
        swiftSettings: strictConcurrency
    ),
    // Both final-link products below transitively depend on AnglesiteCore (via AnglesiteP2P),
    // so they need the same #541 weak-link workaround as AnglesiteLANHost/AnglesiteCoreTests/etc:
    // an Xcode 27 beta SDK can add symbols the installed macOS 27 beta runtime doesn't export yet,
    // and dyld resolves FoundationModels eagerly at load time without this.
    .executableTarget(
        name: "anglesite-p2p-demo",
        dependencies: ["AnglesiteP2P"],
        path: "Sources/anglesite-p2p-demo",
        swiftSettings: strictConcurrency,
        linkerSettings: weakLinkFoundationModels
    ),
    .testTarget(
        name: "AnglesiteP2PTests",
        dependencies: ["AnglesiteP2P"],
        path: "Tests/AnglesiteP2PTests",
        swiftSettings: strictConcurrency,
        linkerSettings: weakLinkFoundationModels + webRTCTestRPath
    ),
])
#endif

var packageProducts: [Product] = [
    .library(name: "AnglesiteSiteModel", targets: ["AnglesiteSiteModel"]),
    .library(name: "AnglesiteQuickLookSupport", targets: ["AnglesiteQuickLookSupport"]),
    .library(name: "AnglesiteCore", targets: ["AnglesiteCore"]),
    .library(name: "AnglesiteBridgeCore", targets: ["AnglesiteBridgeCore"]),
    .library(name: "AnglesiteBridge", targets: ["AnglesiteBridge"]),
    .library(name: "AnglesiteIOS", targets: ["AnglesiteIOS"]),
    .library(name: "AnglesiteIntents", targets: ["AnglesiteIntents"]),
    .executable(name: "anglesite-lan-host", targets: ["AnglesiteLANHost"])
]

var packageDependencies: [Package.Dependency] = []

// Apple's official DocC generation plugin (#1041) — build-time only, never linked into the
// shipped app. Pinned to tag 1.5.0's commit, matching the revision-pin policy below (SwiftGit2 /
// STTextView): a floating `from:` requirement previously shipped an unreviewed breaking change
// (#774/#781/#783), so every dependency here is bumped deliberately.
packageDependencies.append(
    .package(url: "https://github.com/swiftlang/swift-docc-plugin.git", revision: "647c708be89f834fa6a6d4945442793a77ddf5b6")
)

#if canImport(Darwin)
// Anglesite's patched fork of mbernson/SwiftGit2 — see #640 and Spikes/GitPackageSpike. Pinned
// to a commit rather than a tag or branch: SwiftGit2 upstream has no tagged SPM release yet, and
// pinning to anglesite/main's tip would silently pick up unreviewed future commits. Bump
// deliberately.
packageDependencies.append(
    .package(url: "https://github.com/Anglesite/SwiftGit2.git", revision: "446d4777ae4413c2faaa88425693ff29981e4b07")
)

// Anywhere runtime (#1208): prebuilt libwebrtc for the P2P transport core.
// Darwin-only binary xcframework — the target set below only includes
// AnglesiteP2P on Darwin, so the dependency never enters the Linux graph.
packageDependencies.append(
    .package(url: "https://github.com/stasel/WebRTC.git", exact: "150.0.0")
)

// Component Editor slice 4 (spec §7, §4.3): STTextView-backed code panes ("Props & Data",
// "Behavior") with tree-sitter syntax highlighting.
//   - STTextView is the TextKit 2 code-editing view itself (AppKit here — AnglesiteAppCore is
//     already Darwin/macOS-only).
//   - STTextView-Plugin-Neon wires Neon + SwiftTreeSitter highlighting into an STTextView via
//     its `NeonPlugin(theme:language:)`, bundling its own vendored tree-sitter grammars/queries
//     (TreeSitterResource, including CSS/JavaScript/TypeScript) — so these two packages cover
//     the whole highlighting stack the spec calls for, with no separate grammar packages
//     to add.
// Both AppKit-only, so gated the same as SwiftGit2 above.
// Pinned to a commit, not `from:` — `Package.resolved` is gitignored (no committed lockfile), so
// every fresh checkout resolves independently, and a floating `from:` here let a fresh resolve of
// 2.3.10 silently ship an API change (`text` became `String?`) that broke #774 (see #781, #783).
// Matches the SwiftGit2/STTextView-Plugin-Neon policy below: deliberate bumps only. This is tag
// 2.3.10's commit.
packageDependencies.append(
    .package(url: "https://github.com/krzyzanowskim/STTextView", revision: "8569251785daf1f0310eaa9235d1254264f0d249")
)
// Pinned to a commit, not `from:` — STTextView-Plugin-Neon's own manifest depends on Neon by
// `revision:` (Neon has no tagged SPM releases), and SwiftPM refuses to resolve a stable-version
// (`from:`) requirement on a package that itself depends on an unstable-version package. Pinning
// by revision here (rather than tracking `branch: "main"`) matches the SwiftGit2 policy above:
// deliberate bumps only, no silently picking up unreviewed future commits. This is tag 0.8.1's
// commit.
packageDependencies.append(
    .package(url: "https://github.com/krzyzanowskim/STTextView-Plugin-Neon", revision: "5a30db4ce7908a5414e7b499e2379bdc49991cd1")
)
// Markdown editor substrate (#797; survey #796 — see the spec addendum in
// docs/superpowers/specs/2026-07-17-blog-markdown-editor-publishing-design.md). Anglesite's
// fork of nodes-app/swift-markdown-engine v0.10.0 plus one patch making automatic quote
// substitution configurable (SpellCheckingPolicy.automaticQuoteSubstitution) — smart quotes
// corrupt Markdown sources. Only the zero-dependency core `MarkdownEngine` product is linked
// (no MarkdownEngineCodeBlocks/MarkdownEngineLatex — LaTeX and highlighted fences are out of
// scope for v1, §A.2). Pinned by revision, matching the SwiftGit2/STTextView policy above:
// deliberate bumps only (upstream is pre-1.0 and its API moves).
packageDependencies.append(
    .package(url: "https://github.com/Anglesite/swift-markdown-engine", revision: "badbaa4b9816daf3baa82de625c2551c4e0b4d81")
)
#endif

// Keep the AnglesiteContainer product and its native dependency together with the target above:
// excluded as one unit under ANGLESITE_SKIP_CONTAINER=1 so the manifest never references a missing
// package/product, included by default otherwise.
if includeContainer {
    packageProducts.append(.library(name: "AnglesiteContainer", targets: ["AnglesiteContainer"]))
    packageProducts.append(.executable(name: "anglesite-container-probe", targets: ["AnglesiteContainerProbe"]))
    packageDependencies.append(
        .package(url: "https://github.com/apple/containerization.git", .upToNextMinor(from: "0.35.0"))
    )
}

// Cross-platform port, phase 1 "purity" (docs/superpowers/specs/2026-07-08-cross-platform-
// swift-port-design.md §10): off-Darwin, expose only the targets that actually compile
// there, so `swift build && swift test` stays green on the Linux CI leg and the compiler is
// the purity lint as seam PRs expand the portable set. AnglesiteSiteModel and
// AnglesiteQuickLookSupport (both pure Foundation) were first; AnglesiteCore joined once its
// Apple-only imports (FoundationModels, OSLog, Security, NSFileCoordinator, UndoManager,
// URLSession.bytes(for:), CFGetTypeID, security-scoped bookmarks, vsock proxies, …) all grew
// Platform/ seams or #if canImport gates (#566) — ANGLESITE_PORT_WIP no longer needs to opt it
// back in. AnglesiteCoreTests is not yet in this set: its test files aren't purity-swept.
// AnglesiteBridgeCore joined at phase 2 (#567): it's the webview-agnostic message-schema half
// of the former AnglesiteBridge (no WebKit import), split out so the message dispatch logic —
// and its tests — run on every platform; AnglesiteBridge itself (the WKWebView adapter) stays
// Darwin-only.
// Filtering by name here (rather than duplicating target definitions in per-platform
// lists) keeps the single source of truth above.
#if !canImport(Darwin)
let portableTargets: Set<String> = [
    "AnglesiteSiteModel", "AnglesiteSiteModelTests",
    "AnglesiteQuickLookSupport", "AnglesiteQuickLookSupportTests",
    "AnglesiteCore",
    "AnglesiteBridgeCore", "AnglesiteBridgeCoreTests",
]
packageTargets.removeAll { !portableTargets.contains($0.name) }
// Every library product above is named after its single target, so the same name set
// filters products. (The container probe executable breaks that convention, but it is
// Darwin-only and already excluded via includeContainer.)
packageProducts.removeAll { !portableTargets.contains($0.name) }

// Cross-platform port phase 2 (#567): the Linux shell — GTK4/libadwaita via Adwaita for Swift,
// with a WebKitGTK preview (design §6). Opt-in via ANGLESITE_LINUX_SHELL=1 rather than
// default-on: building it needs GTK system headers (libadwaita ≥ 1.7 for adwaita-swift main's
// generated widgets, plus webkitgtk-6.0) that the Linux CI purity leg's swift:*-noble image
// doesn't carry (noble caps libadwaita at 1.5), so — mirroring ANGLESITE_CONTAINER_TESTS —
// the shell only enters the manifest when explicitly requested. Until a Flatpak-based CI lane
// exists (the packaging item on #567), a GTK-provisioned Linux box is the real verification,
// the same status PodmanContainerControl shipped with (#647).
if ProcessInfo.processInfo.environment["ANGLESITE_LINUX_SHELL"] == "1" {
    // Pinned to a commit, matching the SwiftGit2 policy above: adwaita-swift's only tag
    // (0.1.0) predates its current API, and tracking main would silently pick up unreviewed
    // commits. Bump deliberately. (Its own dependencies are branch-based, which SwiftPM
    // permits under a revision pin.)
    packageDependencies.append(
        .package(url: "https://git.aparoksha.dev/aparoksha/adwaita-swift", revision: "15fe44efffa5c9ad5c2c5a703b104d0180c6af5e")
    )
    packageTargets.append(
        .systemLibrary(name: "CWebKitGTK", path: "Sources/CWebKitGTK", pkgConfig: "webkitgtk-6.0")
    )
    packageTargets.append(
        .executableTarget(
            name: "AnglesiteLinux",
            dependencies: [
                "AnglesiteCore",
                "AnglesiteBridgeCore",
                "CWebKitGTK",
                .product(name: "Adwaita", package: "adwaita-swift")
            ],
            path: "Sources/AnglesiteLinux",
            swiftSettings: strictConcurrency
        )
    )
    packageProducts.append(.executable(name: "anglesite-linux", targets: ["AnglesiteLinux"]))
}
#endif

let package = Package(
    name: "Anglesite",
    platforms: [
        .macOS("27.0"),
        .iOS("27.0")
    ],
    products: packageProducts,
    dependencies: packageDependencies,
    targets: packageTargets
)
