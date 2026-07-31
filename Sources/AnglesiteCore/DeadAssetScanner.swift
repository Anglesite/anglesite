import Foundation

/// Detects unused `.astro` components/layouts and unused `public/images` assets by building a
/// reference graph from `import` statements, `href`/`src` attributes, markdown image syntax,
/// CSS `url()`, `Astro.glob`/`import.meta.glob` calls, and frontmatter `layout:` fields — then
/// finding files with zero resolved inbound references. Reference *sources* scanned include
/// `.astro`/`.md`/`.mdx`/`.mdoc`/`.markdown`/`.css` as well as `.ts`/`.tsx`/`.js`/`.jsx` (framework
/// islands and helper/config files commonly reference `.astro` components or `public/` assets
/// too) — though only `.astro` files under `src/components`/`src/layouts` and entries in `images`
/// are ever *candidates* for deletion; JS/TS files themselves are never flagged as dead (see the
/// design doc's non-goals — JS/TS import resolution has materially more edge cases: barrel files,
/// re-exports, tsconfig `extends` scoping).
///
/// The top-level `scripts/` directory (dev-only tooling — the Component Editor's preview harness,
/// pre-deploy checks) is scanned as an ordinary reference source (a discrete reference there still
/// counts — dropping it would risk a false-positive of its own), but never contributes *glob-
/// directory* coverage — a path-prefix check in `scan`, not the general `excludedDirNames` set,
/// precisely because a nested directory like `src/scripts/` (real sites commonly hold client-side
/// JS there) must still contribute both. This matters because the bundled template's own
/// `scripts/harness/component.astro` deliberately blankets *all* of `src/components/**` and
/// `src/layouts/**` via `import.meta.glob` to power the live component preview — if that blanket
/// coverage weren't withheld, it would suppress unused-component/layout detection for every site
/// scaffolded from this template.
///
/// An unresolvable reference (bare specifier, unconfigured path alias) is never counted as proof
/// of use *or* disuse — it is simply skipped. This biases the whole scanner toward
/// under-flagging: the failure mode is "missed a dead file," never "recommended deleting
/// something in use."
///
/// **Known limitation:** brace-bound dynamic references (`<img src={heroPath}>`,
/// `<Image src={imported} />`), dynamic `import(...)` calls, and re-export barrels
/// (`export … from`) are not matched by the regex-based extraction below — a file referenced
/// *only* through one of these patterns can be incorrectly flagged as unused. This is an
/// inherent tradeoff of regex-based scanning versus a full AST parse and is not closed here;
/// Delete always requires explicit user confirmation and is git-tracked/recoverable, which is
/// this scanner's primary mitigation for this class of false positive.
///
/// **Known limitation:** an `Astro.glob`/`import.meta.glob` root written through a path alias
/// (e.g. `import.meta.glob("@content/*.md")`) is not resolved — `resolveGlobDirectory` only
/// handles a literal `/`-rooted or `./`/`../`-relative pattern, not one requiring an alias lookup
/// first. Matching an alias's own `*` against a glob pattern that has its *own* `*`/`**` wildcards
/// is a materially more complex problem than the plain-specifier alias matching `resolveAlias`
/// already does, and isn't attempted here. Same mitigation as above.
///
/// **Alias resolution scope:** `tsconfig.json`/`jsconfig.json` `compilerOptions.paths` (wildcard,
/// exact, and multi-target entries), `baseUrl`, and a same-project `extends` chain are resolved
/// (see `loadPathAliases`/`resolveAlias`). Aliases declared *only* via `astro.config.mjs`'s
/// `vite.resolve.alias` — not mirrored into tsconfig/jsconfig `paths`, which Astro's docs
/// recommend keeping in sync but do not enforce — are **not** resolved: an import through such an
/// alias with no matching `paths` entry stays unresolved and can flag a live file as unused. Same
/// mitigation as the regex blind spots above: confirmation-gated, git-tracked delete.
public enum DeadAssetScanner {
    /// One file with zero resolved inbound references — something the Navigator's Cleanup
    /// section *offers* for deletion, never deletes automatically: the regex-based extraction
    /// documented on ``DeadAssetScanner`` can under-count references, so explicit user
    /// confirmation (plus git recoverability) is the mitigation for that class of false positive.
    public struct CleanupCandidate: Sendable, Equatable, Identifiable {
        /// The project-relative path, doubling as the stable identity — unique within a scan,
        /// and stable across rescans so SwiftUI list diffs don't churn.
        public let id: String
        /// Project-relative POSIX path of the unused file (e.g. `src/components/Old.astro`).
        public let path: String
        /// Which class of file this is — drives the UI's grouping, iconography, and wording.
        public let kind: Kind
        /// The file's content-modification time, so the UI can hint at how stale a candidate is
        /// before the user decides whether to delete it.
        public let lastModified: Date
        /// Resolved inbound references counted for this file. Always `0` for anything `scan`
        /// returns — carried explicitly rather than implied so the UI can show the evidence
        /// behind the "unused" claim instead of asserting it.
        public let referenceCount: Int

