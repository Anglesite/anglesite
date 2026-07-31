// Sources/AnglesiteApp/LanguagePicker.swift
import SwiftUI

/// A curated set of common web languages, keyed by BCP-47 subtag. "Other…" is the escape hatch
/// for anything not listed here.
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

/// A BCP-47 language tag picker for a per-page override: the curated `CommonLanguage` list, an
/// "Other…" freeform slot, and a leading "Use site default" entry mapping to an empty string
/// (the codebase's existing empty-string-means-unset idiom for optional overrides).
///
/// Matches an existing tag by its PRIMARY subtag (before the first "-"), not the exact raw value
/// — `SiteLanguageAsset.hostLanguageTag()` returns region-qualified tags like "en-US" for nearly
/// every host, and matching only bare "en" would show "Other…" for that common case.
struct LanguagePicker: View {
    @Binding var tag: String
    let siteDefaultTag: String

    private enum Selection: Hashable {
        case inherit
        case common(CommonLanguage)
        case other
    }

    @State private var manualOtherSelected = false

    private var selection: Selection {
        if manualOtherSelected { return .other }
        if tag.isEmpty { return .inherit }
        let primarySubtag = tag.split(separator: "-").first.map { String($0).lowercased() } ?? tag.lowercased()
        if let common = CommonLanguage(rawValue: primarySubtag) { return .common(common) }
        return .other
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Picker("Language", selection: pickerBinding) {
                Text("Use site default (\(siteDefaultTag))").tag(Selection.inherit)
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
                    manualOtherSelected = false
                case .common(let language):
                    tag = language.rawValue
                    manualOtherSelected = false
                case .other:
                    manualOtherSelected = true
                    if CommonLanguage(rawValue: tag) != nil { tag = "" }
                }
            }
        )
    }

    private var validationMessage: String? {
        guard !tag.isEmpty else { return nil }
        let pattern = "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$"
        let matches = tag.range(of: pattern, options: .regularExpression) != nil
        return matches ? nil : "This doesn't look like a BCP 47 language tag, e.g. \"en\" or \"pt-BR\"."
    }
}
