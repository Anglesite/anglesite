// Tests/AnglesiteCoreTests/AnimationCatalogTests.swift
// Resolves the template via AnglesiteTestSupport.templateRoot() (a #filePath walk-up to the repo
// root), like IntegrationTemplateAssetsTests — hermetic, no app bundle or TemplateRuntime needed.
import Testing
import Foundation
import AnglesiteTestSupport
@testable import AnglesiteCore

@Suite struct AnimationCatalogTests {
    @Test func loadsRealTemplateCatalog() throws {
        let catalog = try AnimationCatalog.load(templateDirectory: try templateRoot())
        #expect(!catalog.entries.isEmpty)
        for entry in catalog.entries {
            #expect(!entry.snippet.contains("enhance={true}"))
            let demo = AnimationCatalog.demoURL(
                templateDirectory: try templateRoot(), component: entry.component)
            #expect(FileManager.default.fileExists(atPath: demo.path), "\(entry.component)")
        }
    }

    @Test func groupsByCategory() throws {
        let catalog = try AnimationCatalog.load(templateDirectory: try templateRoot())
        let grouped = AnimationCategory.allCases.flatMap { catalog.entries(in: $0) }
        #expect(grouped.count == catalog.entries.count)
    }
}
