// Sources/AnglesiteCore/ContentScaffold.swift
import Foundation

/// Pure, side-effect-free scaffolding for new pages and posts. Byte-faithful to the Node
/// sidecar's `create-content.mjs` so switching the create backend produces no git churn.
public enum ContentScaffold {
    public struct PageTemplate: Sendable, Equatable, Hashable, Identifiable {
        public let id: String
        public let displayName: String

        public init(id: String, displayName: String) {
            self.id = id
            self.displayName = displayName
        }

        public static let standard = PageTemplate(id: "standard", displayName: "Standard Page")
        public static let landing = PageTemplate(id: "landing", displayName: "Landing Page")
        public static let contact = PageTemplate(id: "contact", displayName: "Contact Page")

        public static let builtIns: [PageTemplate] = [.standard, .landing, .contact]
    }

    /// lowercase → NFKD → strip combining marks → drop `'` and `"` → non-alphanumerics to `-` → trim `-`.
    public static func slugify(_ value: String) -> String {
        let lowered = value.lowercased()
        let decomposed = lowered.decomposedStringWithCompatibilityMapping // NFKD
        let stripped = String(decomposed.unicodeScalars.filter { !(0x0300...0x036F ~= $0.value) })
        let noQuotes = stripped
            .replacingOccurrences(of: "'", with: "")
            .replacingOccurrences(of: "\"", with: "")
        let hyphenated = noQuotes.replacingOccurrences(
            of: "[^a-z0-9]+", with: "-", options: .regularExpression)
        return hyphenated.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }

    /// Slugify each `/`-separated segment, drop empties, rejoin with a leading slash.
    public static func normalizeRoute(_ route: String) -> String {
        let segments = route
            .split(separator: "/", omittingEmptySubsequences: false)
            .map { slugify(String($0)) }
            .filter { !$0.isEmpty }
        return "/" + segments.joined(separator: "/")
    }

    public static func pageRelativePath(normalizedRoute: String) -> String {
        "src/pages" + normalizedRoute + ".astro"
    }

    public static func postRelativePath(collection: String, slug: String) -> String {
        "src/content/\(collection)/\(slug).md"
    }

    public static func singletonRelativePath(slot: String) -> String {
        "src/data/\(slot).json"
    }

    /// `/about` → `../layouts/BaseLayout.astro`; `/a/b` → `../../layouts/BaseLayout.astro`.
    public static func layoutImport(normalizedRoute: String) -> String {
        let trimmed = normalizedRoute.hasPrefix("/") ? String(normalizedRoute.dropFirst()) : normalizedRoute
        let depth = trimmed.split(separator: "/", omittingEmptySubsequences: false).count
        return String(repeating: "../", count: depth) + "layouts/BaseLayout.astro"
    }

    public static func renderPage(
        title: String,
        layoutImport: String,
        template: PageTemplate = .standard,
        description: String? = nil
    ) -> String {
        let description = description ?? "\(title)."
        let body: String
        switch template.id {
        case PageTemplate.landing.id:
            body = """
              <main>
                <section>
                  <p>Welcome</p>
                  <h1>\(escapeHTML(title))</h1>
                  <p>Add a short promise for this page.</p>
                </section>
                <section>
                  <h2>Highlights</h2>
                  <ul>
                    <li>First thing visitors should know.</li>
                    <li>Second thing visitors should know.</li>
                    <li>Next step visitors can take.</li>
                  </ul>
                </section>
              </main>
            """
        case PageTemplate.contact.id:
            body = """
              <main>
                <h1>\(escapeHTML(title))</h1>
                <p>Tell visitors how to reach you.</p>
                <address>
                  <a href="mailto:hello@example.com">hello@example.com</a>
                </address>
              </main>
            """
        default:
            body = """
              <main>
                <h1>\(escapeHTML(title))</h1>
                <p>Add your content here.</p>
              </main>
            """
        }
        return """
        ---
        import BaseLayout from "\(layoutImport)";
        ---

        <BaseLayout title="\(escapeAttr(title))" description="\(escapeAttr(description))">
        \(body)
        </BaseLayout>
        """ + "\n"
    }

