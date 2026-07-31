// Sources/AnglesiteCore/TypedContentEditor.swift
import Foundation

/// Bridges a content file to the typed, per-field values a form editor binds to, and back.
///
/// One `markdown` field per type (the `body`) maps to the document body; every other field maps to
/// a frontmatter key. `write` applies only fields whose value actually changed, so
/// `FrontmatterDocument`'s verbatim preservation keeps untouched keys and the body intact. Pure,
/// no I/O.
public enum TypedContentEditor {
    /// A decoded, editor-facing field value — one case per shape a form control binds to, not one
    /// per `ContentTypeField.Kind` (several kinds share a shape: `.string`/`.text`/`.url`/`.image`
    /// are all `.text`). Equality at this level is what makes ``TypedContentEditor/write(_:into:descriptor:)``'s
    /// changed-fields-only diff format-preserving.
    public enum FieldValue: Equatable, Sendable {
        /// Free text — backs string-like kinds and the markdown body alike.
        case text(String)
        /// A boolean toggle.
        case flag(Bool)
        /// A date; `nil` means cleared/unset, which serializes back as an empty scalar rather than
        /// being dropped.
        case date(Date?)
        /// A number; `nil` means cleared/unset, mirroring `date`'s empty-scalar round-trip.
        case number(Double?)
        /// An ordered list of strings (string-array and image-array kinds).
        case list([String])
        /// Rows of an object-array field, each row keyed by member-field name.
        case records([[String: FieldValue]])
    }

    /// The full set of per-field values for one document, keyed by field name.
    ///
    /// A thin wrapper over a dictionary rather than a bare `[String: FieldValue]` so the editor's
    /// binding surface stays a single value type the form can diff with `==`.
    public struct Values: Equatable, Sendable {
        private var dict: [String: FieldValue]
        /// Creates a value set, empty by default so an editor can start blank and fill in per field.
        public init(_ dict: [String: FieldValue] = [:]) { self.dict = dict }
        /// Accesses the value for a field by name; `nil` means the field isn't present in this set
        /// (distinct from a present-but-empty value like `.text("")`).
        public subscript(_ name: String) -> FieldValue? {
            get { dict[name] }
            set { dict[name] = newValue }
        }
    }

    /// The empty/cleared value a field of the given kind starts with when the document doesn't
    /// define it — so every descriptor field always has a bindable value and the form never has to
    /// handle a missing key.
    public static func defaultValue(for kind: ContentTypeField.Kind) -> FieldValue {
        switch kind {
        case .string, .text, .markdown, .url, .image: return .text("")
        case .bool: return .flag(false)
        case .date, .datetime: return .date(nil)
        case .number: return .number(nil)
        case .stringArray, .imageArray: return .list([])
        case .objectArray: return .records([])
        }
    }

    /// Decodes a content file's frontmatter + body into per-field values for the descriptor.
    ///
    /// Fields absent from the file come back as ``defaultValue(for:)`` rather than being omitted,
    /// so the result always covers every descriptor field.
    public static func read(_ contents: String, descriptor: ContentTypeDescriptor) -> Values {
        read(from: FrontmatterDocument.parse(contents), descriptor: descriptor)
    }

    /// Reads field values from an already-parsed document. `write` reuses this to derive the current
    /// values without re-parsing `contents` a second time.
    private static func read(from doc: FrontmatterDocument, descriptor: ContentTypeDescriptor) -> Values {
        var out = Values()
        for field in descriptor.fields {
            if field.kind == .markdown {
                out[field.name] = .text(doc.body)
                continue
            }
            guard let raw = doc.value(for: field.name) else {
                out[field.name] = defaultValue(for: field.kind)
                continue
            }
            out[field.name] = decode(raw, kind: field.kind)
        }
        return out
    }

