# User Story 00: First-Run Onboarding Experience

**Priority:** P0 (Critical - MVP)
**Story Points:** 3
**Estimated Duration:** 2-3 days
**Persona:** All personas (first-time users)
**Epic:** Onboarding & Setup

## Complexity Assessment

**Points Breakdown:**
- Welcome screens and onboarding flow UI: 1 point
- First-time setup detection and persistence: 1 point
- Optional tour/tutorial integration: 1 point

**Justification:** Low-moderate complexity. Onboarding screens are straightforward UI work. Detecting first-run and showing appropriate flows is well-understood. Main effort is crafting clear, concise messaging that works for both technical and non-technical users.

## Story

**As a** first-time Anglesite user
**I want to** understand what the app does and how to get started
**So that** I can quickly create my first website without confusion

## Acceptance Criteria

### Given: User launches Anglesite for the first time
- [ ] Application detects it's the first run
- [ ] Welcome screen appears (not main editor)
- [ ] Clear value proposition visible
- [ ] Path to creating first website is obvious

### When: User proceeds through onboarding
- [ ] Brief introduction to Anglesite (1-2 screens max)
- [ ] Explanation of key features in simple language
- [ ] Option to skip directly to creating website
- [ ] No account creation or login required

### Then: User is ready to start
- [ ] Direct path to "Create First Website" (Story 01)
- [ ] Onboarding doesn't repeat on subsequent launches
- [ ] User can access onboarding again from Help menu
- [ ] Preferences saved for future sessions

## Technical Details

### First-Run Detection

```typescript
interface OnboardingState {
  hasCompletedOnboarding: boolean;
  version: string;                    // Onboarding version
  completedAt?: Date;
  skipped: boolean;
  pagesViewed: string[];             // Track which screens were seen
}

// .anglesite/onboarding-state.json
{
  "hasCompletedOnboarding": false,
  "version": "1.0",
  "skipped": false,
  "pagesViewed": []
}
```

### Onboarding Flow

```
[App Launch]
    ↓
[Check Onboarding State]
    ↓
[First Time?] ──No──> [Show Main Window]
    ↓ Yes
[Welcome Screen]
    ↓
[Feature Overview] (optional)
    ↓
[Ready to Start]
    ↓
[Create First Website Flow] (Story 01)
```

### Implementation Components

**Services:**
- `OnboardingService` - Manages onboarding state
- `StoreService` - Persists onboarding completion (existing)

**Renderer Process:**
- `<WelcomeWindow>` - First-run welcome screen
- `<OnboardingSlides>` - Feature walkthrough
- `<OnboardingControls>` - Next/Skip/Back buttons

**IPC Handlers:**
```typescript
'onboarding:get-state'         // Get current onboarding status
'onboarding:complete'          // Mark onboarding as complete
'onboarding:skip'              // User skipped onboarding
'onboarding:restart'           // Reset onboarding (from Help menu)
```

## Onboarding Screens

### Screen 1: Welcome

```
┌─────────────────────────────────────────┐
│                                         │
│              🏗️ Anglesite              │
│                                         │
│     Your website. Your domain.          │
│        Zero hosting costs.              │
│                                         │
│  Build and deploy beautiful websites   │
│  to your own domain for free using     │
│  CloudFlare Workers.                    │
│                                         │
│                                         │
│  [Get Started] [Learn More]             │
│                                         │
│                                         │
└─────────────────────────────────────────┘
```

### Screen 2: Key Features (Optional - Can Skip)

```
┌─────────────────────────────────────────┐
│  What makes Anglesite different?        │
│                                         │
│  ✏️ Visual Editor                       │
│  Edit your site visually with           │
│  live preview                           │
│                                         │
│  🤖 AI Webmaster                        │
│  Get help from an expert AI agent       │
│  to build your site                     │
│                                         │
│  🆓 Free Hosting                        │
│  Deploy to your own domain using        │
│  CloudFlare Workers - $0/month          │
│                                         │
│  🔒 Local-First                         │
│  Your content stays on your computer    │
│  until you're ready to publish          │
│                                         │
│  [Skip Tour] [Next] [Start Creating]    │
└─────────────────────────────────────────┘
```

### Screen 3: Ready to Start

```
┌─────────────────────────────────────────┐
│  Ready to build your first website?     │
│                                         │
│                                         │
│        🎨                               │
│                                         │
│  You're just 3 steps away:              │
│                                         │
│  1️⃣ Give your website a name            │
│  2️⃣ Choose where to save it             │
│  3️⃣ Start editing                       │
│                                         │
│  It takes less than 2 minutes!          │
│                                         │
│                                         │
│  [Create My First Website]              │
│                                         │
│  [I'll do this later]                   │
│                                         │
└─────────────────────────────────────────┘
```

## User Personas Considerations

### Non-Technical Users (Sarah, Mike, Emma)
- **Need**: Simple language, no jargon
- **Show**: Visual benefits, ease of use
- **Avoid**: Technical details, CLI mentions