    public static func renderPost(title: String, now: Date, description: String = "") -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let publishDate = formatter.string(from: now)
        return """
        ---
        title: "\(escapeYAML(title))"
        description: "\(escapeYAML(description))"
        publishDate: \(publishDate)
        draft: true
        tags: []
        ---

        Write your post here.
        """ + "\n"
    }

    /// Render a new content entry's file contents from its descriptor: a YAML frontmatter block
    /// (one line per non-markdown field, in declaration order) followed by a placeholder body for
    /// the type's `markdown` field, if any. Pure; mirrors `renderPost`'s ISO8601 date format.
    public static func renderEntry(descriptor: ContentTypeDescriptor, title: String?, now: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let dateTime = formatter.string(from: now)

        var lines: [String] = ["---"]
        var bodyPlaceholder: String?
        for field in descriptor.fields {
            switch field.kind {
            case .markdown:
                bodyPlaceholder = "Write your \(descriptor.displayName.lowercased()) here."
            // Optional datetime/date fields scaffold commented-out: an emitted value is a valid
            // truthy Date under `z.coerce.date()`, so a live default (e.g. an unset event `end`)
            // would render a bogus `dt-end`. Commenting keeps the field as a format hint the user
            // can uncomment. Required ones stay live (the entry is invalid without them).
            case .datetime:
                lines.append("\(field.required ? "" : "# ")\(field.name): \(dateTime)")
            case .date:
                lines.append("\(field.required ? "" : "# ")\(field.name): \(String(dateTime.prefix(10)))")
            // New entries are drafts by default (#798) — every other .bool field (none exist
            // yet) keeps its false default.
            case .bool:
                lines.append("\(field.name): \(field.name == "draft" ? "true" : "false")")
            case .number:
                lines.append("\(field.name): 0")
            case .stringArray, .imageArray:
                lines.append("\(field.name): []")
            case .string, .text, .image:
                let value = ContentTypeDescriptor.titleLikeFieldNames.contains(field.name) ? (title ?? "") : ""
                lines.append("\(field.name): \"\(escapeYAML(value))\"")
            // Optional `.url` fields scaffold commented-out: an emitted `""` is not a valid URL
            // under `z.string().url()`, unlike `.string`/`.text`/`.image`'s bare `z.string()`,
            // which accepts an empty string. Mirrors the `.datetime`/`.date` comment-out rationale
            // above. Required ones (bookmarkOf, inReplyTo, likeOf) stay live — those entries are
            // already incomplete without them, same as every other required field.
            case .url:
                let value = ContentTypeDescriptor.titleLikeFieldNames.contains(field.name) ? (title ?? "") : ""
                lines.append("\(field.required ? "" : "# ")\(field.name): \"\(escapeYAML(value))\"")
            }
        }
        lines.append("---")

        var output = lines.joined(separator: "\n") + "\n"
        if let bodyPlaceholder {
            output += "\n\(bodyPlaceholder)\n"
        }
        return output
    }

    /// Render a per-site singleton (e.g. the representative h-card) as a JSON data module:
    /// `"type"` first, then one key per non-`markdown` field in descriptor order, with empty/zero
    /// defaults and the name-like field filled from `name`. Pure; hand-rendered for deterministic
    /// key order (unlike `JSONEncoder`). The template imports this file to render the identity.
    public static func renderSingleton(descriptor: ContentTypeDescriptor, name: String?) -> String {
        var entries: [String] = ["\"type\": \"\(escapeJSON(descriptor.id))\""]
        for field in descriptor.fields {
            let value: String
            switch field.kind {
            case .markdown:
                continue // a data record has no body
            case .bool:
                value = "false"
            case .number:
                value = "0"
            case .stringArray, .imageArray:
                value = "[]"
            case .string, .text, .url, .image, .date, .datetime:
                let filled = ContentTypeDescriptor.titleLikeFieldNames.contains(field.name) ? (name ?? "") : ""
                value = "\"\(escapeJSON(filled))\""
            }
            entries.append("\"\(field.name)\": \(value)")
        }
        return "{\n" + entries.map { "  \($0)" }.joined(separator: ",\n") + "\n}\n"
    }

    /// A minimal blank `.astro` component scaffold (V-1 of New Component…, #516). No props, no
    /// markup beyond a placeholder — semantic authoring arrives with the Component Editor (#496).
    public static func renderComponent(name: String) -> String {
        """
        ---
        export interface Props {}
        ---

        <div>
          <!-- \(escapeHTML(name)) -->
        </div>
        """ + "\n"
    }

    // MARK: - Escaping (order matters: `&` first)

    static func escapeAttr(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
         .replacingOccurrences(of: "\"", with: "&quot;")
    }

    static func escapeHTML(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
         .replacingOccurrences(of: "<", with: "&lt;")
         .replacingOccurrences(of: ">", with: "&gt;")
    }

    static func escapeYAML(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
    }

    /// Escape a string for use as a JSON string value. Covers `\` and `"`, the named control
    /// escapes, every remaining C0 control character as `\uXXXX`, and U+2028/U+2029. The rendered
    /// file is imported as a JS module, so an unescaped control char would be invalid JSON and
    /// hard-fail the whole site build. U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR are
    /// valid in standalone JSON but break JS parsers if the data is ever inlined into a `<script>`
    /// (e.g. V-1.8 JSON-LD), so they are escaped pre-emptively.
    static func escapeJSON(_ s: String) -> String {
        var out = ""
        out.reserveCapacity(s.count)
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\\": out += "\\\\"
            case "\"": out += "\\\""
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\u{2028}": out += "\\u2028"
            case "\u{2029}": out += "\\u2029"
            case let c where c.value < 0x20:
                out += String(format: "\\u%04x", c.value)
            default:
                out.unicodeScalars.append(scalar)
            }
        }
        return out
    }
}
