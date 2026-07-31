import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

/// #964: the `resume` singleton renders real h-resume mf2 (with experience/education nested as
/// h-event), schema.org JSON-LD, and a discovery link from the site's h-card footer.
@Suite("h-resume render smoke")
struct HresumeRenderSmokeTests {

    static var templateDir: URL { get throws { try templateRoot() } }

    static var buildable: Bool { ((try? templateDir).map { E2EPrerequisites.astroBuildable(templateDir: $0) }) ?? false }

    @Test("resume page renders h-resume mf2 + JSON-LD when configured, a placeholder when not, and links from the h-card",
          .enabled(if: HresumeRenderSmokeTests.buildable))
    func rendersResume() async throws {
        let node = try #require(E2EPrerequisites.locateNode())
        let dataDir = try Self.templateDir.appendingPathComponent("src/data", isDirectory: true)
        let resumeFile = dataDir.appendingPathComponent("resume.json")
        let profileFile = dataDir.appendingPathComponent("profile.json")
        let dist = try Self.templateDir.appendingPathComponent("dist", isDirectory: true)

        func build() async throws {
            try? FileManager.default.removeItem(at: dist)
            let result = try await ProcessSupervisor.shared.run(
                executable: node,
                arguments: [E2EPrerequisites.astroCLIRelativePath, "build"],
                currentDirectoryURL: Self.templateDir)
            try #require(result.exitCode == 0, "astro build failed: \(result.stdout)\n\(result.stderr)")
        }
        func resumeHTML() throws -> String {
            try String(contentsOf: dist.appendingPathComponent("resume/index.html"), encoding: .utf8)
        }
        func indexHTML() throws -> String {
            try String(contentsOf: dist.appendingPathComponent("index.html"), encoding: .utf8)
        }
        func write(_ url: URL, _ json: String) throws {
            try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
            try json.write(to: url, atomically: true, encoding: .utf8)
        }

        try await TemplateBuildSerializer.shared.serialize {
            defer {
                try? FileManager.default.removeItem(at: resumeFile)
                try? FileManager.default.removeItem(at: profileFile)
                try? FileManager.default.removeItem(at: dist)
            }

            // 1. Unconfigured: no resume.json → placeholder page, no h-resume markup.
            try? FileManager.default.removeItem(at: resumeFile)
            try await build()
            #expect(!(try resumeHTML().contains("h-resume")))

            // 1b. Scaffolded but incomplete: `ContentTypeScaffold.renderSingleton` fills only the
            // title-like `name` field and leaves every other scalar (including the required
            // `summary`) as `""`. Fix 1 (#964 final review): resume.astro must degrade this to
            // the same placeholder as "absent" rather than emit an h-resume root missing
            // p-summary, which would fail the non-overridable pre-deploy mf2 gate.
            try write(resumeFile, """
            {
              "type": "resume",
              "name": "Jane Doe",
              "summary": "",
              "experience": [],
              "education": [],
              "skills": []
            }
            """)
            try await build()
            #expect(!(try resumeHTML().contains("h-resume")))

            // 2. Configured: full mf2 + JSON-LD.
            try write(resumeFile, """
            {
              "type": "resume",
              "name": "Jane Doe",
              "summary": "Backend engineer with a decade of distributed-systems experience.",
              "experience": [
                {"title": "Senior Engineer", "organization": "Acme Corp", "startDate": "2020-01-01", "endDate": "2024-06-30", "description": "Led the platform team."}
              ],
              "education": [
                {"degree": "B.S. Computer Science", "institution": "State University", "startDate": "2012-09-01", "endDate": "2016-05-15", "description": ""}
              ],
              "skills": ["Swift", "TypeScript"]
            }
            """)
            try await build()
            let resume = try resumeHTML()
            #expect(resume.contains("h-resume"))
            #expect(resume.contains("Jane Doe"))
            #expect(resume.contains("p-experience h-event"))
            #expect(resume.contains("p-org h-card"))
            #expect(resume.contains("Acme Corp"))
            #expect(resume.contains("dt-start"))
            #expect(resume.contains("2020-01-01"))
            #expect(resume.contains("p-education h-event"))
            #expect(resume.contains("p-skill"))
            #expect(resume.contains("Swift"))
            #expect(resume.contains("application/ld+json"))
            #expect(resume.contains("\"@type\":\"Person\""))
            #expect(resume.contains("\"hasOccupation\""))
            #expect(resume.contains("\"alumniOf\""))

            // 3. Discovery: the site h-card footer links to /resume/ once both singletons exist.
            try write(profileFile, #"{"type":"personalProfile","name":"Jane Doe"}"#)
            try await build()
            #expect(try indexHTML().contains(#"href="/resume/""#))
        }
    }
}
