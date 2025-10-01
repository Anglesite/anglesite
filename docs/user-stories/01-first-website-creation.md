# User Story 01: First Website Creation

**Priority:** P0 (Critical - MVP)
**Story Points:** 5
**Estimated Duration:** 3-5 days
**Persona:** Sarah (Personal Brand Builder), Mike (Small Business Owner)
**Epic:** Onboarding & Setup

## Complexity Assessment

**Points Breakdown:**
- File system operations and project scaffolding: 2 points
- UI/UX for welcome flow and project creation: 2 points
- Integration with existing services (WebsiteServerManager, MultiWindowManager): 1 point

**Justification:** Moderate complexity with well-defined requirements. File operations are straightforward, but need robust error handling for edge cases (permissions, disk space). UI needs to be polished for first user impression.

## Story

**As a** new Anglesite user
**I want to** create my first website with minimal setup
**So that** I can start building my web presence immediately without technical barriers

## Acceptance Criteria

### Given: User launches Anglesite for the first time

- [ ] Application displays a welcome screen with "Create New Website" option
- [ ] No login or account creation required to start
- [ ] Welcome flow explains the basic concept in 2-3 screens

### When: User chooses to create a new website

- [ ] Application prompts for website name (e.g., "My Portfolio")
- [ ] Application asks for local directory location (with sensible default)
- [ ] Application offers basic template selection (optional - can start blank)
- [ ] Application creates project structure automatically

### Then: Website project is initialized

- [ ] Local development server starts automatically
- [ ] Browser preview window opens showing the new site
- [ ] User sees visual editor with welcome/placeholder content
- [ ] File structure is created in chosen directory
- [ ] User can immediately start editing

## Technical Details

### Implementation Notes

- Use Electron's dialog API for directory selection
- Initialize 11ty project structure programmatically
- Copy starter template files from anglesite-starter package
- Register website in WebsiteServerManager
- Create initial BrowserWindow for editing

### File Operations

```
/User/Sites/my-portfolio/
├── src/
│   ├── pages/
│   │   └── index.html (generated from template)
│   ├── _includes/
│   │   └── layouts/
│   ├── assets/
│   │   ├── css/
│   │   └── images/
├── .anglesite/
│   └── config.json (metadata, last modified, etc.)
└── package.json (if needed for dependencies)
```

### Dependencies

- ServiceRegistry: WebsiteServerManager
- ServiceRegistry: MultiWindowManager
- IPC Handler: create-website
- Template: anglesite-starter

## User Flow Diagram

```
[Launch App]
    ↓
[Welcome Screen]
    ↓
[Click "Create Website"]
    ↓
[Enter Website Name] → (validation)
    ↓
[Choose Directory] → (file system dialog)
    ↓
[Select Template] → (optional, can skip)
    ↓
[Creating...] → (progress indicator)
    ↓
[Editor Opens] ← (auto-start server)
    ↓
[Ready to Edit!]
```

## Success Metrics

- **Time to First Edit**: < 2 minutes from app launch
- **Completion Rate**: > 90% of users who click "Create" complete setup
- **Error Rate**: < 5% encounter file system or permission errors
- **User Satisfaction**: "How easy was it to create your first site?" > 4/5

## Edge Cases & Error Handling

1. **Directory Permission Issues**
   - Show clear error message
   - Suggest alternative directory (Documents/Anglesite)
   - Allow user to choose different location

2. **Duplicate Website Name**
   - Check for existing directory
   - Offer to append number (e.g., "my-site-2")
   - Allow user to choose different name

3. **Disk Space Insufficient**
   - Check available space before creating files
   - Show error with required vs available space
   - Allow user to choose different location

4. **Server Port Conflicts**
   - Auto-assign available port (3000-3999 range)
   - Handle port conflicts gracefully
   - Store port in project config

## UI Mockup Notes

### Welcome Screen

- Hero: "Create your first website"
- Subheading: "Build and deploy to your own domain for free"
- Primary CTA: "Create New Website" (large button)
- Secondary: "Open Existing Website"

### Creation Dialog

- Field 1: "Website Name" (text input)
- Field 2: "Save Location" (directory picker with default)
- Field 3: "Start with Template" (dropdown: Blank, Blog, Portfolio, Business)
- Action: "Create Website" button

### Progress Indicator

- "Creating your website..."
- Steps shown: "Setting up files... Starting server... Opening editor..."
- Should complete in < 5 seconds

## Related Stories

- [02 - Visual Page Editing](02-visual-page-editing.md) - What happens after creation
- [08 - Template Selection](09-template-selection.md) - Advanced template features
- [04 - Custom Domain Setup](05-custom-domain-setup.md) - Post-creation configuration

## Open Questions

- Q: Should we require website name to be URL-friendly initially?
  - A: No, sanitize automatically but show preview (e.g., "My Site!" → "my-site")

- Q: Should first-time users see a tutorial overlay?
  - A: Consider optional tour, but don't force it (annoying for technical users)

- Q: Should we create a local .test domain automatically?
  - A: Yes, use website name (e.g., "my-portfolio.test") with DNSManager

## Testing Scenarios

1. **Happy Path**: Create site with valid name in valid directory
2. **Special Characters**: Name with spaces, symbols, emojis
3. **Long Names**: 100+ character website names
4. **Network Drive**: Try creating on mounted network volume
5. **Read-Only Location**: Attempt creation in protected directory
6. **Rapid Creation**: Create multiple sites in quick succession
7. **Cancellation**: Cancel mid-creation, ensure cleanup

## Definition of Done

- [ ] Code implemented and reviewed
- [ ] Unit tests written (>90% coverage)
- [ ] Integration test for full creation flow
- [ ] Error handling tested for all edge cases
- [ ] UI/UX reviewed by designer
- [ ] Documentation updated
- [ ] Manual QA completed on macOS, Windows, Linux
- [ ] Performance: Creation completes in < 5 seconds
- [ ] Accessibility: Keyboard navigation works throughout flow
