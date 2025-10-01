# User Story 02: Visual Page Editing

**Priority:** P0 (Critical - MVP)
**Story Points:** 13
**Estimated Duration:** 8-10 days
**Persona:** Sarah (Personal Brand Builder), Emma (Privacy-Conscious Creator)
**Epic:** Content Creation & Editing

## Complexity Assessment

**Points Breakdown:**
- WYSIWYG editor implementation (ProseMirror/Slate.js integration): 5 points
- Live preview sync and file watching: 3 points
- Undo/redo system: 2 points
- Toolbar and formatting UI: 2 points
- Auto-save and conflict resolution: 1 point

**Justification:** High complexity due to contentEditable challenges and real-time sync between editor and file system. Requires battle-tested library for WYSIWYG editing. Memory management and performance optimization critical for long editing sessions.

## Story

**As a** website owner without coding skills
**I want to** edit my website's content visually with live preview
**So that** I can see exactly what I'm building without learning HTML/CSS

## Acceptance Criteria

### Given: User has a website open in Anglesite
- [ ] Editor window displays current page content
- [ ] Preview pane shows live rendering
- [ ] Toolbar shows available editing actions
- [ ] File tree shows all pages in sidebar

### When: User edits content
- [ ] Click-to-edit on text elements
- [ ] Drag-and-drop to rearrange components
- [ ] Live preview updates without page reload
- [ ] Changes are saved automatically (debounced)
- [ ] Undo/redo functionality works

### Then: Content is updated
- [ ] HTML/markdown files updated on disk
- [ ] Changes persist across app restarts
- [ ] Local dev server reflects changes immediately
- [ ] File system watchers trigger rebuilds

## Technical Details

### Implementation Architecture

**Editor Mode Options:**
1. **WYSIWYG Mode** (Primary for MVP)
   - ContentEditable div overlay
   - Map clicks to source elements
   - Update HTML/markdown files

2. **Split View Mode**
   - Left: Code editor (Monaco/CodeMirror)
   - Right: Live preview
   - Sync scroll positions

3. **Preview Only Mode**
   - Full preview without edit affordances
   - Responsive device frames

### Data Flow
```
User Input → React Editor Component
    ↓
IPC: update-page-content
    ↓
Main Process: FileService
    ↓
Write to disk (src/pages/*.html)
    ↓
11ty watches & rebuilds
    ↓
Dev server updates
    ↓
Preview window auto-refreshes
```

### Key Components

**Renderer Process:**
- `<PageEditor>` - Main editing interface
- `<EditableBlock>` - Individual content blocks
- `<Toolbar>` - Formatting actions
- `<PageTree>` - File/page navigation

**Main Process:**
- `ReactEditorHandler` (IPC) - Edit operations
- `FileWatcherService` - Monitor changes
- `WebsiteServerManager` - Serve preview
- `HistoryService` - Undo/redo tracking

### IPC Channels Needed
```typescript
'react-editor:update-content' // Save edited content
'react-editor:get-content'    // Load page content
'react-editor:undo'            // Undo last change
'react-editor:redo'            // Redo change
'react-editor:insert-element' // Add new component
```

## User Flow Diagram

```
[Open Website]
    ↓
[Editor Window Loads]
    ↓
[Preview Shows Current Page]
    ↓
[User Clicks Element] → (Highlight + Show Toolbar)
    ↓
[User Types/Edits] → (Live Preview Updates)
    ↓
[Auto-save] ← (Debounced 1s after last edit)
    ↓
[Continue Editing] OR [Switch Page] OR [Close]
```

## Editing Capabilities (MVP)

### Text Editing
- [ ] Headings (H1-H6)
- [ ] Paragraphs
- [ ] Bold, italic, underline
- [ ] Links (with URL editor)
- [ ] Lists (ordered, unordered)

### Media
- [ ] Image insertion (drag-drop or file picker)
- [ ] Image alt text
- [ ] Image resize/crop (basic)

### Layout
- [ ] Add new section/block
- [ ] Reorder sections (drag-drop)
- [ ] Delete sections
- [ ] Duplicate sections

### Actions
- [ ] Undo (Cmd/Ctrl+Z)
- [ ] Redo (Cmd/Ctrl+Shift+Z)
- [ ] Save (Cmd/Ctrl+S) - explicit save option
- [ ] Preview in browser (Cmd/Ctrl+P)

## Success Metrics

- **Edit Latency**: < 100ms from keypress to preview update
- **Save Reliability**: 99.9% of edits persisted correctly
- **Undo Depth**: Support 50+ undo levels
- **User Efficiency**: Common edits achievable in < 5 clicks
- **Learning Curve**: Users make first successful edit within 30 seconds

