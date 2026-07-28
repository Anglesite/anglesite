import Testing
import Foundation
@testable import AnglesiteCore

@Suite struct TemplateScriptsManifestTests {
    private func tmpDir() -> URL {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func writeFile(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    @Test func excludesScaffoldInfraAndTopLevelTestFilesOnly() throws {
        let root = tmpDir()
        let scripts = root.appendingPathComponent("scripts")
        try writeFile("keep", to: scripts.appendingPathComponent("keep.ts"))
        try writeFile("scaffold", to: scripts.appendingPathComponent("scaffold.sh"))
        try writeFile("themes", to: scripts.appendingPathComponent("themes.ts"))
        try writeFile("themesjson", to: scripts.appendingPathComponent("themes.json"))
        try writeFile("drop", to: scripts.appendingPathComponent("drop.test.ts"))
        try writeFile("adapter", to: scripts.appendingPathComponent("embeds/adapter.ts"))
        try writeFile("adapterTest", to: scripts.appendingPathComponent("embeds/adapter.test.ts"))
        try writeFile("fixture", to: scripts.appendingPathComponent("embeds/fixtures/data.json"))

        let result = TemplateScriptsManifest.appOwnedRelativePaths(templateRoot: root)

        #expect(result == [
            "scripts/embeds/adapter.test.ts",
            "scripts/embeds/adapter.ts",
            "scripts/embeds/fixtures/data.json",
            "scripts/keep.ts",
        ])
    }

    @Test func returnsEmptyWhenScriptsDirectoryIsMissing() {
        let root = tmpDir()
        #expect(TemplateScriptsManifest.appOwnedRelativePaths(templateRoot: root).isEmpty)
    }

    @Test func excludesDSStoreAtAnyDepthButNoOtherDotfiles() throws {
        let root = tmpDir()
        let scripts = root.appendingPathComponent("scripts")
        try writeFile("keep", to: scripts.appendingPathComponent("keep.ts"))
        try writeFile("ds1", to: scripts.appendingPathComponent(".DS_Store"))
        try writeFile("ds2", to: scripts.appendingPathComponent("embeds/.DS_Store"))
        // Not `.DS_Store` — a real dotfile that `scaffold.sh`'s rsync would still copy, and that
        // `.skipsHiddenFiles` would have wrongly dropped.
        try writeFile("dotfile", to: scripts.appendingPathComponent(".env.example"))

        let result = TemplateScriptsManifest.appOwnedRelativePaths(templateRoot: root)

        #expect(result == [
            "scripts/.env.example",
            "scripts/keep.ts",
        ])
    }
}
