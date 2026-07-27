import Foundation

/// Guarantees that a string is safe to render as-is in UI chrome the user is expected to read
/// and trust — no Unicode formatting or control characters that can alter how the visible text
/// is laid out.
///
/// Anything derived from attacker-controlled input (a remote actor's IRI path segment, a
/// `name` / `preferredUsername` fetched from a hostile server, etc.) can smuggle invisible
/// Unicode bidi-control characters (U+202E RIGHT-TO-LEFT OVERRIDE, U+2066–U+2069 isolates,
/// U+200E/U+200F directional marks, U+00AD soft hyphen, and other `format`/`control` scalars)
/// into a string that otherwise looks like an ordinary name. Embedded verbatim, those characters
/// can make a handle render as if it were a different, trusted one — a real impersonation vector
/// when the only defense against a hostile Fediverse follower is recognizing it in a list (the
/// ActivityPub package this app consumes has no block/remove operation).
///
/// `safe(_:)` is the single place this rule lives, so every display path that runs attacker-shaped
/// text through it gets the guarantee once rather than re-implementing (or forgetting) it at each
/// call site.
public enum DisplayString {
    /// Returns a copy of `string` with all Unicode scalars in the `format` (Cf) and `control`
    /// (Cc) general categories removed. Ordinary text — including non-ASCII scripts and
    /// emoji — passes through unchanged; only invisible formatting/control scalars are stripped.
    public static func safe(_ string: String) -> String {
        String(String.UnicodeScalarView(string.unicodeScalars.filter { scalar in
            switch scalar.properties.generalCategory {
            case .format, .control:
                return false
            default:
                return true
            }
        }))
    }
}