## Edge Cases & Error Handling

1. **File Lock/Permission Issues**
   - Detect read-only files before editing
   - Show warning and offer to copy file
   - Graceful degradation to read-only mode

2. **Concurrent External Edits**
   - Detect file changes from outside Anglesite
   - Prompt: "File changed externally. Reload or Keep your changes?"
   - Diff view to compare changes

3. **Invalid HTML After Edit**
   - Validate HTML structure before saving
   - Prevent breaking page structure
   - Show error and rollback if needed

4. **Large Files**
   - Warn if page > 1MB
   - Consider pagination or lazy loading
   - Optimize render performance

5. **Network Drive Latency**
   - Detect slow file operations
   - Show progress indicator
   - Buffer writes to reduce I/O

## UI Mockup Notes

### Editor Layout
```
┌─────────────────────────────────────────┐
│ [File] [Edit] [View] [Deploy]  [Live ●]│ Menu Bar
├────────┬────────────────────────────────┤
│        │ [Toolbar: B I U Link + ...]   │ Format Bar
│  Page  ├────────────────────────────────┤
│  Tree  │                                │
│        │    [Preview/Edit Area]         │
│ - Home │                                │
│ - About│         (Live Preview)         │
│ - Blog │                                │
│        │                                │
│        │                                │
└────────┴────────────────────────────────┘
```

### Inline Editing Indicators
- Dotted outline on hover (blue)
- Solid border when focused (blue, 2px)
- Floating toolbar near selected element
- Component type badge (e.g., "Heading 1")

## Performance Considerations

1. **Debounced Saves**: Wait 1s after last edit before writing to disk
2. **Virtual DOM**: React updates only changed elements
3. **Throttled Preview**: Limit preview refreshes to 60fps
4. **Lazy Loading**: Load page content on-demand
5. **Worker Threads**: Parse/validate HTML in background

## Accessibility Requirements

- [ ] Keyboard-only editing supported (Tab navigation)
- [ ] Screen reader announces edit mode entry/exit
- [ ] Semantic HTML preserved during edits
- [ ] ARIA labels on toolbar buttons
- [ ] High contrast mode support

## Related Stories

- [01 - First Website Creation](01-first-website-creation.md) - How user gets here
- [05 - Image Management](06-image-management.md) - Enhanced image editing
- [06 - SEO Metadata](07-seo-metadata.md) - Page-level metadata
- [07 - Responsive Preview](08-responsive-preview.md) - Multi-device editing

## Technical Risks

1. **ContentEditable Complexity**
   - Risk: Browser inconsistencies with contentEditable
   - Mitigation: Use battle-tested library (ProseMirror, Slate.js)

2. **File System Race Conditions**
   - Risk: Simultaneous reads/writes cause data loss
   - Mitigation: File locking, write queues, atomic operations

3. **Memory Leaks**
   - Risk: Long editing sessions consume too much memory
   - Mitigation: Proper cleanup of event listeners, component unmounting

4. **Build Performance**
   - Risk: 11ty rebuilds too slow for live editing
   - Mitigation: Incremental builds, cache intermediate results

## Open Questions

- Q: Should we support Markdown editing mode?
  - A: Yes, post-MVP. Power users will want it.

- Q: How do we handle component libraries (WebC)?
  - A: Show component palette, drag-drop insertion with preview

- Q: Should changes be saved to Git automatically?
  - A: Not in MVP, but design for it (add Git service)

- Q: Real-time collaboration in future?
  - A: Consider architecture that allows it (CRDT-friendly data model)

## Testing Scenarios

1. **Basic Text Editing**: Type paragraph, format, save
2. **Undo/Redo Chain**: Make 10 edits, undo all, redo all
3. **Large Page**: Edit page with 100+ paragraphs
4. **Rapid Edits**: Type quickly, ensure no data loss
5. **External Changes**: Edit file externally while editor open
6. **Network Latency**: Edit on slow network drive
7. **Browser Compatibility**: Test on Chromium versions (Electron)
8. **Crash Recovery**: Kill app mid-edit, verify auto-save

## Definition of Done

- [ ] Code implemented with full WYSIWYG editing
- [ ] Unit tests for editor components (>90% coverage)
- [ ] Integration tests for save/load cycle
- [ ] Performance: < 100ms edit-to-preview latency
- [ ] Memory: No leaks in 1-hour editing session
- [ ] Accessibility: WCAG 2.1 AA compliance
- [ ] Documentation: User guide with screenshots
- [ ] QA: Tested on macOS, Windows, Linux
- [ ] User testing: 5 non-technical users successfully edit content
