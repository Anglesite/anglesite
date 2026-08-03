import Foundation

// MARK: - Request/Response Heads

/// The wire representation of an HTTP request head.
public struct BridgeRequestHead: Codable, Sendable, Equatable {
    /// HTTP method (GET, POST, etc.)
    public var method: String
    /// Path with optional query string, e.g., "/blog/?draft=1"
    public var path: String
    /// Request headers
    public var headers: [String: String]

    /// Create a new bridge request head.
    public init(method: String, path: String, headers: [String: String]) {
        self.method = method
        self.path = path
        self.headers = headers
    }
}

/// The wire representation of an HTTP response head.
public struct BridgeResponseHead: Codable, Sendable, Equatable {
    /// HTTP status code (200, 404, etc.)
    public var status: Int
    /// Response headers
    public var headers: [String: String]

    /// Create a new bridge response head.
    public init(status: Int, headers: [String: String]) {
        self.status = status
        self.headers = headers
    }
}

// MARK: - HTTPBridgeFrame

/// One message on the `http` channel. Concurrent requests interleave, correlated by `id`.
public enum HTTPBridgeFrame: Sendable, Equatable {
    /// Request head for a new HTTP transaction.
    case requestHead(id: UInt32, BridgeRequestHead)
    /// Request body chunk (zero or more per request).
    case requestBody(id: UInt32, Data)
    /// End of request body.
    case requestEnd(id: UInt32)
    /// Response head for the transaction.
    case responseHead(id: UInt32, BridgeResponseHead)
    /// Response body chunk (zero or more per response).
    case responseBody(id: UInt32, Data)
    /// End of response body.
    case responseEnd(id: UInt32)
    /// Abort the transaction; terminal for that id.
    case abort(id: UInt32, reason: String)

    /// Encode the frame to wire format: [kind byte][id: u32 big-endian][payload].
    public func encoded() throws -> Data {
        var data = Data()

        switch self {
        case .requestHead(let id, let head):
            data.append(0)
            data.append(contentsOf: bigEndianBytes(id))
            let json = try JSONEncoder().encode(head)
            data.append(contentsOf: json)

        case .requestBody(let id, let body):
            data.append(1)
            data.append(contentsOf: bigEndianBytes(id))
            data.append(contentsOf: body)

        case .requestEnd(let id):
            data.append(2)
            data.append(contentsOf: bigEndianBytes(id))

        case .responseHead(let id, let head):
            data.append(3)
            data.append(contentsOf: bigEndianBytes(id))
            let json = try JSONEncoder().encode(head)
            data.append(contentsOf: json)

        case .responseBody(let id, let body):
            data.append(4)
            data.append(contentsOf: bigEndianBytes(id))
            data.append(contentsOf: body)

        case .responseEnd(let id):
            data.append(5)
            data.append(contentsOf: bigEndianBytes(id))

        case .abort(let id, let reason):
            data.append(6)
            data.append(contentsOf: bigEndianBytes(id))
            struct AbortPayload: Codable {
                let reason: String
            }
            let json = try JSONEncoder().encode(AbortPayload(reason: reason))
            data.append(contentsOf: json)
        }

        return data
    }

    /// Decode a frame from wire format. Throws malformed for truncated data or unknownKind for unsupported kind bytes.
    public static func decode(_ data: Data) throws -> HTTPBridgeFrame {
        guard data.count >= 5 else {
            throw P2PFramingError.malformed
        }

        let kind = data[data.startIndex]
        // Extract the 4-byte big-endian ID, accounting for Data.startIndex offset
        let idData = UInt32(data[data.startIndex + 1]) << 24
                   | UInt32(data[data.startIndex + 2]) << 16
                   | UInt32(data[data.startIndex + 3]) << 8
                   | UInt32(data[data.startIndex + 4])
        let payload = data.subdata(in: (data.startIndex + 5)..<data.endIndex)

        switch kind {
        case 0: // requestHead
            do {
                let head = try JSONDecoder().decode(BridgeRequestHead.self, from: payload)
                return .requestHead(id: idData, head)
            } catch {
                throw P2PFramingError.malformed
            }

        case 1: // requestBody
            return .requestBody(id: idData, payload)

        case 2: // requestEnd
            return .requestEnd(id: idData)

        case 3: // responseHead
            do {
                let head = try JSONDecoder().decode(BridgeResponseHead.self, from: payload)
                return .responseHead(id: idData, head)
            } catch {
                throw P2PFramingError.malformed
            }

        case 4: // responseBody
            return .responseBody(id: idData, payload)

        case 5: // responseEnd
            return .responseEnd(id: idData)

        case 6: // abort
            do {
                struct AbortPayload: Codable {
                    let reason: String
                }
                let abort = try JSONDecoder().decode(AbortPayload.self, from: payload)
                return .abort(id: idData, reason: abort.reason)
            } catch {
                throw P2PFramingError.malformed
            }

        default:
            throw P2PFramingError.unknownKind(kind)
        }
    }
}

