import Testing
import Foundation
import CoreGraphics
import ImageIO
@testable import AnglesiteAppCore

/// Covers `FollowerAvatar.dimensionsWithinBound(_:)` (#364): the guard that rejects a follower
/// avatar's *declared* pixel dimensions before `ImageIO` is asked to decode the raster. It exists
/// specifically to stop a decompression bomb — a file that is small on the wire but declares an
/// enormous width/height — so it needs to be verified, not just read.
@Suite("FollowerAvatar.dimensionsWithinBound")
struct FollowerAvatarDimensionsTests {
    // MARK: - Fixtures

    /// Builds a real PNG declaring exactly `width` x `height` pixels by rendering into a
    /// `CGContext` and encoding it with `CGImageDestination`. Kept 1px tall for the oversized case
    /// so a "5000-wide" fixture costs 5000 pixels to allocate, not 5000x5000.
    private static func pngData(width: Int, height: Int) throws -> Data {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let context = try #require(
            CGContext(
                data: nil,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let cgImage = try #require(context.makeImage())

        let data = NSMutableData()
        let destination = try #require(
            CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil))
        CGImageDestinationAddImage(destination, cgImage, nil)
        #expect(CGImageDestinationFinalize(destination))
        return data as Data
    }

    private static func imageSource(width: Int, height: Int) throws -> CGImageSource {
        let data = try pngData(width: width, height: height)
        return try #require(CGImageSourceCreateWithData(data as CFData, nil))
    }

    // MARK: - Tests

    @Test("accepts declared dimensions within the bound")
    func acceptsWithinBound() throws {
        let source = try Self.imageSource(width: 64, height: 32)
        #expect(FollowerAvatar.dimensionsWithinBound(source))
    }

    @Test("accepts declared dimensions exactly at the bound")
    func acceptsAtBound() throws {
        let bound = FollowerAvatar.maximumDeclaredPixelDimension
        // 1px tall keeps this fast even though the bound is 4096.
        let source = try Self.imageSource(width: bound, height: 1)
        #expect(FollowerAvatar.dimensionsWithinBound(source))
    }

    @Test("rejects a declared dimension over the bound (decompression-bomb shape)")
    func rejectsOverBound() throws {
        let bound = FollowerAvatar.maximumDeclaredPixelDimension
        // A 1px-tall image keeps the fixture cheap to allocate (5000 pixels, not 5000x5000)
        // while still declaring a width over the bound — exactly the shape a decompression
        // bomb relies on: small on the wire, enormous once decoded.
        let source = try Self.imageSource(width: bound + 904, height: 1)
        #expect(!FollowerAvatar.dimensionsWithinBound(source))
    }

    @Test("rejects a CGImageSource built from non-image data instead of crashing")
    func rejectsInvalidImageData() throws {
        let garbage = Data("not an image".utf8)
        // Some ImageIO builds still hand back a source object for unrecognized bytes (it defers
        // format sniffing), so this only `#require`s the value exists at all — the real
        // assertion is that reading properties from it is treated as "can't measure" and
        // rejected, per `dimensionsWithinBound`'s own doc comment.
        let source = try #require(CGImageSourceCreateWithData(garbage as CFData, nil))
        #expect(!FollowerAvatar.dimensionsWithinBound(source))
    }
}