        /// The only file classes ever offered for cleanup — deliberately narrow. JS/TS files are
        /// never candidates (see ``DeadAssetScanner``'s non-goals: their import resolution has
        /// materially more edge cases than this scanner attempts).
        public enum Kind: String, Sendable, Equatable, CaseIterable {
            /// An unused `.astro` file under `src/components/`.
            case component
            /// An unused `.astro` file under `src/layouts/`.
            case layout
            /// An unused entry from the caller-supplied `images` list (typically
            /// `public/images/**`).
            case image
            /// An orphan page — zero inbound *links*, not zero file references. Never produced
            /// by `scan` itself; `ProjectCleanupReport.build` maps `LinkGraph` orphan pages into
            /// this shape so the Cleanup section can present one merged list.
            case page
        }

        /// Memberwise initializer — public so `ProjectCleanupReport` (and tests) can synthesize
        /// candidates that didn't come from a `scan` call, e.g. the orphan-page rows above.
        public init(id: String, path: String, kind: Kind, lastModified: Date, referenceCount: Int) {
            self.id = id
            self.path = path
            self.kind = kind
            self.lastModified = lastModified
            self.referenceCount = referenceCount
        }
    }

    /// Raw references extracted from one source file, already resolved to project-relative paths
    /// where possible. `globDirectories` are directories an `Astro.glob` call covers — every file
    /// under one is treated as referenced, regardless of whether it appears in `fileReferences`.
    struct ReferenceSource: Sendable, Equatable {
        let path: String
        let fileReferences: Set<String>
        let globDirectories: Set<String>
        let unresolvedReferences: Set<String>
    }

    // MARK: - Regexes (compiled once, matching the style of ContentScanner/SiteKnowledgeIndex)

