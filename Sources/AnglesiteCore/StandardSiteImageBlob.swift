import Foundation

/// Prepares local image files for upload as Standard.site `blob` fields (`site.standard.publication`
/// `icon`, `site.standard.document` `coverImage` — v1.1, #1234). Both fields are capped at 1 MB by
/// the lexicon; this type enforces that cap by size alone rather than downscaling. `AnglesiteCore`
/// is a portable target (builds and tests on Linux — see CONTRIBUTING "Developing on Linux") with
/// no CoreGraphics/ImageIO dependency anywhere in it today, and adding real image
/// decode/downscale here would be the first exception to that. An oversize source image is
/// skipped (logged, not uploaded) rather than downscaled — a known, deliberate gap versus the
/// design doc's "downscale as needed," left for a follow-up that can thread a downscaling closure
/// in from the Darwin-only app target the way every other dependency in ``StandardSitePublishCommand``
/// is injected.
public enum StandardSiteImageBlob {
    /// The lexicon's shared size ceiling for `icon` and `coverImage`
    /// (https://standard.site/docs/lexicons/document, /publication).
    public static let maxBytes = 1_000_000

    /// One image file, read and ready to hand to
    /// ``AtprotoPutRecordClient/uploadBlob(data:mimeType:pdsURL:session:transport:)``.
    public struct Prepared: Equatable, Sendable {
        public let data: Data
        public let mimeType: String
    }

    /// Reason a local image couldn't be prepared for upload — every case is a *skip*, not an
    /// error: the publish pass omits the blob field and (for oversize images) logs why, but never
    /// fails the pass over it.
    public enum SkipReason: Error, Equatable, Sendable {
        case fileNotFound
        case unsupportedExtension(String)
        case tooLarge(bytes: Int)
    }

    /// Reads `fileURL` and returns it ready for upload, or the reason it can't be. Never throws —
    /// every failure mode here (missing file, unsupported extension, oversize) is expected and
    /// handled by the caller as a skip.
    public static func prepare(fileURL: URL, fileManager: FileManager = .default) -> Result<Prepared, SkipReason> {
        guard let mimeType = mimeType(for: fileURL) else {
            return .failure(.unsupportedExtension(fileURL.pathExtension))
        }
        guard let data = try? Data(contentsOf: fileURL) else {
            return .failure(.fileNotFound)
        }
        guard data.count <= maxBytes else {
            return .failure(.tooLarge(bytes: data.count))
        }
        return .success(Prepared(data: data, mimeType: mimeType))
    }

    /// Maps a file extension to its MIME type for the formats standard.site readers are expected
    /// to render; `nil` for anything else rather than guessing `application/octet-stream`, since
    /// an unrecognized extension is far more likely to be a non-image frontmatter value than a
    /// real image the caller should upload.
    static func mimeType(for fileURL: URL) -> String? {
        switch fileURL.pathExtension.lowercased() {
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "gif": "image/gif"
        case "webp": "image/webp"
        default: nil
        }
    }
}