    /// Applies edited values back onto the original file contents and returns the new serialization.
    ///
    /// Only fields whose decoded value actually differs from what's on disk are rewritten — that
    /// changed-fields-only diff is what lets `FrontmatterDocument`'s verbatim preservation keep
    /// untouched keys, comments, and non-canonical formatting (e.g. a date-only `publishDate`)
    /// byte-identical.
    public static func write(_ values: Values, into contents: String, descriptor: ContentTypeDescriptor) -> String {
        var doc = FrontmatterDocument.parse(contents)
        // Derive `current` from the already-parsed `doc` (no second parse). Comparison stays at the
        // decoded `FieldValue` level on purpose: it preserves an unchanged field verbatim even when
        // its on-disk form isn't canonical (e.g. a date-only or no-fractional-seconds `publishDate`),
        // which a re-encoded string comparison would reformat.
        let current = read(from: doc, descriptor: descriptor)
        for field in descriptor.fields {
            guard let newValue = values[field.name], newValue != current[field.name] else { continue }
            if field.kind == .markdown {
                if case .text(let body) = newValue { doc.body = body }
                continue
            }
            if let encoded = encode(newValue, kind: field.kind) { doc.set(encoded, for: field.name) }
        }
        return doc.serialized()
    }

    // MARK: Decode (frontmatter → field value)

    private static func decode(_ value: FrontmatterValue, kind: ContentTypeField.Kind) -> FieldValue {
        switch kind {
        case .string, .text, .url, .image, .markdown:
            if case .string(let s) = value { return .text(s) }
            return .text("")
        case .bool:
            if case .bool(let b) = value { return .flag(b) }
            return .flag(false)
        case .date, .datetime:
            // `FrontmatterValue.date` is write-only — `Frontmatter.parse` only ever yields a date
            // scalar as `.string`, so matching `.string` here is exhaustive in practice. If that
            // invariant is ever relaxed, add a `.date` arm: the `.date(nil)` fallback would
            // otherwise silently drop a valid date.
            if case .string(let s) = value { return .date(parseDate(s)) }
            return .date(nil)
        case .number:
            if case .string(let s) = value { return .number(Double(s)) }
            return .number(nil)
        case .stringArray, .imageArray:
            if case .array(let a) = value { return .list(a) }
            return .list([])
        case .objectArray(let memberFields):
            guard case .objectArray(let records) = value else { return .records([]) }
            let decoded = records.map { record -> [String: FieldValue] in
                let raw = Dictionary(record.map { ($0.name, $0.value) }, uniquingKeysWith: { _, latest in latest })
                var dict: [String: FieldValue] = [:]
                for member in memberFields {
                    dict[member.name] = raw[member.name].map { decode($0, kind: member.kind) }
                        ?? defaultValue(for: member.kind)
                }
                return dict
            }
            return .records(decoded)
        }
    }

    // MARK: Encode (field value → frontmatter)

    private static func encode(_ value: FieldValue, kind: ContentTypeField.Kind) -> FrontmatterValue? {
        switch value {
        case .text(let s): return .string(s)
        case .flag(let b): return .bool(b)
        // Dates serialize unquoted (FrontmatterValue.date) so they satisfy a non-coercing date
        // schema and stay consistent with ContentScaffold; a nil (cleared) date falls back to an
        // empty quoted scalar.
        case .date(let d): return d.map { .date(format($0, kind: kind)) } ?? .string("")
        // Numbers serialize unquoted (FrontmatterValue.number) so they satisfy a z.number() schema;
        // a nil (cleared) number falls back to an empty quoted scalar.
        case .number(let n): return n.map { .number($0) } ?? .string("")
        case .list(let a): return .array(a)
        case .records(let recordDicts):
            guard case .objectArray(let memberFields) = kind else { return nil }
            let records: [[FrontmatterRecordField]] = recordDicts.map { dict in
                memberFields.compactMap { member -> FrontmatterRecordField? in
                    guard let v = dict[member.name], let encoded = encode(v, kind: member.kind) else { return nil }
                    return FrontmatterRecordField(member.name, encoded)
                }
            }
            return .objectArray(records)
        }
    }

    // MARK: Date/number formatting (mirror ContentScaffold)

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static func format(_ date: Date, kind: ContentTypeField.Kind) -> String {
        let full = iso.string(from: date)
        return kind == .date ? String(full.prefix(10)) : full
    }

    private static func parseDate(_ s: String) -> Date? {
        if let d = iso.date(from: s) { return d }
        // date-only (yyyy-MM-dd) → midnight UTC
        let df = DateFormatter()
        df.calendar = Calendar(identifier: .iso8601)
        df.timeZone = TimeZone(identifier: "UTC")
        df.dateFormat = "yyyy-MM-dd"
        return df.date(from: s)
    }
}
