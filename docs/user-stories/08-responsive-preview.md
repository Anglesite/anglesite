# User Story 08: Responsive Device Preview

**Priority:** P1 (High - MVP)
**Story Points:** 3
**Estimated Duration:** 2-3 days
**Persona:** Sarah (Personal Brand Builder), Mike (Small Business Owner)
**Epic:** Content Creation & Testing

## Complexity Assessment

**Points Breakdown:**
- Electron device emulation setup: 1 point
- Device preset configuration and UI: 1 point
- Viewport resizing and orientation toggle: 1 point

**Justification:** Low-moderate complexity using Electron's built-in device emulation. Most heavy lifting done by Chromium. UI is simple device selector. Testing on actual devices for accuracy is main time investment.

## Story

**As a** website creator
**I want to** preview my site on different device sizes while editing
**So that** I can ensure it looks good on mobile, tablet, and desktop

## Acceptance Criteria

### Given: User is editing a page
- [ ] Device preview toolbar visible
- [ ] Current viewport size displayed
- [ ] Quick toggle between common devices

### When: User changes device preview
- [ ] Preview instantly resizes to selected device
- [ ] Content reflows responsively
- [ ] Touch interactions simulated for mobile
- [ ] Orientation toggle (portrait/landscape)

### Then: Preview accurately represents device
- [ ] Correct viewport dimensions
- [ ] Proper pixel density (retina)
- [ ] Device frame (optional chrome)
- [ ] Touch/mouse input appropriate to device

## Technical Details

### Device Presets

```typescript
const devices = {
  desktop: {
    name: 'Desktop',
    width: 1920,
    height: 1080,
    pixelRatio: 1
  },
  laptop: {
    name: 'Laptop',
    width: 1366,
    height: 768,
    pixelRatio: 1
  },
  tablet: {
    name: 'iPad',
    width: 768,
    height: 1024,
    pixelRatio: 2,
    orientation: 'portrait' | 'landscape'
  },
  mobile: {
    name: 'iPhone 12',
    width: 390,
    height: 844,
    pixelRatio: 3,
    orientation: 'portrait' | 'landscape'
  }
};
```

### Implementation Architecture

**Electron Device Emulation:**
```typescript
// Use Electron's built-in device emulation
webContents.enableDeviceEmulation({
  screenPosition: 'mobile',
  screenSize: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  viewPosition: { x: 0, y: 0 },
  viewSize: { width: 390, height: 844 },
  scale: 1
});
```

**Components:**
- `DevicePreviewService` - Manages device emulation state
- `DevicePresetsService` - Stores and manages device configurations
- `<DeviceToolbar>` - UI for device selection
- `<DeviceFrame>` - Optional device chrome (bezels, notches)

**IPC Handlers:**
```typescript
'preview:set-device'        // Switch to device preset
'preview:set-custom'        // Set custom dimensions
'preview:toggle-orientation' // Rotate device
'preview:get-devices'       // Get available presets
'preview:save-preset'       // Save custom device
```

### Device Preset Library

**Mobile Devices:**
```typescript
const mobileDevices = [
  {
    id: 'iphone-15-pro',
    name: 'iPhone 15 Pro',
    width: 393,
    height: 852,
    pixelRatio: 3,
    userAgent: 'iPhone15,2'
  },
  {
    id: 'iphone-se',
    name: 'iPhone SE',
    width: 375,
    height: 667,
    pixelRatio: 2,
    userAgent: 'iPhone SE'
  },
  {
    id: 'pixel-7',
    name: 'Google Pixel 7',
    width: 412,
    height: 915,
    pixelRatio: 2.625,
    userAgent: 'Pixel 7'
  },
  {
    id: 'galaxy-s23',
    name: 'Samsung Galaxy S23',
    width: 360,
    height: 780,
    pixelRatio: 3,
    userAgent: 'SM-S911'
  }
];
```

**Tablet Devices:**
```typescript
const tabletDevices = [
  {
    id: 'ipad-pro-12',
    name: 'iPad Pro 12.9"',
    width: 1024,
    height: 1366,
    pixelRatio: 2,
    userAgent: 'iPad Pro'
  },
  {
    id: 'ipad-air',
    name: 'iPad Air',
    width: 820,
    height: 1180,
    pixelRatio: 2,
    userAgent: 'iPad Air'
  },
  {
    id: 'surface-pro',
    name: 'Surface Pro 9',
    width: 912,
    height: 1368,
    pixelRatio: 2,
    userAgent: 'Surface Pro'
  }
];
```

