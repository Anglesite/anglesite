import Foundation

/// One onscreen element reported by the WKWebView overlay's `installVisibleElementsReporter`
/// (JS, #145). The provider (`PreviewAnnotationProvider`, #146) maps each into an `AppEntity`
/// so Siri's `appEntityUIElementProvider` (#148) can resolve "this heading" / "this image"
/// hit-tests against whatever the user can currently see.
///
/// **Selector shape.** Same structured `ElementInfo`-as-`JSONValue` the `apply-edit` messages
/// carry — decided in #18 so the plugin's `server/selector.mjs` stays the only place that
/// turns metadata into a CSS selector. Decoder requires an object exactly like
/// `EditMessage.decode` does.
public struct VisibleElement: Sendable, Equatable {
    /// Per-tab stable id. Sourced from `data-anglesite-id` when present, otherwise a generated
    /// `v-…` string the JS layer keeps stable across reports via an internal WeakMap.
    public let id: String
    /// Lowercased HTML tag name — the cheapest signal for kind-of-element filtering ("this image"
    /// vs "this heading") before any selector work happens.
    public let tag: String
    /// The structured `ElementInfo` metadata (always a JSON object; the decoder enforces this) —
    /// kept opaque here so the plugin's `server/selector.mjs` remains the only selector builder.
    public let selector: JSONValue
    /// Viewport-relative bounding box, used for Siri's "this one" hit-testing.
    public let rect: Rect
    /// Trimmed visible text content, when the element has any — a disambiguation hint, not a
    /// faithful copy of the DOM.
    public let text: String?
    /// The element's resolved `src` (images/media), when present.
    public let src: String?
    /// The element's ARIA role, when the JS layer could determine one.
    public let role: String?
    /// The page path the element was observed on — lets the provider scope entities to the page
    /// the preview is actually showing.
    public let pagePath: String?

    /// A viewport-coordinate bounding box. A minimal value type rather than `CGRect` so this
    /// message stays Foundation-only and portable off-Darwin.
    public struct Rect: Sendable, Equatable {
        /// Left edge, in CSS pixels relative to the viewport.
        public let x: Double
        /// Top edge, in CSS pixels relative to the viewport.
        public let y: Double
        /// Width in CSS pixels.
        public let width: Double
        /// Height in CSS pixels.
        public let height: Double

        /// Creates a rect from the four viewport-relative components.
        public init(x: Double, y: Double, width: Double, height: Double) {
            self.x = x
            self.y = y
            self.width = width
            self.height = height
        }
    }

    /// Memberwise creation, with the optional disambiguation hints defaulting to `nil` so tests
    /// and alternate producers only spell out what they care about.
    public init(
        id: String,
        tag: String,
        selector: JSONValue,
        rect: Rect,
        text: String? = nil,
        src: String? = nil,
        role: String? = nil,
        pagePath: String? = nil
    ) {
        self.id = id
        self.tag = tag
        self.selector = selector
        self.rect = rect
        self.text = text
        self.src = src
        self.role = role
        self.pagePath = pagePath
    }
}

/// The full `anglesite:visible-elements` payload — type tag plus the element list.
public struct VisibleElementReport: Sendable, Equatable {
    /// The `type` discriminator the JS reporter stamps on every payload; ``decode(from:)`` rejects
    /// anything else so one script handler can route multiple message families.
    public static let messageType = "anglesite:visible-elements"

    /// The elements visible at report time, in the order the JS layer enumerated them.
    public let elements: [VisibleElement]

    /// Wraps an element list — used by tests and by ``decode(from:)`` on success.
    public init(elements: [VisibleElement]) {
        self.elements = elements
    }

    /// Report-level decode failure shape. Each case pins down *where* a malformed payload went
    /// wrong, because a bare "bad message" from the JS boundary is undebuggable.
    public enum DecodeError: Error, Sendable, Equatable {
        /// The body wasn't a dictionary at all.
        case notAnObject
        /// A required top-level key was absent.
        case missingField(String)
        /// A top-level key was present but had the wrong type.
        case wrongType(field: String, expected: String)
        /// The `type` tag didn't match ``VisibleElementReport/messageType`` — the message belongs
        /// to another family.
        case unknownType(String)
        /// One element in the batch failed to decode; the whole report is rejected rather than
        /// silently dropping the bad element, so the JS bug surfaces instead of hiding.
        case malformedElement(index: Int, error: VisibleElement.DecodeError)
    }

