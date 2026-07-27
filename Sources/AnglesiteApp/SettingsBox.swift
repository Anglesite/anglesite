import SwiftUI

/// A nested, bordered settings section — mirrors Xcode's Signing & Capabilities
/// boxes (e.g. "Signing (Debug)", "App Sandbox"): bold header, no icon, subtle fill.
struct SettingsBox<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
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
        Text("Box content")
    }
    .padding()
}
