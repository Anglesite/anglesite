// Sources/AnglesiteApp/LanguageSettingsSection.swift
import SwiftUI

/// Per-page language override for a plain frontmatter page or blog post — mirrors
/// `RobotsSettingsSection`'s shape (a small, reusable `Section` composed into `PageMetadataForm`).
struct LanguageSettingsSection: View {
    @Binding var tag: String
    let siteDefaultTag: String

    var body: some View {
        Section("Language") {
            LanguagePicker(tag: $tag, siteDefaultTag: siteDefaultTag)
        }
    }
}
