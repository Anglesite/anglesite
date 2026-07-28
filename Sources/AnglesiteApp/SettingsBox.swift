import SwiftUI

/// A nested, bordered settings section — mirrors Xcode's Signing & Capabilities
/// boxes (e.g. "Signing (Debug)", "App Sandbox"): bold header, no icon, subtle fill.
struct SettingsBox<Content: View>: View {
    private let title: Text
    @ViewBuilder let content: () -> Content

    init(title: LocalizedStringKey, @ViewBuilder content: @escaping () -> Content) {
        self.title = Text(title)
        self.content = content
    }

    init(verbatimTitle: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = Text(verbatim: verbatimTitle)
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            title.font(.headline)
            content()
        }
        .padding(10)
        .background(Color.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.secondary.opacity(0.15))
        }
    }
}

#Preview {
    SettingsBox(title: "Preview Box") {
        Text(verbatim: "Box content")
    }
    .padding()
}
