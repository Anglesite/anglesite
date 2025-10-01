# User Story 12: File Explorer with Xcode-Style Design

**Priority:** P1 (High - MVP Enhancement)
**Story Points:** 5
**Estimated Duration:** 3-5 days
**Persona:** All personas (especially Alex - Technical Hobbyist)
**Epic:** Content Creation & Site Management

## Complexity Assessment

**Points Breakdown:**
- Tree view component with expand/collapse: 2 points
- File operations (rename, delete, move): 2 points
- Xcode-inspired UI design and styling: 1 point

**Justification:** Moderate complexity. Tree view requires careful state management for expand/collapse. File operations need proper error handling and undo support. Xcode-style UI is mostly CSS work but requires attention to detail for professional appearance.

## Story

**As a** website creator working on multiple pages
**I want to** navigate my site's file structure with a clean, professional file explorer
**So that** I can quickly find and manage pages, assets, and content like I would in Xcode

## Acceptance Criteria

### Given: User has a website open in Anglesite
- [ ] File explorer visible in left sidebar
- [ ] Shows hierarchical tree of website files
- [ ] Clear visual hierarchy (folders, pages, assets)
- [ ] Current file highlighted

### When: User interacts with file explorer
- [ ] Click file to open/edit
- [ ] Expand/collapse folders
- [ ] Right-click for context menu
- [ ] Drag-and-drop to reorganize
- [ ] Create new files and folders
- [ ] Rename, duplicate, delete files

### Then: File operations work smoothly
- [ ] Changes reflected immediately in file system
- [ ] UI updates without full refresh
- [ ] Undo/redo for file operations
- [ ] Search/filter functionality
- [ ] Keyboard navigation supported

## Technical Details

### File Explorer Structure

```typescript
interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;                      // Absolute path
  relativePath: string;              // Relative to website root
  extension?: string;
  isExpanded?: boolean;              // For folders
  children?: FileNode[];
  icon?: string;
  metadata?: {
    size: number;
    modified: Date;
    isHidden: boolean;
  };
}

interface FileTreeState {
  rootNodes: FileNode[];
  expandedFolders: Set<string>;
  selectedFile: string | null;
  searchQuery: string;
}
```

### Directory Structure to Display

```
my-website/
├── 📄 index.html               (Homepage)
├── 📄 about.html               (About page)
├── 📁 blog/                    (Expandable folder)
│   ├── 📄 index.html
│   ├── 📄 post-1.md
│   └── 📄 post-2.md
├── 📁 assets/                  (Expandable folder)
│   ├── 📁 css/
│   │   └── 📄 main.css
│   ├── 📁 js/
│   │   └── 📄 scripts.js
│   └── 📁 images/
│       ├── 🖼️ logo.png
│       └── 🖼️ hero.jpg
├── 📁 _includes/               (11ty includes)
│   └── 📁 layouts/
│       └── 📄 base.njk
└── ⚙️ website.json             (Configuration)
```

### Xcode-Inspired Design Elements

