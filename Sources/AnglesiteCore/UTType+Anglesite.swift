// Compiled out off-Darwin (cross-platform port design §5): there is no package-UTI concept
// on Linux/Windows — `.anglesite` is a plain directory there, and identity comes from the
// Info.plist UUID (AnglesiteSiteModel), which is fully portable. No AnglesiteCore code
// references this extension; its consumers (NSOpenPanel, Finder integration) live in the
// Darwin-only app shell.
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers

public extension UTType {
    /// The `.anglesite` site package type the app exports (declared in both targets' Info.plist as
    /// `io.dwk.anglesite.site`).
    ///
    /// Uses `exportedAs:` (non-failable) rather than `UTType("io.dwk.anglesite.site")` (failable):
    /// the failable initializer returns `nil` when the UTI hasn't been registered in the current
    /// process — which includes `swift test`/CI contexts — and a `nil` slipped into
    /// `NSOpenPanel.allowedContentTypes` silently makes the panel accept every file type. All
    /// call sites should use `.anglesiteSite`.
    static let anglesiteSite = UTType(exportedAs: "io.dwk.anglesite.site")

    /// Content types for the Component Editor's drag-and-drop payloads (`ComponentOutline.swift`,
    /// Task 15/16/17/18). Unlike `.anglesiteSite`, these are **not** declared in any
    /// `UTExportedTypeDeclarations` Info.plist array, and shouldn't be: they only ever travel
    /// through `Transferable`'s `CodableRepresentation` between a `.draggable` source and a
    /// `.dropDestination` in the *same running app*, so the content-type identifier only needs to
    /// match by string between those two in-process call sites — there's no file to open, no
    /// filename extension, and no cross-process/Launch Services resolution (Finder, Quick Look,
    /// Spotlight) involved, which is what Info.plist registration is for.
    static let anglesiteComponentDragItem = UTType(exportedAs: "io.dwk.anglesite.component-drag-item")
    /// Drag payload for palette items dragged into the Component Editor outline — in-process only,
    /// unregistered by design (see `anglesiteComponentDragItem` above for why).
    static let anglesitePaletteDragPayload = UTType(exportedAs: "io.dwk.anglesite.palette-drag-payload")
    /// Drag payload for reordering existing nodes within the Component Editor outline — in-process
    /// only, unregistered by design (see `anglesiteComponentDragItem` above for why).
    static let anglesiteOutlineDragPayload = UTType(exportedAs: "io.dwk.anglesite.outline-drag-payload")
}
#endif