    private static let importRegex = try! NSRegularExpression(
        pattern: #"import\s+(?:[^'"]+?\s+from\s+)?["']([^"']+)["']"#)
    private static let hrefSrcRegex = try! NSRegularExpression(
        pattern: #"(?:href|src)=["']([^"']+)["']"#, options: [.caseInsensitive])
    private static let markdownImageRegex = try! NSRegularExpression(
        pattern: #"!\[[^\]]*\]\(([^)]+)\)"#)
    private static let cssURLRegex = try! NSRegularExpression(
        pattern: #"url\(\s*['"]?([^'")]+)['"]?\s*\)"#, options: [.caseInsensitive])
    /// Matches an `Astro.glob(...)` or `import.meta.glob(...)` call's full argument list (up to
    /// the first `)`), so it works whether the call takes a single quoted string or an array of
    /// them. `globPatternsRegex` then pulls every individually-quoted pattern out of that capture.
    private static let globCallRegex = try! NSRegularExpression(
        pattern: #"(?:Astro\.glob|import\.meta\.glob)\(([^)]*)\)"#)
    private static let globPatternsRegex = try! NSRegularExpression(
        pattern: #"['"]([^'"]+)['"]"#)

    /// Extracts and resolves every reference in `source`, a file at project-relative `path`.
    static func extractReferences(source: String, path: String) -> ReferenceSource {
        let raw = matches(importRegex, in: source, group: 1)
            + matches(hrefSrcRegex, in: source, group: 1)
            + matches(markdownImageRegex, in: source, group: 1)
            + matches(cssURLRegex, in: source, group: 1)

        var fileRefs = Set<String>()
        var unresolved = Set<String>()
        for candidate in raw {
            let cleaned = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            if let resolved = resolve(cleaned, relativeTo: path) {
                fileRefs.insert(resolved)
            } else {
                unresolved.insert(cleaned)
            }
        }

        var globDirs = Set<String>()
        for call in matches(globCallRegex, in: source, group: 1) {
            for pattern in matches(globPatternsRegex, in: call, group: 1) {
                if let dir = resolveGlobDirectory(pattern, relativeTo: path) { globDirs.insert(dir) }
            }
        }

        return ReferenceSource(
            path: path, fileReferences: fileRefs, globDirectories: globDirs,
            unresolvedReferences: unresolved)
    }

    // MARK: - Path resolution

    /// Resolves a raw reference string to a project-relative path, or `nil` if it can't be
    /// resolved (bare specifier, unconfigured alias) — never guessed at.
    static func resolve(_ ref: String, relativeTo sourcePath: String) -> String? {
        if let abs = resolveAbsolutePath(ref) { return abs }
        if let rel = resolveRelativePath(ref, relativeTo: sourcePath) { return rel }
        return nil
    }

    /// `/images/hero.png` → `public/images/hero.png` (Astro serves `public/` at the site root).
    /// Strips a trailing `?query` or `#fragment` first.
    static func resolveAbsolutePath(_ ref: String) -> String? {
        guard ref.hasPrefix("/") else { return nil }
        var clean = String(ref.dropFirst())
        if let cut = clean.firstIndex(where: { $0 == "?" || $0 == "#" }) {
            clean = String(clean[clean.startIndex..<cut])
        }
        guard !clean.isEmpty else { return nil }
        return "public/" + clean
    }

    /// Resolves `./`/`../`-prefixed `ref` against `sourcePath`'s own directory. Strips a trailing
    /// `?query`/`#fragment` first. Also accepts a bare `.`/`..` (no path after it) — not a real
    /// import specifier anyone writes, but exactly what `resolveGlobDirectory`'s truncation
    /// produces for a same-directory or parent-directory-only glob pattern (`./*.astro`), so this
    /// guard has to admit it or that degenerate case silently fails to resolve at all.
    static func resolveRelativePath(_ ref: String, relativeTo sourcePath: String) -> String? {
        guard ref == "." || ref == ".." || ref.hasPrefix("./") || ref.hasPrefix("../") else { return nil }
        var clean = ref
        if let cut = clean.firstIndex(where: { $0 == "?" || $0 == "#" }) {
            clean = String(clean[clean.startIndex..<cut])
        }
        var dirComponents = sourcePath.split(separator: "/").dropLast().map(String.init)
        for segment in clean.split(separator: "/") {
            if segment == "." { continue }
            else if segment == ".." { if !dirComponents.isEmpty { dirComponents.removeLast() } }
            else { dirComponents.append(String(segment)) }
        }
        guard !dirComponents.isEmpty else { return nil }
        return dirComponents.joined(separator: "/")
    }

    /// Truncates a glob pattern down to its containing directory (e.g. `../content/*.md` → the
    /// resolved form of `../content`) and resolves that. A leading `/` is `import.meta.glob`'s
    /// project-root-relative form (Vite/Astro convention — distinct from `resolveAbsolutePath`'s
    /// `public/`-serving convention used for `href`/`src`) and resolves directly against the
    /// project root; `./`/`../` patterns resolve against `sourcePath`'s own directory. Anything
    /// else (a bare/aliased glob pattern) is left unresolved.
    static func resolveGlobDirectory(_ pattern: String, relativeTo sourcePath: String) -> String? {
        func truncateToDirectory(_ raw: String) -> String {
            var dir = raw
            if let starIndex = dir.firstIndex(of: "*") {
                dir = String(dir[dir.startIndex..<starIndex])
                if let lastSlash = dir.lastIndex(of: "/") {
                    dir = String(dir[dir.startIndex...lastSlash])
                }
            }
            if dir.hasSuffix("/") { dir.removeLast() }
            return dir
        }
        if pattern.hasPrefix("/") {
            let dir = truncateToDirectory(String(pattern.dropFirst()))
            return dir.isEmpty ? nil : dir
        }
        guard pattern.hasPrefix("./") || pattern.hasPrefix("../") else { return nil }
        return resolveRelativePath(truncateToDirectory(pattern), relativeTo: sourcePath)
    }

    /// A tsconfig/jsconfig's alias-relevant `compilerOptions`, merged across an `extends` chain
    /// (a child's own `baseUrl`/`paths` win over anything inherited — matching how TypeScript
    /// itself merges `compilerOptions`). `baseUrl` is stored exactly as written in the config
    /// (project-root-relative in the common case).
    struct PathAliasConfig: Equatable {
        let baseUrl: String?
        let paths: [String: [String]]
    }

    /// Loads `tsconfig.json` or `jsconfig.json` from `projectRoot` (in that order — the first one
    /// that yields a non-empty `baseUrl`/`paths`, after following its `extends` chain, wins).
    /// Malformed/missing/commented JSON safely degrades to an empty config, matching this
    /// scanner's "never guess" resolution philosophy.
    static func loadPathAliases(projectRoot: URL) -> PathAliasConfig {
        for name in ["tsconfig.json", "jsconfig.json"] {
            let url = projectRoot.appendingPathComponent(name)
            if let config = loadTSConfig(at: url, depth: 0), config.baseUrl != nil || !config.paths.isEmpty {
                return config
            }
        }
        return PathAliasConfig(baseUrl: nil, paths: [:])
    }

    /// Loads one tsconfig/jsconfig file, recursively following a relative `extends` chain (TS
    /// resolves `extends` relative to the extending file's own directory; a depth guard avoids an
    /// accidental cycle). Returns `nil` only if `url` itself can't be read/parsed as JSON.
    ///
    /// **Known limitation:** only a plain relative path ending in `.json` is followed (e.g.
    /// `"./tsconfig.base.json"`). Two real `extends` forms are not: an extensionless relative path
    /// (`"./tsconfig.base"`, valid since TS 3.2 — the compiler appends `.json` itself) and a bare
    /// package specifier resolved via node_modules (`"astro/tsconfigs/strict"`, which this app's
    /// own bundled template uses). Either form just fails to read here and the extended config's
    /// `paths`/`baseUrl` are silently dropped — harmless *today* only because the specific presets
    /// in use happen to define no `paths`; a project whose base config (reached either way) does
    /// define aliases would have those aliases go unresolved. Full Node-style module resolution
    /// (package.json `main`/`exports` lookup) is a materially larger undertaking than the plain
    /// relative-path case this closes, and isn't attempted here.
    private static func loadTSConfig(at url: URL, depth: Int) -> PathAliasConfig? {
        guard depth < 5 else { return nil }
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }

        var inherited = PathAliasConfig(baseUrl: nil, paths: [:])
        if let extendsRef = json["extends"] as? String {
            let parentURL = url.deletingLastPathComponent().appendingPathComponent(extendsRef)
            if let parent = loadTSConfig(at: parentURL, depth: depth + 1) {
                inherited = parent
            }
        }

        let compilerOptions = json["compilerOptions"] as? [String: Any]
        let baseUrl = (compilerOptions?["baseUrl"] as? String) ?? inherited.baseUrl
        var paths = inherited.paths
        if let rawPaths = compilerOptions?["paths"] as? [String: Any] {
            for (pattern, targets) in rawPaths {
                guard let targetList = targets as? [String] else { continue }
                paths[pattern] = targetList
            }
        }
        return PathAliasConfig(baseUrl: baseUrl, paths: paths)
    }

    /// Resolves `ref` against `config` (from `loadPathAliases`): finds every `paths` target —
    /// wildcard (single `*`) or exact — whose pattern matches `ref`, substituting and resolving
    /// each one relative to `baseUrl` (or, when `baseUrl` is unset, relative to the project root
    /// directly — matching how TypeScript resolves `paths` without an explicit `baseUrl`).
    ///
    /// A pattern can map to more than one target (a supported TS/Vite fallback-chain shape, e.g.
    /// `"@utils/*": ["src/utils/*", "src/shared/utils/*"]`); this scanner can't cheaply verify
    /// which target is the real one without a second filesystem pass, so every target is returned
    /// and credited as a reference by the caller — crediting a path that doesn't correspond to a
    /// real file is harmless (it just never matches any real candidate's path), while crediting
    /// only the first target risks the opposite: a live file under a later target staying
    /// uncounted and flagged unused.
    ///
    /// Patterns are tried longest-literal-prefix-first (not `config.paths`'s raw `Dictionary`
    /// order, which is unspecified) so two overlapping patterns that could both match the same
    /// `ref` (e.g. `"@/*"` and `"@/components/*"`) resolve deterministically to the more specific
    /// one, matching how bundlers conventionally break this tie.
    static func resolveAlias(_ ref: String, config: PathAliasConfig) -> [String] {
        let orderedPatterns = config.paths.sorted { literalPrefixLength($0.key) > literalPrefixLength($1.key) }
        for (pattern, targets) in orderedPatterns {
            let starCount = pattern.filter({ $0 == "*" }).count
            if starCount == 1, let starIndex = pattern.firstIndex(of: "*") {
                let prefix = String(pattern[pattern.startIndex..<starIndex])
                let suffix = String(pattern[pattern.index(after: starIndex)...])
                guard ref.hasPrefix(prefix), ref.hasSuffix(suffix), ref.count >= prefix.count + suffix.count else { continue }
                let matched = String(ref.dropFirst(prefix.count).dropLast(suffix.count))
                var resolved: [String] = []
                for target in targets {
                    guard let targetStar = target.firstIndex(of: "*"), target.filter({ $0 == "*" }).count == 1 else { continue }
                    let targetPrefix = String(target[target.startIndex..<targetStar])
                    let targetSuffix = String(target[target.index(after: targetStar)...])
                    resolved.append(applyBaseURL(targetPrefix + matched + targetSuffix, config.baseUrl))
                }
                if !resolved.isEmpty { return resolved }
            } else if starCount == 0, pattern == ref, !targets.isEmpty {
                return targets.map { applyBaseURL($0, config.baseUrl) }
            }
        }
        return []
    }

    /// Length of `pattern` up to (not including) its first `*`, or the whole pattern's length if
    /// it has none — a proxy for "how specific is this alias pattern" used to break ties between
    /// overlapping `paths` entries.
    private static func literalPrefixLength(_ pattern: String) -> Int {
        if let starIndex = pattern.firstIndex(of: "*") {
            return pattern.distance(from: pattern.startIndex, to: starIndex)
        }
        return pattern.count
    }

    /// Prefixes `target` (a `paths`-substituted specifier, possibly still `./`-relative) with
    /// `baseUrl` when one is configured; strips a leading `./` either way. `baseUrl` is treated as
    /// project-root-relative (the common single-tsconfig case); an `extends` chain that reaches a
    /// parent config outside the project root and sets its own `baseUrl` would misresolve here —
    /// an accepted, narrow gap, no worse than the pre-existing no-`baseUrl` behavior.
    private static func applyBaseURL(_ target: String, _ baseUrl: String?) -> String {
        var clean = target
        if clean.hasPrefix("./") { clean.removeFirst(2) }
        guard let baseUrl, !baseUrl.isEmpty, baseUrl != "." else { return clean }
        var base = baseUrl
        if base.hasPrefix("./") { base.removeFirst(2) }
        if base.hasSuffix("/") { base.removeLast() }
        return "\(base)/\(clean)"
    }

    private static func matches(_ regex: NSRegularExpression, in source: String, group: Int) -> [String] {
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        var out: [String] = []
        for match in regex.matches(in: source, range: range) {
            guard let r = Range(match.range(at: group), in: source) else { continue }
            out.append(String(source[r]))
        }
        return out
    }

    // MARK: - Full-project scan

    private static let referenceScanExtensions: Set<String> = [
        ".astro", ".md", ".mdx", ".mdoc", ".markdown", ".css",
        ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
    ]
    /// Reuses `SiteIndexPaths`' shared skip list (build artifacts, dependency dirs, and
    /// host-specific build caches like `.netlify`/`.vercel`) rather than a second, independently
    /// drifting copy of the same rules.
    private static let excludedDirNames = SiteIndexPaths.skippedDirectoryNames

    /// Per-file attribution of every resolved reference discovered by a full-project walk: which
    /// project-relative source paths reference each (lowercased) referenced-file path, plus the
    /// set of directories covered by an `Astro.glob`/`import.meta.glob` call. Shared by `scan` and
    /// `referencedPaths` so the extraction/alias/glob logic lives in exactly one place.
    private struct ReferenceIndex {
        var referencingPaths: [String: Set<String>] = [:]
        /// Directory (lowercased, project-relative) covered by an `Astro.glob`/`import.meta.glob`
        /// call, mapped to the source file(s) that declared the covering glob call. `scan()`
        /// floors a covered path's reference count at 1 — a glob call is itself a real reference
        /// to everything under the directory, even without a per-file explicit reference — and
        /// `referencedPaths()` attributes every real file under a covered directory to the same
        /// declaring source file(s), so the two stay in agreement instead of one flagging a
        /// glob-only-covered asset as used and the other reporting it as unreferenced.
        var globDirectorySources: [String: Set<String>] = [:]
    }

    /// Walks every `.astro`/`.md`/`.mdx`/`.mdoc`/`.markdown`/`.css`/`.ts`/`.tsx`/`.js`/`.jsx` file
    /// under `projectRoot` (excluding the top-level `scripts/` — see the type doc comment) and
    /// attributes every resolved reference to its source file. Pure over the filesystem snapshot
    /// at call time.
    private static func buildReferenceIndex(projectRoot: URL) -> ReferenceIndex {
        var index = ReferenceIndex()
        var skippedOversizedFiles: [String] = []
        let aliasConfig = loadPathAliases(projectRoot: projectRoot)

        for abs in walk(projectRoot) {
            let ext = "." + abs.pathExtension.lowercased()
            guard referenceScanExtensions.contains(ext) else { continue }
            let relPath = relativePosix(abs, from: projectRoot)
            // Top-level `scripts/` (dev tooling: the Component Editor's preview harness,
            // pre-deploy checks — not a nested directory like `src/scripts/`, which real sites
            // commonly use for client-side JS) never contributes *glob-directory* coverage below —
            // that's what stops the harness's own blanket `import.meta.glob` from suppressing
            // unused-component/layout detection everywhere. It's still scanned as an ordinary
            // reference *source*: excluding it entirely would also drop any discrete, non-glob
            // reference some other top-level script might legitimately hold.
            let isTopLevelScripts = relPath.lowercased().hasPrefix("scripts/")
            let actualSize = fileSize(abs)
            guard let size = actualSize, size <= 512_000 else {
                // Missing a reference *source* here is worse than the same skip in a candidate
                // indexer (SiteKnowledgeIndex): it can leave a live file's inbound count at 0.
                // Logged (once, batched, at the end of scan()) rather than silently swallowed —
                // this is the one deliberate side effect in an otherwise pure function, kept out
                // of the hot per-file path so it never blocks or reorders the scan itself.
                if let actualSize { skippedOversizedFiles.append("\(relPath) (\(actualSize) bytes)") }
                continue
            }
            guard let source = try? String(contentsOf: abs, encoding: .utf8) else { continue }

            let refs = extractReferences(source: source, path: relPath)
            for ref in refs.fileReferences {
                index.referencingPaths[ref.lowercased(), default: []].insert(relPath)
            }
            if !isTopLevelScripts {
                for dir in refs.globDirectories {
                    index.globDirectorySources[dir.lowercased(), default: []].insert(relPath)
                }
            }
            for raw in refs.unresolvedReferences {
                for aliasResolved in resolveAlias(raw, config: aliasConfig) {
                    index.referencingPaths[aliasResolved.lowercased(), default: []].insert(relPath)
                }
            }

            // Frontmatter references count too — extractReferences only looks at the body. Every
            // string (or array-of-strings) frontmatter value is tried, not just a hardcoded
            // `layout:`/`image:`-style field-name allowlist — content-collection conventions
            // (image:, cover:, ogImage:, a gallery array, …) vary per project, and a value that
            // doesn't look like a real path/alias (titles, tags, slugs — the overwhelming
            // majority of frontmatter) simply fails to resolve and is silently skipped, same as
            // everywhere else in this scanner.
            let frontmatter = Frontmatter.parse(source)
            for value in frontmatter.values {
                let rawValues: [String]
                switch value {
                case .string(let s): rawValues = [s]
                case .array(let arr): rawValues = arr
                case .bool, .number, .date, .objectArray: rawValues = []
                }
                for raw in rawValues {
                    if let resolved = resolve(raw, relativeTo: relPath) {
                        index.referencingPaths[resolved.lowercased(), default: []].insert(relPath)
                    } else {
                        for aliasResolved in resolveAlias(raw, config: aliasConfig) {
                            index.referencingPaths[aliasResolved.lowercased(), default: []].insert(relPath)
                        }
                    }
                }
            }
        }

        if !skippedOversizedFiles.isEmpty {
            Task {
                await LogCenter.shared.append(
                    source: "dead-assets:scan", stream: .stderr,
                    text: "DeadAssetScanner: skipped \(skippedOversizedFiles.count) file(s) over the 512,000 byte reference-scan limit — any reference they contain won't be counted: \(skippedOversizedFiles.joined(separator: ", "))")
            }
        }

        return index
    }

    /// Scans every `.astro`/`.md`/`.mdx`/`.mdoc`/`.markdown`/`.css`/`.ts`/`.tsx`/`.js`/`.jsx` file
    /// under `projectRoot` (excluding the top-level `scripts/` — see the type doc comment) for
    /// references, then returns every unused `src/components/**/*.astro`, `src/layouts/**/*.astro`,
    /// and unused entry in `images` (typically `SiteContentGraph.images(for:)`, scoped to
    /// `public/images/**`). Pure over the filesystem snapshot at call time.
    public static func scan(projectRoot: URL, images: [SiteContentGraph.Image]) -> [CleanupCandidate] {
        let index = buildReferenceIndex(projectRoot: projectRoot)

        func referenceCount(for path: String) -> Int {
            let key = path.lowercased()
            if index.globDirectorySources.keys.contains(where: { key.hasPrefix($0 + "/") }) {
                return max(1, index.referencingPaths[key]?.count ?? 0)
            }
            return index.referencingPaths[key]?.count ?? 0
        }

        var candidates: [CleanupCandidate] = []

        for abs in walk(projectRoot.appendingPathComponent("src/components"))
        where abs.pathExtension.lowercased() == "astro" {
            let rel = relativePosix(abs, from: projectRoot)
            let count = referenceCount(for: rel)
            if count == 0 {
                candidates.append(CleanupCandidate(
                    id: rel, path: rel, kind: .component, lastModified: mtime(abs), referenceCount: count))
            }
        }
        for abs in walk(projectRoot.appendingPathComponent("src/layouts"))
        where abs.pathExtension.lowercased() == "astro" {
            let rel = relativePosix(abs, from: projectRoot)
            let count = referenceCount(for: rel)
            if count == 0 {
                candidates.append(CleanupCandidate(
                    id: rel, path: rel, kind: .layout, lastModified: mtime(abs), referenceCount: count))
            }
        }
        for image in images {
            let count = referenceCount(for: image.relativePath)
            if count == 0 {
                candidates.append(CleanupCandidate(
                    id: image.relativePath, path: image.relativePath, kind: .image,
                    lastModified: image.lastModified, referenceCount: count))
            }
        }

        return candidates.sorted { $0.path < $1.path }
    }

    /// Every referenced-file path (lowercased) mapped to the set of project-relative source paths
    /// that reference it. Reuses the exact same extraction/alias/glob logic as `scan` — this is the
    /// canonical "what references this file" answer for the whole app; `ContentScanner.scanImages`
    /// uses it to populate `SiteContentGraph.Image.usedOnPages` (#140/#553).
    ///
    /// Includes glob-covered files: every real file found under a directory covered by an
    /// `Astro.glob`/`import.meta.glob` call is attributed to the source file(s) that declared
    /// the covering glob, even when no other explicit reference exists — matching `scan()`'s
    /// glob-directory floor so the two never contradict each other for a glob-only-covered file.
    public static func referencedPaths(projectRoot: URL) -> [String: Set<String>] {
        let index = buildReferenceIndex(projectRoot: projectRoot)
        var result = index.referencingPaths
        for (dir, sources) in index.globDirectorySources {
            for abs in walk(projectRoot.appendingPathComponent(dir)) {
                let rel = relativePosix(abs, from: projectRoot).lowercased()
                result[rel, default: []].formUnion(sources)
            }
        }
        return result
    }

    /// Recursively collects files under `dir` in sorted order, skipping excluded directories and
    /// symlinks. Missing `dir` → empty. Mirrors `ContentScanner.walk`/`SiteKnowledgeIndex.walk`.
    private static func walk(_ dir: URL) -> [URL] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey], options: []
        ) else { return [] }
        var files: [URL] = []
        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let name = entry.lastPathComponent
            let values = try? entry.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            if values?.isSymbolicLink == true { continue }
            if values?.isDirectory == true {
                if excludedDirNames.contains(name) { continue }
                files.append(contentsOf: walk(entry))
            } else {
                files.append(entry)
            }
        }
        return files
    }

    private static func relativePosix(_ url: URL, from base: URL) -> String {
        let urlComponents = url.standardizedFileURL.pathComponents
        let baseComponents = base.standardizedFileURL.pathComponents
        guard urlComponents.starts(with: baseComponents) else { return url.path }
        return urlComponents.dropFirst(baseComponents.count).joined(separator: "/")
    }

    private static func mtime(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
            ?? Date(timeIntervalSince1970: 0)
    }

    private static func fileSize(_ url: URL) -> Int64? {
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize else { return nil }
        return Int64(size)
    }
}