**Desktop Sizes:**
```typescript
const desktopSizes = [
  { id: 'desktop-1080p', name: 'Desktop HD', width: 1920, height: 1080, pixelRatio: 1 },
  { id: 'desktop-1440p', name: 'Desktop QHD', width: 2560, height: 1440, pixelRatio: 1 },
  { id: 'laptop-1080p', name: 'Laptop 1080p', width: 1366, height: 768, pixelRatio: 1 },
  { id: 'macbook-14', name: 'MacBook Pro 14"', width: 1512, height: 982, pixelRatio: 2 },
  { id: 'macbook-16', name: 'MacBook Pro 16"', width: 1728, height: 1117, pixelRatio: 2 }
];
```

## User Flow Diagram

```
[Editing Page]
    ↓
[Click Device Selector]
    ↓
[Choose Category]
    ├─ Mobile → [iPhone, Android, etc.]
    ├─ Tablet → [iPad, Surface, etc.]
    ├─ Desktop → [HD, QHD, Laptop]
    └─ Custom → [Enter Dimensions]
    ↓
[Preview Resizes] (< 200ms)
    ↓
[Toggle Orientation?] → [Portrait ⇄ Landscape]
    ↓
[Continue Editing] OR [Test Different Device]
```

## UI Mockup

### Device Toolbar (Compact)
```
┌─────────────────────────────────────────────────────────────┐
│ 🖥️ [Desktop ▼] │ 📱 iPhone 15 Pro │ 393×852 │ [⟲] │ [⚙️] │
└─────────────────────────────────────────────────────────────┘
```

### Device Selector Dropdown
```
┌─────────────────────────────────────────┐
│  Select Device                          │
│                                         │
│  📱 Mobile                              │
│    • iPhone 15 Pro (393×852)           │
│    • iPhone SE (375×667)               │
│    • Google Pixel 7 (412×915)          │
│    • Samsung Galaxy S23 (360×780)      │
│                                         │
│  📱 Tablet                              │
│    • iPad Pro 12.9" (1024×1366)        │
│    • iPad Air (820×1180)               │
│    • Surface Pro (912×1368)            │
│                                         │
│  🖥️ Desktop                             │
│    • Desktop HD (1920×1080)            │
│    • Laptop 1080p (1366×768)           │
│    • MacBook Pro 14" (1512×982)        │
│                                         │
│  ⚙️ Custom                              │
│    Width:  [____] Height: [____]       │
│    [Add as Preset]                     │
│                                         │
└─────────────────────────────────────────┘
```

### Preview with Device Frame

```
┌─────────────────────────────────────────┐
│ [Desktop] [Laptop] [Tablet] [Mobile] [⟲]│
│                                         │
│  ┌─────────┐                            │
│  │  📱390  │  < Device Frame            │
│  │    ×    │                            │
│  │   844   │                            │
│  │         │                            │
│  │ [Site]  │                            │
│  │         │                            │
│  └─────────┘                            │
│                                         │
└─────────────────────────────────────────┘
```

### Zoom and Scaling

**Zoom Levels:**
```typescript
const zoomLevels = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

// Allow user to zoom in/out to see full desktop layouts
// or focus on specific areas of mobile views
```

**Fit to Window:**
- Auto-scale preview to fit editor window
- Maintain aspect ratio
- Show actual dimensions overlay

## Edge Cases & Error Handling

### 1. Viewport Larger Than Window
```
Warning: "Device preview (1920×1080) exceeds window size"
Solution: Auto-zoom to fit, show zoom controls
```

### 2. Custom Dimension Limits
```
Error: "Width must be between 320 and 3840 pixels"
Validation: Prevent unrealistic viewport sizes
```

### 3. Orientation Toggle on Desktop
```
Behavior: Disable orientation toggle for desktop presets
Reason: Desktops don't have portrait mode
```

### 4. Rapid Device Switching
```
Handling: Debounce device switches (200ms)
Reason: Prevent UI flicker and performance issues
```

### 5. Memory Usage with Multiple Windows
```
Monitoring: Track memory per preview window
Action: Warn if memory exceeds 500MB per window
```

## Performance Considerations

1. **Device Switch Speed**
   - Target: < 200ms from click to render
   - Method: Pre-calculate dimensions, instant CSS changes
   - No page reload required

2. **Memory Optimization**
   - Reuse same webContents, just resize viewport
   - Clear cache when switching between many devices
   - Limit concurrent device previews to 3

3. **Rendering Accuracy**
   - Match actual device pixel ratios
   - Simulate touch events for mobile
   - Apply correct user agent strings

## Keyboard Shortcuts

```typescript
const shortcuts = {
  'Cmd/Ctrl+1': 'Switch to Mobile',
  'Cmd/Ctrl+2': 'Switch to Tablet',
  'Cmd/Ctrl+3': 'Switch to Desktop',
  'Cmd/Ctrl+R': 'Rotate device',
  'Cmd/Ctrl+=': 'Zoom in',
  'Cmd/Ctrl+-': 'Zoom out',
  'Cmd/Ctrl+0': 'Reset zoom (100%)'
};
```

