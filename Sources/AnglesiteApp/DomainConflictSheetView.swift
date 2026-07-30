import SwiftUI

/// Sheet shown when a "Transfer an existing domain" site's configured host is already attached
/// as a Workers Custom Domain to a *different* Worker script (#1077) — informs, doesn't
/// remediate in-app (resolving a cross-Worker domain conflict needs the Cloudflare dashboard).
/// Doesn't block the deploy drawer: wrangler already succeeded on its workers.dev address by the
/// time this check runs.
struct DomainConflictSheetView: View {
    let hostname: String
    let ownedBy: String
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Custom domain already in use")
                    .font(.headline)
                Text("“\(hostname)” is already connected to another site (\(ownedBy)). This deploy succeeded at its workers.dev address, but won't use \(hostname) until that's resolved in your Cloudflare dashboard.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Spacer()
                Button("OK") { onDismiss() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 420)
    }
}

#Preview {
    DomainConflictSheetView(hostname: "example.com", ownedBy: "other-site", onDismiss: {})
}
