import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

@Suite("content.config.ts drift guard")
struct ContentConfigDriftTests {

    /// The committed template config in this checkout.
    static var configFile: URL {
        get throws { try templateRoot().appendingPathComponent("src/content.config.ts") }
    }

    /// Collections whose schema was extracted into `lib/content-schemas.ts` for standalone
    /// `npx tsx --test` coverage (#369) rather than declared inline in `content.config.ts`. The
    /// exported schema constant follows the `<collection>Schema` naming convention.
    static let extractedSchemaCollections: Set<String> = ["notes", "articles"]

    /// The file `extractedSchemaCollections`' schema bodies actually live in.
    static var contentSchemasFile: URL {
        get throws { try templateRoot().appendingPathComponent("src/lib/content-schemas.ts") }
    }

    /// Canonical Zod expression for a field kind, or nil for the markdown body (excluded from frontmatter).
    static func zod(for kind: ContentTypeField.Kind) -> String? {
        switch kind {
        case .markdown: return nil
        case .string, .text, .image: return "z.string()"
        case .url: return "z.string().url()"
        case .date, .datetime: return "z.coerce.date()"
        case .number: return "z.number()"
        case .bool: return "z.boolean()"
        case .stringArray, .imageArray: return "z.array(z.string())"
        }
    }

    /// One `field: expr,` line per non-markdown field, in declaration order, at the given indent.
    static func schemaLines(_ d: ContentTypeDescriptor, indent: String) -> [String] {
        var lines: [String] = []
        for field in d.fields {
            guard let zod = zod(for: field.kind) else { continue }
            // Every `.bool` field ships with `.default(false)` (matching `blog`'s pre-existing
            // `draft` line) rather than `.optional()` — a defaulted field is never bare either way,
            // so `required` doesn't affect this branch.
            let expr = field.kind == .bool ? "\(zod).default(false)" : (field.required ? zod : "\(zod).optional()")
            lines.append("\(indent)\(field.name): \(expr),")
        }
        return lines
    }

    /// The single canonical `defineCollection` block for a collection-backed descriptor whose
    /// schema is declared inline in `content.config.ts` (i.e. not in `extractedSchemaCollections`).
    static func canonicalBlock(_ d: ContentTypeDescriptor) -> String? {
        guard let collection = d.collection else { return nil }
        let lines = schemaLines(d, indent: "    ")
        return """
        const \(collection) = defineCollection({
          loader: glob({ pattern: "**/*.md", base: "./src/content/\(collection)" }),
          schema: z.object({
            ...socialFields,
        \(lines.joined(separator: "\n"))
          }).strict(),
        });
        """
    }

    /// For an `extractedSchemaCollections` member: the short `content.config.ts` block that
    /// references its schema by name instead of declaring it inline.
    static func canonicalExtractedWrapper(_ collection: String) -> String {
        """
        const \(collection) = defineCollection({
          loader: glob({ pattern: "**/*.md", base: "./src/content/\(collection)" }),
          schema: \(collection)Schema,
        });
        """
    }

    /// For an `extractedSchemaCollections` member: the canonical schema body, as it appears in
    /// `content-schemas.ts` (top-level `export const`, not nested inside `defineCollection`).
    static func canonicalSchemaBody(_ d: ContentTypeDescriptor) -> String? {
        guard let collection = d.collection else { return nil }
        let lines = schemaLines(d, indent: "  ")
        return """
        export const \(collection)Schema = z.object({
          ...socialFields,
        \(lines.joined(separator: "\n"))
        }).strict();
        """
    }

    /// Collections intentionally present in the template but absent from the registry. `blog` is the
    /// template's example collection and has no `ContentTypeDescriptor`.
    static let nonRegistryCollections: Set<String> = ["blog"]

    /// The collection identifiers named in the `export const collections = { … }` line. Handles both
    /// shorthand (`notes`) and `key: value` (`notes: notes`) entries; returns names in source order.
    static func collectionNames(inExport line: String) -> [String] {
        guard let open = line.firstIndex(of: "{"),
              let close = line.firstIndex(of: "}"), open < close else { return [] }
        let inner = line[line.index(after: open)..<close]
        return inner.split(separator: ",").compactMap { entry in
            let name = entry.split(separator: ":").first?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return name.isEmpty ? nil : name
        }
    }

    @Test("member content type is registered")
    func memberIsRegistered() {
        #expect(ContentTypeRegistry.builtIns.contains { $0.id == "member" })
    }

    @Test("collectionNames parses the export line, including key: value form")
    func parsesExportLine() {
        let line = "export const collections = { blog, notes: notes, articles };"
        #expect(Self.collectionNames(inExport: line) == ["blog", "notes", "articles"])
    }

    @Test("content.config.ts declares exactly the registry collections plus the allowlist")
    func noOrphanCollections() throws {
        let source = try String(contentsOf: Self.configFile, encoding: .utf8)
        let exportLine = source
            .split(separator: "\n", omittingEmptySubsequences: false)
            .first { $0.contains("export const collections") }
            .map(String.init) ?? ""

        // Guard the parse, so a renamed or multi-line-wrapped export reports "line not found"
        // rather than failing with every registry collection listed as spuriously missing.
        try #require(!exportLine.isEmpty,
                     "`export const collections` line not found in content.config.ts — was it renamed or wrapped across lines?")

        let declared = Set(Self.collectionNames(inExport: exportLine))
        let expected = Set(ContentTypeRegistry.builtIns.compactMap(\.collection))
            .union(Self.nonRegistryCollections)

        let orphans = declared.subtracting(expected).sorted()
        let missing = expected.subtracting(declared).sorted()
        #expect(declared == expected,
                "content.config.ts collections drifted from registry. Orphans (in config, not registry/allowlist): \(orphans); Missing (in registry, not config): \(missing)")
    }

    @Test("every collection-backed registry type appears verbatim in content.config.ts")
    func configMatchesRegistry() throws {
        let source = try String(contentsOf: Self.configFile, encoding: .utf8)
        let schemasSource = try String(contentsOf: Self.contentSchemasFile, encoding: .utf8)
        let exportLine = source
            .split(separator: "\n", omittingEmptySubsequences: false)
            .first { $0.contains("export const collections") }
            .map(String.init) ?? ""

        // Scope to the canonical builtin vocabulary, not a registry instance: a custom type
        // registered elsewhere must not make this guard demand a block in the committed template.
        for descriptor in ContentTypeRegistry.builtIns {
            guard let collection = descriptor.collection else { continue }

            if Self.extractedSchemaCollections.contains(collection) {
                guard let wrapper = Self.canonicalExtractedWrapper(collection) as String?,
                      let body = Self.canonicalSchemaBody(descriptor) else { continue }
                #expect(source.contains(wrapper),
                        "content.config.ts is missing or has drifted from the canonical wrapper for `\(collection)`:\n\(wrapper)")
                #expect(schemasSource.contains(body),
                        "content-schemas.ts is missing or has drifted from the canonical schema body for `\(collection)`:\n\(body)")
            } else {
                guard let block = Self.canonicalBlock(descriptor) else { continue }
                #expect(source.contains(block),
                        "content.config.ts is missing or has drifted from the canonical block for `\(collection)`:\n\(block)")
            }
            #expect(exportLine.contains(collection),
                    "`\(collection)` is not listed in the `collections` export")
        }
    }
}
