import Testing
import Foundation
@testable import AnglesiteAppCore

@MainActor
struct MarkdownEditorControllerTests {
    @Test("bus names are unique per controller instance and per verb")
    func busNamesUnique() {
        let a = MarkdownEditorController()
        let b = MarkdownEditorController()
        #expect(a.busNames.applyBold != b.busNames.applyBold)
        #expect(a.busNames.findQuery != b.busNames.findQuery)
        #expect(a.busNames.applyBold != a.busNames.applyItalic)
    }

    @Test("perform posts the matching bus notification")
    func performPostsNotification() async {
        let controller = MarkdownEditorController()
        await confirmation { confirm in
            let token = NotificationCenter.default.addObserver(
                forName: controller.busNames.applyBold, object: nil, queue: nil) { _ in confirm() }
            controller.perform(.bold)
            NotificationCenter.default.removeObserver(token)
        }
    }

    @Test("heading command carries its level")
    func headingCarriesLevel() {
        final class Box: @unchecked Sendable { var level: Int? }   // sync delivery on main
        let controller = MarkdownEditorController()
        let box = Box()
        let token = NotificationCenter.default.addObserver(
            forName: controller.busNames.applyHeading, object: nil, queue: nil) { note in
            box.level = note.userInfo?["level"] as? Int
        }
        controller.perform(.heading(3))
        NotificationCenter.default.removeObserver(token)
        #expect(box.level == 3)
    }

    @Test("find results from the engine update match state, and next/previous wrap")
    func findResultsAndWrapping() {
        let controller = MarkdownEditorController()
        controller.query = "needle"
        NotificationCenter.default.post(
            name: controller.busNames.findResults, object: nil, userInfo: ["count": 3])
        #expect(controller.matchCount == 3)
        controller.findNext()
        controller.findNext()
        controller.findNext()   // 0 → 1 → 2 → wraps to 0
        #expect(controller.currentMatchIndex == 0)
        controller.findPrevious()   // wraps back to 2
        #expect(controller.currentMatchIndex == 2)
    }

    @Test("shrinking results clamp the current index")
    func shrinkingResultsClampIndex() {
        let controller = MarkdownEditorController()
        controller.query = "x"
        NotificationCenter.default.post(
            name: controller.busNames.findResults, object: nil, userInfo: ["count": 5])
        controller.findNext(); controller.findNext(); controller.findNext(); controller.findNext()
        #expect(controller.currentMatchIndex == 4)
        NotificationCenter.default.post(
            name: controller.busNames.findResults, object: nil, userInfo: ["count": 2])
        #expect(controller.currentMatchIndex == 1)
    }
}