    /// Validate every field at the JS boundary; never throw. Same flat `Result` shape as
    /// `EditMessage.decode` so the script handler can drop both through one error sink.
    public static func decode(from body: Any) -> Result<VisibleElementReport, DecodeError> {
        guard let dict = body as? [String: Any] else { return .failure(.notAnObject) }
        guard let rawType = dict["type"] else { return .failure(.missingField("type")) }
        guard let typeStr = rawType as? String else {
            return .failure(.wrongType(field: "type", expected: "string"))
        }
        guard typeStr == messageType else { return .failure(.unknownType(typeStr)) }

        guard let rawElements = dict["elements"] else { return .failure(.missingField("elements")) }
        guard let rawArray = rawElements as? [Any] else {
            return .failure(.wrongType(field: "elements", expected: "array"))
        }

        var elements: [VisibleElement] = []
        elements.reserveCapacity(rawArray.count)
        for (i, raw) in rawArray.enumerated() {
            switch VisibleElement.decode(from: raw) {
            case .success(let el): elements.append(el)
            case .failure(let err): return .failure(.malformedElement(index: i, error: err))
            }
        }
        return .success(VisibleElementReport(elements: elements))
    }
}

extension VisibleElement {
    /// Per-element decode failure shape. Paired with `VisibleElement.decode` (the same
    /// `Type.DecodeError` pairing `EditMessage` uses), and surfaced from the report's
    /// `DecodeError.malformedElement(index:error:)` case when one element in a batch fails.
    public enum DecodeError: Error, Sendable, Equatable {
        /// The element payload wasn't a dictionary.
        case notAnObject
        /// A required element key was absent.
        case missingField(String)
        /// An element key was present but had the wrong type.
        case wrongType(field: String, expected: String)
    }

    /// Validate one element. Public so callers that already have a `[String: Any]` element
    /// (e.g. tests, alternate transports) can decode without going through the report wrapper.
    public static func decode(from body: Any) -> Result<VisibleElement, VisibleElement.DecodeError> {
        guard let dict = body as? [String: Any] else { return .failure(.notAnObject) }
        func requireString(_ field: String) -> Result<String, VisibleElement.DecodeError> {
            guard let raw = dict[field] else { return .failure(.missingField(field)) }
            guard let s = raw as? String else { return .failure(.wrongType(field: field, expected: "string")) }
            return .success(s)
        }
        let id: String
        let tag: String
        switch requireString("id") {
        case .success(let v): id = v
        case .failure(let e): return .failure(e)
        }
        switch requireString("tag") {
        case .success(let v): tag = v
        case .failure(let e): return .failure(e)
        }
        guard let rawSelector = dict["selector"] else { return .failure(.missingField("selector")) }
        guard let jv = JSONValue.from(rawSelector), case .object = jv else {
            return .failure(.wrongType(field: "selector", expected: "object"))
        }
        let selector = jv
        guard let rawRect = dict["rect"] else { return .failure(.missingField("rect")) }
        guard let rectDict = rawRect as? [String: Any] else {
            return .failure(.wrongType(field: "rect", expected: "object"))
        }
        guard
            let x = numberValue(rectDict["x"]),
            let y = numberValue(rectDict["y"]),
            let w = numberValue(rectDict["width"]),
            let h = numberValue(rectDict["height"])
        else {
            return .failure(.wrongType(field: "rect", expected: "{x,y,width,height} of numbers"))
        }
        let text = dict["text"] as? String
        let src = dict["src"] as? String
        let role = dict["role"] as? String
        let pagePath = dict["pagePath"] as? String
        return .success(
            VisibleElement(
                id: id,
                tag: tag,
                selector: selector,
                rect: Rect(x: x, y: y, width: w, height: h),
                text: text,
                src: src,
                role: role,
                pagePath: pagePath
            )
        )
    }
}

/// Accept either NSNumber (the `JSONSerialization` shape WKWebView delivers) or Swift numeric
/// literals (the shape tests construct). Mirrors `JSONValue.from`'s NSNumber-first ordering.
private func numberValue(_ raw: Any?) -> Double? {
    guard let raw else { return nil }
    if let n = raw as? NSNumber { return n.doubleValue }
    if let d = raw as? Double { return d }
    if let i = raw as? Int { return Double(i) }
    return nil
}
