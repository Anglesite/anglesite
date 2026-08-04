import AppKit
import AuthenticationServices

/// Anchors the OAuth browser sheet to the app's key window. No state beyond that — thin enough to
/// be verified by a manual smoke test (does "Sign in with Cloudflare" show a window-anchored
/// sheet?) rather than a unit test, per the design doc's Testing section.
final class CloudflareOAuthPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
    }
}
