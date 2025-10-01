# User Story 13: Application Settings & Preferences

**Priority:** P1 (High - MVP)
**Story Points:** 3
**Estimated Duration:** 2-3 days
**Persona:** All personas
**Epic:** Application Management

## Complexity Assessment

**Points Breakdown:**
- Settings UI with multiple categories: 1 point
- Persistent settings storage and retrieval: 1 point
- Settings validation and application: 1 point

**Justification:** Low-moderate complexity. Settings UI is straightforward form work. Storage uses existing electron-store infrastructure. Most complexity in ensuring settings apply correctly across the application. Testing all combinations is time-consuming.

## Story

**As a** Anglesite user
**I want to** configure application preferences and settings
**So that** I can customize the app to match my workflow and preferences

## Acceptance Criteria

### Given: User wants to change app settings
- [ ] Settings accessible from menu (Preferences/Settings)
- [ ] Settings window opens quickly
- [ ] All settings organized by category
- [ ] Current values displayed correctly

### When: User modifies settings
- [ ] Changes preview in real-time (where possible)
- [ ] Input validation prevents invalid values
- [ ] Save/Cancel buttons function correctly
- [ ] Reset to defaults option available

### Then: Settings are persisted
- [ ] Settings saved immediately or on "Save"
- [ ] Settings persist across app restarts
- [ ] Settings apply to all windows
- [ ] Export/import settings available

## Technical Details

### Settings Structure

```typescript
interface AppSettings {
  // General
  general: {
    autoCheckUpdates: boolean;
    sendAnonymousUsage: boolean;
    language: string;                 // 'en', 'es', 'fr', etc.
    theme: 'light' | 'dark' | 'system';
  };

  // Editor
  editor: {
    fontSize: number;                 // 12-24px
    fontFamily: string;               // 'system', 'monospace', etc.
    tabSize: number;                  // 2 or 4
    autoSave: boolean;
    autoSaveDelay: number;            // milliseconds
    showLineNumbers: boolean;
    wordWrap: boolean;
    spellCheck: boolean;
  };

  // Preview
  preview: {
    autoRefresh: boolean;
    refreshDelay: number;             // milliseconds
    openDevTools: boolean;
    defaultDevice: string;            // 'desktop', 'mobile', etc.
    showGridOverlay: boolean;
  };

  // Build & Deployment
  deployment: {
    autoMinify: boolean;
    optimizeImages: boolean;
    generateSourceMaps: boolean;
    buildOnSave: boolean;
  };

  // Advanced
  advanced: {
    enableExperimentalFeatures: boolean;
    developerMode: boolean;
    maxMemoryLimit: number;           // MB
    logLevel: 'error' | 'warn' | 'info' | 'debug';
    customCSSPath?: string;           // User stylesheet
  };

  // Privacy
  privacy: {
    sendCrashReports: boolean;
    allowAnalytics: boolean;
    clearCacheOnExit: boolean;
  };
}
```

### Default Settings

```typescript
const defaultSettings: AppSettings = {
  general: {
    autoCheckUpdates: true,
    sendAnonymousUsage: false,
    language: 'en',
    theme: 'system'
  },
  editor: {
    fontSize: 14,
    fontFamily: 'system',
    tabSize: 2,
    autoSave: true,
    autoSaveDelay: 1000,
    showLineNumbers: true,
    wordWrap: true,
    spellCheck: true
  },
  preview: {
    autoRefresh: true,
    refreshDelay: 300,
    openDevTools: false,
    defaultDevice: 'desktop',
    showGridOverlay: false
  },
  deployment: {
    autoMinify: true,
    optimizeImages: true,
    generateSourceMaps: false,
    buildOnSave: false
  },
  advanced: {
    enableExperimentalFeatures: false,
    developerMode: false,
    maxMemoryLimit: 4096,
    logLevel: 'warn',
    customCSSPath: undefined
  },
  privacy: {
    sendCrashReports: true,
    allowAnalytics: false,
    clearCacheOnExit: false
  }
};
```

## Settings UI

### Settings Window (Tabs)