### Technical Users (Alex)
- **Need**: Quick overview, skip option
- **Show**: Architecture, file structure
- **Avoid**: Patronizing explanations

**Solution**: Keep onboarding minimal (3 screens max) with prominent skip option.

## Success Metrics

- **Completion Rate**: > 70% of users complete onboarding
- **Time to Complete**: < 60 seconds average
- **Skip Rate**: < 30% skip onboarding
- **First Website Created**: > 80% create website within 5 minutes of onboarding

## Edge Cases & Error Handling

### 1. User Closes Window During Onboarding
```
Behavior: Save progress, resume on next launch
State: Mark as "incomplete" not "completed"
```

### 2. Onboarding State File Corrupted
```
Behavior: Treat as first-time user
Action: Show onboarding again
```

### 3. User Wants to See Onboarding Again
```
Solution: Add "Show Welcome Tour" in Help menu
Action: Reset onboarding state temporarily
```

### 4. Different Onboarding for Updates
```
If onboarding.version < currentVersion:
  Show "What's New" screen
  Don't show full onboarding
```

## Onboarding Variations (Post-MVP)

### 1. Persona-Based Onboarding
Ask user what they want to build:
- Personal blog
- Business website
- Portfolio
- Documentation site

Show relevant features for their use case.

### 2. Video Tutorial
- Optional 2-minute overview video
- Narrated walkthrough
- Can be skipped

### 3. Interactive Tutorial
- Guided tour of interface
- Click hotspots to learn features
- Practice creating a page

### 4. Sample Project
- Offer to create sample website
- Pre-populated with example content
- User can explore and modify

## Accessibility

- [ ] Keyboard-only navigation through onboarding
- [ ] Screen reader announcements for each screen
- [ ] High contrast mode support
- [ ] Respects reduced motion preferences
- [ ] Text is readable (min 16px font)

## Localization Considerations

While MVP is English-only, onboarding should be designed for future translation:
- No hard-coded text in components
- Use i18n keys
- Avoid text in images
- Support RTL layouts

## Related Stories

- [01 - First Website Creation](01-first-website-creation.md) - Where onboarding leads
- [13 - Application Settings](13-application-settings.md) - Can reset onboarding

## Performance Considerations

- **Window Load Time**: < 1 second for welcome screen
- **Animations**: Subtle, respectful of motion preferences
- **Images**: Optimized, < 500KB total
- **Memory**: < 100MB for onboarding window

## Implementation Notes

### Window Management

```typescript
// Create dedicated onboarding window
const onboardingWindow = new BrowserWindow({
  width: 800,
  height: 600,
  resizable: false,
  fullscreenable: false,
  title: 'Welcome to Anglesite',
  show: false
});

// Show only after content loaded
onboardingWindow.once('ready-to-show', () => {
  onboardingWindow.show();
});
```

### State Persistence

```typescript
// Check on app startup
async function shouldShowOnboarding(): Promise<boolean> {
  const state = await store.get('onboarding');

  if (!state) return true;  // First time
  if (state.skipped) return false;
  if (state.hasCompletedOnboarding) return false;

  return true;  // Incomplete onboarding
}
```

## Testing Scenarios

1. **First Launch**: Verify onboarding appears
2. **Second Launch**: Verify onboarding doesn't repeat
3. **Skip Button**: Skip onboarding, verify doesn't show again
4. **Complete Flow**: Go through all screens, create website
5. **Close Mid-Onboarding**: Close window, verify resume on relaunch
6. **Corrupt State**: Delete state file, verify onboarding shows
7. **Help Menu**: Access onboarding from Help menu
8. **Keyboard Only**: Navigate using only keyboard
9. **Screen Reader**: Test with VoiceOver/NVDA
10. **Different Window Sizes**: Test on small screens

## Open Questions

- Q: Should we collect anonymous usage data during onboarding?
  - A: No - respect privacy, no tracking without explicit consent

- Q: How often to show "What's New" for updates?
  - A: Only for major versions (1.0 → 2.0), not minor updates

- Q: Support multiple onboarding flows for different user types?
  - A: Post-MVP, keep simple for MVP

## Definition of Done

- [ ] Onboarding UI implemented (3 screens)
- [ ] First-run detection working
- [ ] State persistence implemented
- [ ] Skip functionality working
- [ ] Transitions between screens smooth
- [ ] "Show Welcome Tour" in Help menu
- [ ] Unit tests for OnboardingService (>90% coverage)
- [ ] Performance: < 1s window load
- [ ] Accessibility: Keyboard navigation works
- [ ] Accessibility: Screen reader tested
- [ ] Documentation: Onboarding content guidelines
- [ ] QA: Tested on macOS, Windows, Linux
- [ ] User testing: 10 users complete onboarding successfully
- [ ] Metrics: > 70% completion rate in user testing