// MARK: - HMRFrame

/// One message on the `hmr` channel — a verbatim WebSocket event.
public enum HMRFrame: Sendable, Equatable {
    /// Text message.
    case text(String)
    /// Binary message.
    case binary(Data)
    /// WebSocket closed frame with an optional code (clamped to UInt16 range on encode).
    case closed(code: Int)

    /// Encode the frame to wire format: [kind byte][payload].
    public func encoded() throws -> Data {
        var data = Data()

        switch self {
        case .text(let str):
            data.append(0)
            if let utf8 = str.data(using: .utf8) {
                data.append(contentsOf: utf8)
            }

        case .binary(let payload):
            data.append(1)
            data.append(contentsOf: payload)

        case .closed(let code):
            data.append(2)
            // Clamp code to UInt16 range for safe conversion
            let clampedCode = UInt16(min(max(code, 0), Int(UInt16.max)))
            data.append(contentsOf: [UInt8((clampedCode >> 8) & 0xFF), UInt8(clampedCode & 0xFF)])
        }

        return data
    }

    /// Decode a frame from wire format.
    public static func decode(_ data: Data) throws -> HMRFrame {
        guard !data.isEmpty else {
            throw P2PFramingError.malformed
        }

        let kind = data[data.startIndex]
        let payload = data.subdata(in: (data.startIndex + 1)..<data.endIndex)

        switch kind {
        case 0: // text
            guard let str = String(data: payload, encoding: .utf8) else {
                throw P2PFramingError.malformed
            }
            return .text(str)

        case 1: // binary
            return .binary(payload)

        case 2: // closed
            guard payload.count >= 2 else {
                throw P2PFramingError.malformed
            }
            let codeBytes = UInt16(data: payload.subdata(in: payload.startIndex..<(payload.startIndex + 2)))
            return .closed(code: Int(codeBytes))

        default:
            throw P2PFramingError.unknownKind(kind)
        }
    }
}

// MARK: - ControlMessage

/// JSON messages on the `control` channel. Session lifecycle, heartbeat, and deploy management.
/// `deployRequest` and `deployEvent` are declared now so the wire enum is stable,
/// but P0 ships no handler for them (P5).
public enum ControlMessage: Codable, Sendable, Equatable {
    /// Session startup handshake.
    case hello(sessionID: String)
    /// Heartbeat request.
    case ping(seq: Int)
    /// Heartbeat response.
    case pong(seq: Int)
    /// Deploy request (P5).
    case deployRequest(id: String)
    /// Deploy progress event (P5).
    case deployEvent(id: String, line: String)

    enum CodingKeys: String, CodingKey {
        case type, sessionID, seq, id, line
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "hello":
            let sessionID = try container.decode(String.self, forKey: .sessionID)
            self = .hello(sessionID: sessionID)

        case "ping":
            let seq = try container.decode(Int.self, forKey: .seq)
            self = .ping(seq: seq)

        case "pong":
            let seq = try container.decode(Int.self, forKey: .seq)
            self = .pong(seq: seq)

        case "deployRequest":
            let id = try container.decode(String.self, forKey: .id)
            self = .deployRequest(id: id)

        case "deployEvent":
            let id = try container.decode(String.self, forKey: .id)
            let line = try container.decode(String.self, forKey: .line)
            self = .deployEvent(id: id, line: line)

        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown type: \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .hello(let sessionID):
            try container.encode("hello", forKey: .type)
            try container.encode(sessionID, forKey: .sessionID)

        case .ping(let seq):
            try container.encode("ping", forKey: .type)
            try container.encode(seq, forKey: .seq)

        case .pong(let seq):
            try container.encode("pong", forKey: .type)
            try container.encode(seq, forKey: .seq)

        case .deployRequest(let id):
            try container.encode("deployRequest", forKey: .type)
            try container.encode(id, forKey: .id)

        case .deployEvent(let id, let line):
            try container.encode("deployEvent", forKey: .type)
            try container.encode(id, forKey: .id)
            try container.encode(line, forKey: .line)
        }
    }
}

// MARK: - Errors

/// Errors thrown during P2P frame decoding.
public enum P2PFramingError: Error, Equatable {
    /// Frame is malformed (truncated, invalid JSON, etc.).
    case malformed
    /// Unknown frame kind byte.
    case unknownKind(UInt8)
}

// MARK: - Helpers

/// Convert a UInt32 to big-endian bytes [byte3, byte2, byte1, byte0]
fileprivate func bigEndianBytes(_ value: UInt32) -> [UInt8] {
    [UInt8((value >> 24) & 0xFF), UInt8((value >> 16) & 0xFF), UInt8((value >> 8) & 0xFF), UInt8(value & 0xFF)]
}

extension UInt16 {
    fileprivate init(data: Data) {
        self = UInt16(data[0]) << 8 | UInt16(data[1])
    }
}