```
┌─────────────────────────────────────────────────────────┐
│  Anglesite Settings                            [✕]      │
├────────────┬────────────────────────────────────────────┤
│            │                                            │
│ General    │  General Settings                          │
│ Editor     │                                            │
│ Preview    │  Appearance                                │
│ Deployment │  Theme: ○ Light ● Dark ○ System           │
│ Advanced   │                                            │
│ Privacy    │  Language                                  │
│            │  [English              ▼]                  │
│            │                                            │
│            │  Updates                                   │
│            │  ☑ Automatically check for updates        │
│            │                                            │
│            │                                            │
│            │                                            │
│            │                                            │
│            │  [Reset to Defaults]      [Cancel] [Save]  │
└────────────┴────────────────────────────────────────────┘
```

### Editor Settings Tab

```
┌─────────────────────────────────────────────────────────┐
│  Editor Settings                                        │
│                                                         │
│  Font                                                   │
│  Size: [14      ] (12-24px)                            │
│  Family: [System Font         ▼]                       │
│                                                         │
│  Formatting                                             │
│  Tab Size: ○ 2 spaces ● 4 spaces                       │
│  ☑ Show line numbers                                    │
│  ☑ Word wrap                                            │
│  ☑ Spell check                                          │
│                                                         │
│  Auto-Save                                              │
│  ☑ Enable auto-save                                     │
│  Delay: [1000   ] milliseconds                          │
│                                                         │
│  Preview: The quick brown fox jumps...                  │
│            ^-- (Live preview of font settings)          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Advanced Settings Tab

```
┌─────────────────────────────────────────────────────────┐
│  Advanced Settings                                      │
│                                                         │
│  ⚠️ Caution: These settings are for advanced users     │
│                                                         │
│  Developer Options                                      │
│  ☐ Enable experimental features                        │
│  ☐ Developer mode (shows DevTools)                     │
│                                                         │
│  Performance                                            │
│  Max Memory: [4096  ] MB                                │
│  ℹ️ Restart required for changes to take effect        │
│                                                         │
│  Logging                                                │
│  Log Level: [Warning            ▼]                     │
│            Options: Error, Warning, Info, Debug         │
│                                                         │
│  Custom Styling                                         │
│  CSS File: [No file selected              ] [Choose]   │
│  ℹ️ Apply custom CSS to Anglesite UI                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Implementation Components

**Services:**
- `SettingsService` - Manages all application settings
- `StoreService` - Persists settings (existing electron-store)
- `ThemeService` - Applies theme changes

**Renderer Process:**
- `<SettingsWindow>` - Main settings window
- `<SettingsTab>` - Individual settings category
- `<SettingControl>` - Reusable input components

**IPC Handlers:**
```typescript
'settings:get-all'              // Get all settings
'settings:get'                  // Get specific setting
'settings:update'               // Update setting(s)
'settings:reset'                // Reset to defaults
'settings:export'               // Export settings to file
'settings:import'               // Import settings from file
'settings:validate'             // Validate setting values
```

## User Flow Diagram

```
[User Opens Settings]
    ↓
[Settings Window Opens]
    ↓
[Select Category Tab]
    ↓
[Modify Setting] → [Live Preview (if applicable)]
    ↓
[Click Save] → [Validate] → [Apply] → [Persist]
    ↓
[Settings Active]
```

## Keyboard Shortcuts

```typescript
const shortcuts = {
  'Cmd/Ctrl+,': 'Open Settings',
  'Cmd/Ctrl+W': 'Close Settings',
  '⏎': 'Save and close',
  '⎋': 'Cancel without saving',
  'Tab': 'Navigate between fields',
  'Cmd/Ctrl+R': 'Reset current tab to defaults'
};
```

## Settings Persistence

```typescript
// Settings stored in electron-store
// Location:
//   macOS: ~/Library/Application Support/Anglesite/settings.json
//   Windows: %APPDATA%/Anglesite/settings.json
//   Linux: ~/.config/Anglesite/settings.json

// Structure:
{
  "version": "1.0",
  "settings": {
    "general": { ... },
    "editor": { ... },
    "preview": { ... },
    "deployment": { ... },
    "advanced": { ... },
    "privacy": { ... }
  }
}
```

## Edge Cases & Error Handling

### 1. Invalid Setting Values
```
Validation: Check min/max, allowed values before saving
Error: "Font size must be between 12 and 24 pixels"
Action: Highlight invalid field, prevent save
```

### 2. Settings File Corrupted
```
Detection: JSON parse error on load
Recovery: Use default settings, backup corrupted file
Notification: "Settings reset to defaults (backup saved)"
```

