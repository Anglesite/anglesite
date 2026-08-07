import Testing
import SwiftUI
@testable import AnglesiteAppCore

@MainActor
struct EditorFocusRegistryTests {
    @Test("activate then resign with the same token clears active")
    func activateAndResign() {
        let registry = EditorFocusRegistry()
        let controller = MarkdownEditorController()
        registry.activate(.markdown(Weak(controller)), token: controller.id)
        guard case .markdown(let box) = registry.active else {
            Issue.record("expected .markdown to be active")
            return
        }
        #expect(box.value === controller)
        registry.resign(token: controller.id)
        #expect(registry.active == nil)
    }

    @Test("a stale resign does not clobber a newer activation")
    func staleResignIsOwnershipChecked() {
        let registry = EditorFocusRegistry()
        let a = MarkdownEditorController()
        let b = MarkdownEditorController()
        registry.activate(.markdown(Weak(a)), token: a.id)
        registry.activate(.markdown(Weak(b)), token: b.id)
        registry.resign(token: a.id)   // stale resign from a must not clobber b
        guard case .markdown(let box) = registry.active else {
            Issue.record("expected .markdown(b) to remain active")
            return
        }
        #expect(box.value === b)
        registry.resign(token: b.id)
        #expect(registry.active == nil)
    }

    @Test("plainText activates independently of a prior markdown activation")
    func otherCasesActivate() {
        let registry = EditorFocusRegistry()
        let controller = MarkdownEditorController()
        registry.activate(.markdown(Weak(controller)), token: controller.id)

        // A different token (e.g. the plain-text editor, or — since #517's follow-up —
        // the Component Editor's Source-mode TextEditor, both of which share `.plainText`)
        // takes over focus cleanly.
        var isPresented = false
        let binding = Binding(get: { isPresented }, set: { isPresented = $0 })
        registry.activate(.plainText(isPresented: binding), token: "some/file/path")
        guard case .plainText(let presented) = registry.active else {
            Issue.record("expected .plainText to be active")
            return
        }
        presented.wrappedValue = true
        #expect(isPresented == true)
    }

    @Test("a deallocated weak reference reads as nil without crashing")
    func weakBoxReflectsDeallocation() {
        var controller: MarkdownEditorController? = MarkdownEditorController()
        let box = Weak(controller!)
        controller = nil
        #expect(box.value == nil)
    }
}