## Advanced Features (Post-MVP)

### 1. Side-by-Side Preview
- Show mobile + desktop simultaneously
- Compare responsive breakpoints
- Synchronized scrolling

### 2. Screenshot Capture
- Capture preview at specific device size
- Save as PNG with device frame
- Batch capture all devices

### 3. Network Throttling
- Simulate 3G, 4G, slow connections
- Test loading performance on mobile
- Show load time estimates

### 4. Dark Mode Testing
- Toggle between light/dark themes
- Test site appearance in both modes
- Respect system preferences

### 5. Safe Area Visualization
- Show notch/cutout areas (iPhone)
- Display safe content boundaries
- Highlight areas that may be obscured

### 6. Accessibility Testing
- Simulate color blindness
- Test with reduced motion
- Verify touch target sizes (min 44×44px)

## Success Metrics
- **Switch Time**: < 200ms to change device
- **Accuracy**: 100% match to real device rendering
- **Usage**: 60% of users test multiple devices
- **Device Coverage**: Users test average of 2.5 devices per session
- **Issue Detection**: 40% of responsive issues caught before deployment

## Implementation Notes

### Storage Configuration

```typescript
// .anglesite/preview-config.json
{
  "defaultDevice": "desktop-1080p",
  "recentDevices": [
    "iphone-15-pro",
    "ipad-air",
    "desktop-1080p"
  ],
  "customDevices": [
    {
      "id": "custom-1",
      "name": "My Custom Phone",
      "width": 400,
      "height": 800,
      "pixelRatio": 2
    }
  ],
  "preferences": {
    "showDeviceFrame": true,
    "showDimensions": true,
    "defaultZoom": 1.0
  }
}
```

### Responsive Breakpoint Detection

```typescript
// Detect and highlight breakpoints in CSS
interface Breakpoint {
  width: number;
  media: string;  // e.g., "(max-width: 768px)"
  file: string;   // CSS file containing breakpoint
}

// Show visual indicators when crossing breakpoints
```

## Related Stories
- [02 - Visual Page Editing](02-visual-page-editing.md) - Integrated preview
- [06 - Image Management](06-image-management.md) - Responsive images testing
- [01 - First Website Creation](01-first-website-creation.md) - Preview during setup

## Technical Risks

1. **Chromium Limitations**
   - Risk: Device emulation may not perfectly match real devices
   - Mitigation: Document known differences, recommend real device testing

2. **Performance with Large Sites**
   - Risk: Resizing complex pages may be slow
   - Mitigation: Optimize render pipeline, use hardware acceleration

3. **Touch Event Simulation**
   - Risk: Touch gestures may not work identically to real devices
   - Mitigation: Use Chromium's DevTools touch emulation

## Open Questions

- Q: Should we support custom device frame images?
  - A: Post-MVP, allow custom PNG frames for branded devices

- Q: How to handle very wide desktop previews?
  - A: Auto-zoom to fit, provide pan controls

- Q: Support for foldable devices (Samsung Z Fold)?
  - A: Post-MVP, add special foldable presets

## Testing Scenarios

1. **Device Switching**: Switch between 10 devices rapidly
2. **Orientation Toggle**: Rotate mobile and tablet devices
3. **Custom Dimensions**: Create device with unusual aspect ratio
4. **Memory Stress**: Open 3 preview windows, switch devices frequently
5. **Responsive Breakpoints**: Test site at each CSS breakpoint
6. **Touch Simulation**: Verify touch events work on mobile preview
7. **Pixel Ratio**: Confirm retina displays render correctly
8. **Zoom Levels**: Test all zoom levels (0.25x to 2.0x)
9. **Keyboard Shortcuts**: Verify all shortcuts work
10. **Window Resize**: Resize editor window while preview active

## Definition of Done
- [ ] 15+ device presets implemented (mobile, tablet, desktop)
- [ ] Device emulation working correctly with pixel ratios
- [ ] Orientation toggle functional for mobile/tablet
- [ ] Custom device dimensions supported
- [ ] Zoom controls working (0.25x - 2.0x)
- [ ] Keyboard shortcuts implemented
- [ ] Performance: < 200ms device switch
- [ ] Memory: < 500MB per preview window
- [ ] Unit tests for DevicePreviewService (>90% coverage)
- [ ] Integration tests for device switching
- [ ] Tested on actual devices for accuracy comparison
- [ ] Documentation: Device preset guide
- [ ] QA: Tested on macOS, Windows, Linux
- [ ] User testing: 5 users successfully preview multiple devices
- [ ] Accessibility: Keyboard-only device switching works