### 3. Conflicting Settings
```
Example: Auto-save enabled but auto-save delay = 0
Validation: Prevent conflicting combinations
Warning: "Auto-save delay must be > 0 when enabled"
```

### 4. Settings Require Restart
```
Indicator: Show "⚠️ Restart required" next to setting
Action: Prompt user to restart after saving
Option: [Restart Now] [Restart Later]
```

### 5. Import Incompatible Settings
```
Detection: Settings from newer version
Warning: "Some settings are not compatible"
Action: Import compatible settings, skip incompatible
```

## Advanced Features (Post-MVP)

### 1. Settings Profiles
- Create multiple setting profiles
- Quick switch between profiles (e.g., "Work", "Personal")
- Export/import profiles

### 2. Settings Sync
- Sync settings across devices
- Cloud backup (optional, privacy-respecting)
- Conflict resolution

### 3. Workspace Settings
- Per-website settings overrides
- Project-specific editor preferences
- Inherits from global settings

### 4. Settings Search
- Search bar to find settings quickly
- Fuzzy search across all categories
- Keyboard-driven (like VSCode Cmd+Shift+P)

### 5. Settings Recommendations
- Suggest optimal settings based on usage
- "Performance mode" preset
- "Accessibility mode" preset

## Success Metrics

- **Settings Access**: 30% of users access settings in first week
- **Customization Rate**: 50% of users modify at least one setting
- **Common Changes**: Track most frequently changed settings
- **Errors**: < 1% of setting changes result in errors

## Accessibility

- [ ] Full keyboard navigation
- [ ] Screen reader announces all controls
- [ ] ARIA labels for complex controls
- [ ] Focus indicators clear
- [ ] High contrast mode support
- [ ] Setting descriptions read by screen reader

## Related Stories

- [00 - Onboarding](00-first-run-onboarding.md) - Can reset onboarding from settings
- [02 - Visual Page Editing](02-visual-page-editing.md) - Editor settings apply here
- [08 - Responsive Preview](08-responsive-preview.md) - Preview settings

## Performance Considerations

1. **Settings Load Time**: < 100ms to load all settings
2. **Apply Settings**: < 50ms to apply changes
3. **Memory**: < 10MB for settings state
4. **Debounce Saves**: Prevent excessive disk writes

```typescript
// Debounce settings saves
const debouncedSave = debounce((settings: AppSettings) => {
  store.set('settings', settings);
}, 500);
```

## Security & Privacy

- **No Sensitive Data**: Settings don't contain passwords/API keys
- **Encrypted Storage**: Use electron-store encryption for sensitive values
- **Export Warning**: Warn before exporting settings that may contain paths
- **Analytics Opt-In**: Default to opt-out for analytics

## Testing Scenarios

1. **Load Defaults**: First launch, verify all defaults
2. **Modify Settings**: Change each setting, verify saved
3. **Reset**: Reset each tab to defaults
4. **Invalid Values**: Enter invalid values, verify validation
5. **Export/Import**: Export settings, import to new instance
6. **Corrupted File**: Manually corrupt settings.json, verify recovery
7. **Multiple Windows**: Change settings, verify all windows update
8. **Keyboard Only**: Complete all operations without mouse
9. **Restart Required**: Modify setting requiring restart, verify prompt
10. **Theme Changes**: Switch themes, verify immediate application

## Open Questions

- Q: Should settings sync across devices?
  - A: Post-MVP, privacy-respecting cloud sync

- Q: Allow plugins to register custom settings?
  - A: Post-MVP, extensibility API

- Q: Settings versioning/migration strategy?
  - A: Include version number, migrate old formats

## Definition of Done

- [ ] Settings UI implemented with all tabs
- [ ] All MVP settings functional
- [ ] Settings persistence working
- [ ] Input validation for all fields
- [ ] Reset to defaults working
- [ ] Export/import functionality
- [ ] Keyboard shortcuts working
- [ ] Settings apply immediately where possible
- [ ] Restart prompt for settings requiring restart
- [ ] Unit tests for SettingsService (>90% coverage)
- [ ] Integration tests for settings persistence
- [ ] Performance: < 100ms to load settings
- [ ] Accessibility: Full keyboard navigation
- [ ] Accessibility: Screen reader tested
- [ ] Documentation: Settings guide
- [ ] QA: Tested on macOS, Windows, Linux
- [ ] User testing: 5 users successfully modify settings
- [ ] Security review: No sensitive data leakage
