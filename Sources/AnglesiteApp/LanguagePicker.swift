// Sources/AnglesiteApp/LanguagePicker.swift
import SwiftUI

/// A curated set of common web languages, keyed by BCP-47 subtag. Deliberately small (#956 design
/// doc "Known limitations") — "Other…" is the escape hatch for anything not listed here.
enum CommonLanguage: String, CaseIterable, Identifiable {
    case en, es, fr, de, it, pt, ja, zh, ko, ar, ru, hi, nl, pl, sv
    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .en: return "English"
        case .es: return "Spanish"
        case .fr: return "French"
        case .de: return "German"
        case .it: return "Italian"
        case .pt: return "Portuguese"
        case .ja: return "Japanese"
        case .zh: return "Chinese"
        case .ko: return "Korean"
        case .ar: return "Arabic"
        case .ru: return "Russian"
        case .hi: return "Hindi"
        case .nl: return "Dutch"
        case .pl: return "Polish"
        case .sv: return "Swedish"
        }
    }
}

/// A BCP-47 language tag picker: the curated `CommonLanguage` list, an "Other…" freeform slot for
/// anything else, and — when `allowsInherit` is set — a leading "Use site default" entry that
/// binds `tag` to an empty string. Shared by the Website settings tab (`allowsInherit: false`,
/// this pane's value *is* the site default), the typed-entry inspector, and
/// `LanguageSettingsSection` (both `allowsInherit: true`).
///
/// An empty `tag` is never a validation error — `PlistEditorView`'s Website tab always assigns a
/// concrete `CommonLanguage` or "Other…" value before this is shown, and the per-page call sites
/// treat empty as "inherit" (#956 design doc — this is enforced by the Astro rendering side with
/// `||`, not by anything in this view).
struct LanguagePicker: View {
    @Binding var tag: String
    var allowsInherit: Bool = false
    var siteDefaultTag: String = ""

    private enum Selection: Hashable {
        case inherit
        case common(CommonLanguage)
        case other
    }

    private var selection: Selection {
        if tag.isEmpty { return allowsInherit ? .inherit : .other }
        if let common = CommonLanguage(rawValue: tag) { return .common(common) }
        return .other
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Picker("Language", selection: pickerBinding) {
                if allowsInherit {
                    Text("Use site default (\(siteDefaultTag))").tag(Selection.inherit)
                }
                ForEach(CommonLanguage.allCases) { language in
                    Text(language.displayName).tag(Selection.common(language))
                }
                Text("Other…").tag(Selection.other)
            }
            .labelsHidden()
            if case .other = selection {
                TextField("BCP 47 tag, e.g. \"pt-BR\"", text: $tag)
                    .textFieldStyle(.roundedBorder)
                if let message = validationMessage {
                    Text(message).font(.caption).foregroundStyle(.orange)
                }
            }
        }
    }

    private var pickerBinding: Binding<Selection> {
        Binding(
            get: { selection },
            set: { newValue in
                switch newValue {
                case .inherit:
                    tag = ""
                case .common(let language):
                    tag = language.rawValue
                case .other:
                    // Only clear when leaving a curated selection — leaves an in-progress
                    // freeform edit alone if the user is already on "Other…".
                    if CommonLanguage(rawValue: tag) != nil || (tag.isEmpty && !allowsInherit) {
                        tag = ""
                    }
                }
            }
        )
    }

    /// Soft, non-blocking shape check — not a full BCP-47 grammar validator (#956 design doc
    /// "Known limitations"). `nil` means no warning to show.
    private var validationMessage: String? {
        guard !tag.isEmpty else { return nil }
        let pattern = "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$"
        let matches = tag.range(of: pattern, options: .regularExpression) != nil
        return matches ? nil : "This doesn't look like a BCP 47 language tag, e.g. \"en\" or \"pt-BR\"."
    }
}