**Visual Style:**
- **Sidebar background**: Light gray (#F5F5F7) / dark mode (#1E1E1E)
- **Hover state**: Subtle highlight (#E5E5E7)
- **Selection**: Blue highlight (#007AFF) with white text
- **Icons**: SF Symbols-style icons (file types, folders)
- **Typography**: System font, -apple-system/Segoe UI
- **Spacing**: Consistent 4px/8px grid
- **Disclosure triangles**: Smooth rotation animation (90° when expanded)

**Xcode-Style Features:**
1. **Group Folders**: Visual grouping like Xcode project groups
2. **Badges**: Show file status (modified, new, error)
3. **Breadcrumbs**: Show current file path at top
4. **Quick Open**: Cmd+P to quickly find files
5. **Source Control Indicators**: Git status icons (future)

## User Flow Diagram

```
[Open Website]
    ↓
[File Explorer Loads]
    ├─ Root files shown
    ├─ Folders collapsed by default
    └─ Homepage selected
    ↓
[User Clicks Folder] → [Folder Expands]
    ↓
[User Clicks File] → [File Opens in Editor]
    ↓
[User Right-Clicks] → [Context Menu]
    ├─ New File
    ├─ New Folder
    ├─ Rename
    ├─ Duplicate
    ├─ Delete
    ├─ Reveal in Finder/Explorer
    └─ Copy Path
```

## File Explorer UI

### Main View (Xcode Style)

```
┌─────────────────────────────────────────┐
│ 📂 my-website         [+] [⚙️] [🔍]     │ <- Toolbar
├─────────────────────────────────────────┤
│                                         │
│ ▼ 📄 index.html                         │ <- Selected (blue)
│ ▶ 📄 about.html                         │
│ ▼ 📁 blog/                              │ <- Expanded
│   ▶ 📄 index.html                       │
│   ▶ 📄 getting-started.md               │
│   ▶ 📄 second-post.md                   │
│ ▶ 📁 assets/                            │ <- Collapsed
│ ▶ 📁 _includes/                         │
│ ▶ ⚙️ website.json                       │
│                                         │
│                                         │
│                                         │
└─────────────────────────────────────────┘
```

### Context Menu (Right-Click)

```
┌─────────────────────────────────────────┐
│  New File                    ⌘N         │
│  New Folder                  ⇧⌘N        │
│  ──────────────────────────────         │
│  Rename...                   ⏎          │
│  Duplicate                   ⌘D         │
│  Delete                      ⌫          │
│  ──────────────────────────────         │
│  Reveal in Finder            ⌘R         │
│  Copy Path                   ⇧⌘C        │
│  ──────────────────────────────         │
│  Sort by Name                           │
│  Sort by Date Modified                  │
└─────────────────────────────────────────┘
```

### Quick Open (Cmd+P)

```
┌─────────────────────────────────────────┐
│  🔍 [Search files...                ]   │
│                                         │
│  📄 index.html              /           │
│  📄 about.html              /           │
│  📄 getting-started.md      /blog/      │
│  🖼️ hero.jpg                /assets/    │
│  📄 main.css                /assets/css/│
│                                         │
│  ⏎ to open  ↑↓ to navigate  ⎋ cancel  │
└─────────────────────────────────────────┘
```

### File Badge Indicators

```
📄 index.html               (Normal)
📄 about.html     ●         (Modified, not saved)
📄 new-page.html  ✨        (Newly created)
📄 broken.html    ⚠️        (Validation error)
📄 .gitignore     👁️        (Hidden file, shown when "Show Hidden" enabled)
```

## Implementation Components

**Services:**
- `FileExplorerService` - Manages file tree state
- `FileWatcherService` - Watches for external file changes (existing)
- `FileOperationsService` - Create, rename, delete, move operations

**Renderer Process:**
- `<FileExplorer>` - Main tree component
- `<FileTreeNode>` - Individual file/folder row
- `<ContextMenu>` - Right-click menu
- `<QuickOpen>` - Cmd+P file finder
- `<FileIconProvider>` - Maps extensions to icons

**IPC Handlers:**
```typescript
'files:get-tree'            // Get file tree for website
'files:create'              // Create new file/folder
'files:rename'              // Rename file/folder
'files:delete'              // Delete file/folder
'files:move'                // Move file to different location
'files:duplicate'           // Duplicate file
'files:reveal'              // Open in Finder/Explorer
'files:search'              // Search for files by name
```

## File Type Icons

```typescript
const fileIcons = {
  // Web files
  'html': '📄',
  'md': '📝',
  'css': '🎨',
  'js': '📜',
  'json': '⚙️',

  // Images
  'jpg': '🖼️',
  'png': '🖼️',
  'svg': '🖼️',
  'gif': '🖼️',
  'webp': '🖼️',

  // 11ty specific
  'njk': '📄',
  'webc': '🧩',
  'liquid': '💧',

  // Folders
  'folder': '📁',
  'folder-open': '📂',

  // Special
  '_includes': '📚',
  '_data': '💾',
  'assets': '📦'
};
```

## Keyboard Shortcuts

```typescript
const shortcuts = {
  // Navigation
  '↑/↓': 'Navigate files',
  '←/→': 'Collapse/expand folder',
  '⏎': 'Open selected file',
  'Space': 'Preview file (Quick Look)',

  // Actions
  '⌘N': 'New file',
  '⇧⌘N': 'New folder',
  '⌘D': 'Duplicate',
  '⌘⌫': 'Delete',
  '⏎ (on file)': 'Rename',

  // Search
  '⌘P': 'Quick open',
  '⌘F': 'Search in files',
  '⌘⇧F': 'Find and replace',

  // View
  '⌘1': 'Focus file explorer',
  '⌘0': 'Toggle file explorer',
  '⌘⇧.': 'Toggle hidden files'
};
```

## Edge Cases & Error Handling

### 1. File Deleted Externally
```
Detection: FileWatcher detects deletion
UI: Remove from tree, show notification
Action: If file was open, prompt to save or close
```

### 2. Large Directory (1000+ Files)
```
Solution: Virtual scrolling for performance
         Load folders on-demand (lazy loading)
Warning: Show "Large folder" indicator
```

### 3. File Name Conflicts
```
Error: "A file named 'about.html' already exists"
Options: [Replace] [Keep Both] [Cancel]
```

### 4. Permission Denied
```
Error: "Cannot delete 'index.html' - permission denied"
Action: Suggest running Anglesite with appropriate permissions
```

### 5. Invalid File Names
```
Validation: Prevent: <, >, :, ", /, \, |, ?, *
Warning: "File name contains invalid characters"
```

### 6. Circular Symlinks
```
Detection: Check for symlink loops
Warning: "Folder contains circular reference - not displayed"
```

## Advanced Features (Post-MVP)

### 1. Git Integration
- Show git status indicators
- Color-coded: green (new), blue (modified), red (deleted)
- Git operations from context menu

### 2. File Templates
- "New from Template" option
- Pre-configured page types
- Custom user templates

### 3. Multi-Select
- Cmd+Click for multiple selection
- Batch operations (delete, move multiple files)

### 4. File Preview
- Quick Look (Spacebar) for images
- HTML preview without opening
- Markdown rendering preview

### 5. Smart Folders
- Saved searches
- Dynamic filters (e.g., "All Images", "Modified Today")

### 6. Favorites/Bookmarks
- Star frequently used files
- Quick access section at top

## Success Metrics

- **File Open Time**: < 100ms from click to editor
- **Tree Render Time**: < 200ms for 100 files
- **Usage**: 80% of users use file explorer daily
- **Quick Open Adoption**: 40% of file opens via Cmd+P
- **Error Rate**: < 1% of file operations fail

## Performance Considerations

1. **Virtual Scrolling**: Render only visible nodes
2. **Lazy Loading**: Load folder contents on expand
3. **Debounced File Watching**: Batch multiple changes
4. **Memoization**: Cache rendered tree nodes
5. **Efficient Re-renders**: Update only changed nodes

```typescript
// Example: Virtual scrolling
import { FixedSizeTree } from 'react-window';

<FixedSizeTree
  height={600}
  itemCount={flattenedNodes.length}
  itemSize={24}
  width="100%"
>
  {({ index, style }) => (
    <FileTreeNode
      node={flattenedNodes[index]}
      style={style}
    />
  )}
</FixedSizeTree>
```

## Accessibility

- [ ] Full keyboard navigation
- [ ] Screen reader announces file operations
- [ ] ARIA labels for all interactive elements
- [ ] Focus indicators visible
- [ ] High contrast mode support
- [ ] Respect reduced motion (no expand animations)

## Related Stories

- [01 - First Website Creation](01-first-website-creation.md) - File structure setup
- [02 - Visual Page Editing](02-visual-page-editing.md) - Open files from explorer
- [10 - Blog Creation](10-blog-creation.md) - Blog folder management

## Technical Risks

1. **Performance with Large Sites**
   - Risk: Slow rendering with 1000+ files
   - Mitigation: Virtual scrolling, lazy loading

2. **File System Race Conditions**
   - Risk: External changes conflict with user operations
   - Mitigation: File locking, conflict resolution UI

3. **Cross-Platform Path Issues**
   - Risk: Windows vs. Unix path separators
   - Mitigation: Use Node.js path module exclusively

## Testing Scenarios

1. **Basic Navigation**: Open, expand folders, select files
2. **Create Files**: Create 10 files with various names
3. **Rename**: Rename files with edge cases (long names, special chars)
4. **Delete**: Delete files and folders
5. **Drag-and-Drop**: Move files between folders
6. **Large Directory**: Test with 1000+ files
7. **External Changes**: Modify files outside Anglesite while open
8. **Quick Open**: Search for files with various queries
9. **Keyboard Only**: Complete all operations without mouse
10. **Concurrent Operations**: Multiple rapid file operations

## Open Questions

- Q: Should we support drag-and-drop from OS to file explorer?
  - A: Yes, allows easy import of images/files

- Q: Show hidden files by default?
  - A: No, but add toggle option (Cmd+Shift+.)

- Q: Support for custom file ordering?
  - A: Post-MVP, allow manual reordering

## Definition of Done

- [ ] File tree component implemented
- [ ] Expand/collapse working smoothly
- [ ] File operations (create, rename, delete, move)
- [ ] Context menu functional
- [ ] Quick Open (Cmd+P) working
- [ ] Keyboard shortcuts implemented
- [ ] File type icons displayed
- [ ] Xcode-style visual design applied
- [ ] Virtual scrolling for large directories
- [ ] Unit tests for FileExplorerService (>90% coverage)
- [ ] Integration tests for file operations
- [ ] Performance: < 200ms render for 100 files
- [ ] Memory: < 50MB for file tree state
- [ ] Accessibility: Full keyboard navigation
- [ ] Accessibility: Screen reader tested
- [ ] Documentation: File explorer user guide
- [ ] QA: Tested on macOS, Windows, Linux
- [ ] User testing: 5 users successfully navigate and manage files
- [ ] Design review: Xcode-inspired styling approved
