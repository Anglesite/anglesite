import Foundation

/// Serves GET requests from a directory root: `"/"` serves `index.html`; content-type is chosen
/// by file extension (html, css, js, mjs, json, svg, png, jpg, webp, txt; else
/// `application/octet-stream`).
///
/// P0/tests stand-in for the P1 production executor (`URLSession` against the container dev
/// server). Non-GET requests are rejected with 405, and any `".."` path component is rejected
/// with 400 — both checks run **before** any filesystem access.
public struct DirectoryHTTPExecutor: HTTPExecutor {
    private let root: URL

    /// Content-type by lowercased file extension (spec §Approaches B).
    private static let contentTypes: [String: String] = [
        "html": "text/html",
        "css": "text/css",
        "js": "text/javascript",
        "mjs": "text/javascript",
        "json": "application/json",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "webp": "image/webp",
        "txt": "text/plain",
    ]

    /// Bytes read per filesystem chunk when streaming a file's body (spec §Approaches B).
    private static let readChunkSize = 64 * 1_024

    /// Serves files under `root`.
    public init(root: URL) {
        self.root = root
    }

    /// Resolves `request.path` against `root` and streams the matching file. Rejects non-GET
    /// methods (405) and any `".."` path component (400) before touching the filesystem; a
    /// missing file is 404.
    public func execute(_ request: BridgeRequestHead, body: Data?) async throws
        -> (head: BridgeResponseHead, body: AsyncThrowingStream<Data, Error>) {
        guard request.method.uppercased() == "GET" else {
            return (BridgeResponseHead(status: 405, headers: [:]), Self.emptyBody())
        }

        let path = request.path.components(separatedBy: "?").first ?? request.path
        guard !path.components(separatedBy: "/").contains("..") else {
            return (BridgeResponseHead(status: 400, headers: [:]), Self.emptyBody())
        }

        let relativePath = path == "/" ? "index.html" : String(path.drop(while: { $0 == "/" }))
        let fileURL = root.appendingPathComponent(relativePath)

        guard let fileHandle = FileHandle(forReadingAtPath: fileURL.path) else {
            return (BridgeResponseHead(status: 404, headers: [:]), Self.emptyBody())
        }

        let contentType = Self.contentTypes[fileURL.pathExtension.lowercased()] ?? "application/octet-stream"
        let head = BridgeResponseHead(status: 200, headers: ["Content-Type": contentType])
        let stream = AsyncThrowingStream<Data, Error> { continuation in
            do {
                while let chunk = try fileHandle.read(upToCount: Self.readChunkSize), !chunk.isEmpty {
                    continuation.yield(chunk)
                }
                try fileHandle.close()
                continuation.finish()
            } catch {
                continuation.finish(throwing: error)
            }
        }
        return (head, stream)
    }

    private static func emptyBody() -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { $0.finish() }
    }
}
