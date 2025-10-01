# User Story 03: AI Webmaster Agent Editing

**Priority:** P0 (Critical - MVP)
**Story Points:** 13
**Estimated Duration:** 8-10 days
**Persona:** Sarah (Personal Brand Builder), Mike (Small Business Owner), Emma (Privacy-Conscious Creator)
**Epic:** Content Creation & AI-Assisted Editing

## Complexity Assessment

**Points Breakdown:**

- Claude API integration and context building: 3 points
- Change preview and diff visualization: 3 points
- AI response parsing and validation: 2 points
- Chat UI and conversation management: 2 points
- Prompt engineering and system design: 2 points
- Security validation and sandboxing: 1 point

**Justification:** High complexity due to AI integration unknowns and sophisticated context management. Requires careful prompt engineering to ensure reliable AI responses. Change validation and preview system is complex. Security critical—must prevent AI from making unsafe changes.

## Story

**As a** website owner who wants professional results without technical skills
**I want to** use an AI agent to create and edit my website content with natural language
**So that** I can build a high-quality website by describing what I want instead of manually editing HTML/CSS

## Acceptance Criteria

### Given: User has a website open in Anglesite

- [ ] "AI Webmaster" panel accessible from editor
- [ ] Chat interface for natural language instructions
- [ ] AI can read current page content and site structure
- [ ] AI has context about website.json configuration

### When: User gives AI instructions

- [ ] Accept natural language commands (e.g., "Add a contact form to this page")
- [ ] AI proposes changes with preview
- [ ] User can approve, reject, or refine proposed changes
- [ ] AI can make multi-step edits across multiple files
- [ ] AI understands website structure and conventions

### Then: Changes are applied intelligently

- [ ] HTML/CSS/content updated correctly
- [ ] Changes follow best practices (accessibility, SEO)
- [ ] Site structure maintained (no broken links)
- [ ] User can undo AI changes
- [ ] AI explains what it changed and why

## Technical Details

### AI Agent Architecture

```
User Prompt → AI Agent → Analyze Context → Plan Changes → Execute → Review
                ↑            ↓              ↓              ↓         ↓
                └───── Feedback Loop ───────────────────────────────┘
```

### Agent Capabilities

**1. Content Creation**

- Write page copy from description
- Generate blog posts
- Create product descriptions
- Write compelling headlines

**2. Editing & Refinement**

- Improve existing copy (clarity, tone, SEO)
- Fix grammar and spelling
- Adjust reading level
- Translate to different languages

**3. Structural Changes**

- Add new sections to pages
- Reorganize page layout
- Create new pages
- Update navigation

**4. Design Adjustments**

- Modify colors and fonts
- Adjust spacing and layout
- Add or modify components
- Create responsive designs

**5. SEO Optimization**

- Generate meta descriptions
- Suggest title improvements
- Add alt text to images
- Create internal links

**6. Technical Operations**

- Add forms (contact, newsletter)
- Set up blog structure
- Configure redirects
- Optimize images

### Implementation Components

**Main Process:**

- `AIWebmasterService` - Orchestrates AI agent
- `AnthropicAPIService` - Claude API integration
- `ContextBuilderService` - Builds context for AI
- `ChangeValidatorService` - Validates proposed changes
- `HistoryService` - Tracks AI changes for undo

**Renderer Process:**
- `<AIWebmasterPanel>` - Chat interface
- `<ChangePreview>` - Shows proposed changes
- `<AIHistoryViewer>` - View past AI actions

**IPC Handlers:**
```typescript
'ai:chat'                 // Send message to AI agent
'ai:get-context'          // Get current page/site context
'ai:preview-changes'      // Preview proposed changes
'ai:apply-changes'        // Execute AI proposed changes
'ai:undo-last'            // Undo last AI action
'ai:explain'              // Ask AI to explain its changes
'ai:refine'               // Refine AI's proposal
```

### Context Building

The AI agent needs comprehensive context to make intelligent decisions:

```typescript
interface AIContext {
  // Site-wide context
  website: {
    name: string;
    description: string;
    seo: WebsiteSEO;
    pages: PageSummary[];
    theme: ThemeConfig;
  };

  // Current page context
  currentPage: {
    path: string;
    title: string;
    content: string;          // Full HTML content
    frontmatter: object;      // Page metadata
    images: string[];         // Images on page
    links: string[];          // Links on page
  };

  // User intent
  userMessage: string;        // Current prompt
  conversationHistory: Message[];  // Previous messages

  // Constraints
  capabilities: string[];     // What AI can modify
  restrictions: string[];     // What AI cannot do
}
```

### Prompt Engineering

**System Prompt Template:**
```
You are an expert webmaster AI assistant for Anglesite, a local-first static site generator.

CAPABILITIES:
- Edit HTML, CSS, and page content
- Update website.json configuration
- Add/modify images with optimization
- Configure SEO metadata
- Create new pages and blog posts
- Improve copy for clarity and SEO

GUIDELINES:
- Always explain changes before applying
- Follow web best practices (accessibility, SEO, performance)
- Maintain existing site structure and style
- Use semantic HTML
- Ensure mobile responsiveness
- Add alt text to all images

CURRENT SITE CONTEXT:
Site Name: {website.name}
Current Page: {currentPage.path}
Site Description: {website.description}

AVAILABLE PAGES:
{pages.map(p => `- ${p.path}: ${p.title}`).join('\n')}

USER REQUEST:
{userMessage}

Propose specific changes with explanations.
```

**Example User Prompts:**
1. "Add a contact form to this page with fields for name, email, and message"
2. "Rewrite this section to be more professional and SEO-friendly"
3. "Create a new About page with sections for our story, team, and values"
4. "Make the hero section more visually appealing"
5. "Add a blog post about the benefits of our service"
6. "Improve the SEO for this page"
7. "Translate this page to Spanish"

### Agent Response Format

```typescript
interface AIResponse {
  explanation: string;          // What the AI plans to do
  reasoning: string;            // Why these changes are good
  changes: Change[];            // Specific file changes
  preview: string;              // Preview of result
  confidence: number;           // AI confidence (0-1)
  alternatives?: string[];      // Alternative approaches
}

interface Change {
  type: 'edit' | 'create' | 'delete' | 'rename';
  file: string;                 // File path
  diff?: string;                // Unified diff
  before?: string;              // Original content
  after?: string;               // New content
  description: string;          // Change description
}
```

## User Flow Diagram

```
[User Opens AI Webmaster]
    ↓
[Types Natural Language Request]
    ↓
[AI Analyzes Context]
    ├─ Reads current page
    ├─ Reads website.json
    ├─ Understands site structure
    └─ Reviews conversation history
    ↓
[AI Proposes Changes]
    ├─ Shows explanation
    ├─ Shows preview
    └─ Lists specific edits
    ↓
[User Reviews Proposal]
    ├─ [Approve] → Apply changes
    ├─ [Refine] → "Make the headline shorter"
    └─ [Reject] → Back to chat
    ↓
[Changes Applied]
    ├─ Files updated
    ├─ Preview refreshes
    └─ History recorded
    ↓
[User Continues] OR [Undo if Needed]
```

## AI Webmaster UI

### Chat Interface
```
┌─────────────────────────────────────────┐
│  AI Webmaster                      [✕]  │
├─────────────────────────────────────────┤
│                                         │
│  💬 Chat History                        │
│                                         │
│  You: Add a contact form to this page   │
│                                         │
│  AI: I'll add a professional contact    │
│  form with name, email, and message     │
│  fields. I'll place it in a new         │
│  "Contact Us" section at the bottom.    │
│                                         │
│  [Preview Changes] [Apply] [Refine]     │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  You: Make it look more modern          │
│                                         │
│  AI: I'll update the form with:         │
│  • Rounded input fields                 │
│  • Modern color scheme (blue accent)    │
│  • Better spacing and layout            │
│  • Responsive mobile design             │
│                                         │
│  [Preview] [Apply] [Undo Last]          │
│                                         │
├─────────────────────────────────────────┤
│  Type your request...                   │
│  ┌─────────────────────────────────────┐│
│  │                                     ││
│  └─────────────────────────────────────┘│
│  [Send] or press Enter                  │
└─────────────────────────────────────────┘
```

### Change Preview
```
┌─────────────────────────────────────────┐
│  Proposed Changes                       │
│                                         │
│  📝 index.html                          │
│  + Added contact form section           │
│  + Added form styling                   │
│                                         │
│  📊 website.json                        │
│  ~ Updated navigation to include contact│
│                                         │
│  🎨 assets/css/main.css                 │
│  + Added .contact-form styles           │
│                                         │
│  [View Diff] [Apply All] [Reject]       │
│                                         │
│  AI Explanation:                        │
│  I added a responsive contact form with │
│  proper accessibility (labels, ARIA).   │
│  The form uses CloudFlare Workers for   │
│  submission handling. Mobile-optimized  │
│  with validation.                       │
└─────────────────────────────────────────┘
```

### Diff View
```
┌─────────────────────────────────────────┐
│  index.html - Changes                   │
│                                         │
│  @@ -45,6 +45,28 @@                     │
│   </section>                            │
│                                         │
│  +<section class="contact-form">        │
│  +  <h2>Contact Us</h2>                 │
│  +  <form>                              │
│  +    <label for="name">Name</label>    │
│  +    <input type="text" id="name"      │
│  +           required />                │
│  +    ...                               │
│  +  </form>                             │
│  +</section>                            │
│                                         │
│  [Apply This Change] [Skip]             │
└─────────────────────────────────────────┘
```

## Success Metrics

- **Task Completion**: > 80% of AI requests successfully completed
- **User Satisfaction**: > 4/5 rating for AI suggestions
- **Acceptance Rate**: > 70% of AI proposals accepted
- **Time Savings**: 50% reduction in time vs. manual editing
- **Quality**: AI-generated content scores > 85 on quality metrics

## Example Interactions

### Example 1: Add Contact Form
```
User: "Add a contact form to the bottom of this page"

AI: "I'll add a professional contact form with the following:
     • Fields: Name, Email, Message
     • CloudFlare Workers integration for form handling
     • Mobile-responsive design
     • Accessibility features (labels, ARIA)
     • Spam protection with reCAPTCHA

     Changes:
     - index.html: New contact section
     - website.json: Added contact page to navigation
     - assets/css/main.css: Form styling

     [Preview] [Apply] [Customize]"

User: [Clicks Apply]

AI: "✓ Contact form added successfully!
     The form will send submissions to your email once you
     configure CloudFlare Workers deployment.

     [Configure Email] [Test Form] [Close]"
```

### Example 2: Improve SEO
```
User: "Improve the SEO for this page"

AI: "I'll optimize SEO for the Home page:

     Current Issues:
     • Meta description too short (85 chars)
     • Missing Open Graph image
     • H1 heading missing keywords

     Proposed Changes:
     1. Title: 'Home' → 'Best Coffee in Portland | Mike's Coffee'
     2. Description: Expanded to 155 chars with keywords
     3. Added Open Graph image (shop-front.jpg)
     4. Updated H1 to include 'Portland Coffee Shop'
     5. Added internal links to About and Menu pages

     Estimated Impact:
     • SEO Score: 72 → 94
     • Click-through rate: +25% (industry avg)

     [Preview] [Apply] [Explain More]"
```

### Example 3: Content Generation
```
User: "Write an About page for my coffee shop"

AI: "I'll create an engaging About page based on your site info:

     Sections:
     1. Our Story (origin, journey, passion for coffee)
     2. Our Team (meet the baristas)
     3. Our Values (quality, community, sustainability)
     4. Visit Us (location, hours, directions)

     Content highlights:
     • Professional yet warm tone
     • SEO-optimized (keywords: Portland, coffee shop)
     • Mobile-friendly layout
     • High-quality placeholder for team photos
     • Call-to-action: Visit us today

     [Preview Content] [Apply] [Customize Tone]"

User: "Make it more casual and friendly"

AI: "Updated! I've rewritten the About page with:
     • Conversational tone ('Hey coffee lovers!')
     • Personal stories and anecdotes
     • Casual language while maintaining professionalism
     • Friendly call-to-action ('Come say hi!')

     [Preview] [Apply]"
```

### Example 4: Design Changes
```
User: "Make the hero section more visually appealing"

AI: "I'll enhance the hero section with:

     Visual Improvements:
     • Larger, more impactful headline
     • Gradient background (warm brown → cream)
     • Hero image with overlay effect
     • Animated CTA button
     • Better typography hierarchy

     Layout Changes:
     • 60/40 split (text left, image right)
     • Increased padding for breathing room
     • Centered on mobile

     [Preview] [Apply] [Try Different Style]"
```

## Advanced Features (Post-MVP)

### 1. Multi-Page Operations
- "Update the navigation across all pages"
- "Ensure consistent branding site-wide"
- "Add a footer to every page"

### 2. Batch Content Generation
- Generate multiple blog posts from topics
- Create product pages from CSV
- Populate testimonials section

### 3. Voice Commands
- Voice-to-text for AI prompts
- Hands-free website editing

### 4. Learning from Feedback
- Remember user preferences
- Learn site-specific conventions
- Improve suggestions over time

### 5. Collaborative Editing
- AI suggests improvements during manual edits
- Real-time AI assistance as you type
- Proactive optimization suggestions

### 6. Advanced Analysis
- "Analyze my site and suggest improvements"
- "Compare my site to competitors"
- "Audit accessibility and fix issues"

## Edge Cases & Error Handling

### 1. AI Cannot Complete Request
```
User: "Add a video player with live streaming"

AI: "I can't add live streaming functionality as it requires
     server-side components beyond static site capabilities.

     Alternative suggestions:
     • Embed YouTube/Vimeo live stream
     • Use CloudFlare Stream for video hosting
     • Link to external streaming platform

     Would you like me to add an embedded player instead?"
```

### 2. Conflicting Instructions
```
User: "Make the text bigger and more readable"
[AI increases font size]

User: "Actually, make it more compact"

AI: "I notice this conflicts with your previous request.
     Would you like me to:
     • Undo the size increase and make it compact?
     • Keep larger text but reduce spacing?
     • Find a balance between readable and compact?

     [Option 1] [Option 2] [Option 3]"
```

### 3. Unsafe Changes
```
User: "Delete all images to make the site faster"

AI: "⚠️ Warning: Deleting all images would:
     • Remove visual appeal
     • Hurt user engagement (-40% avg)
     • Negatively impact SEO (no image alt text)

     Better alternatives:
     • Optimize images (reduce 60% file size)
     • Lazy load images below fold
     • Convert to WebP format

     [Optimize Images] [Continue Anyway] [Cancel]"
```

### 4. API Rate Limits
```
AI: "⏳ I'm approaching API rate limits.
     Pausing for 60 seconds...

     Completed so far:
     ✓ Updated homepage
     ✓ Added contact form
     ⏱️ Pending: About page rewrite

     [Wait] [Complete Later] [Cancel Remaining]"
```

### 5. Ambiguous Requests
```
User: "Make it better"

AI: "I need more specifics to help effectively.
     What would you like to improve?

     Common requests:
     • SEO and search rankings
     • Visual design and layout
     • Content clarity and tone
     • Mobile responsiveness
     • Page load speed

     Or describe what 'better' means to you."
```

## Security & Privacy Considerations

### 1. Data Handling
- [ ] All AI processing uses Anthropic API (no data stored on Anthropic servers)
- [ ] Sensitive data (passwords, API keys) never sent to AI
- [ ] User can review all data sent to AI before submission
- [ ] Option to disable AI features entirely

### 2. Change Validation
- [ ] AI cannot delete entire site
- [ ] AI cannot modify .anglesite/ config without confirmation
- [ ] AI cannot add external scripts without user approval
- [ ] Changes limited to content and styling (not core functionality)

### 3. User Control
- [ ] All AI actions require explicit user approval
- [ ] Complete undo/redo history
- [ ] Ability to reject or refine any suggestion
- [ ] Clear explanation of every change

## Related Stories

- [02 - Visual Page Editing](02-visual-page-editing.md) - Manual editing alternative
- [07 - SEO Metadata](07-seo-metadata.md) - AI can optimize SEO
- [09 - Template Selection](09-template-selection.md) - AI can apply templates
- [10 - Blog Creation](10-blog-creation.md) - AI can write blog posts

## API Integration Details

### Anthropic Claude API
- Model: Claude 3.5 Sonnet (or latest)
- Max tokens: 4096 for responses
- Temperature: 0.3 (more deterministic)
- System prompt with Anglesite-specific instructions

### Cost Estimation
- Average request: ~2K input tokens + 1K output tokens
- Cost per request: ~$0.03 (Sonnet pricing)
- Typical session: 10 requests = ~$0.30
- Monthly (100 active users): ~$300/month

### API Configuration
```typescript
interface AIConfig {
  provider: 'anthropic';
  model: 'claude-3-5-sonnet-20241022';
  apiKey: string;                  // From user settings (encrypted)
  maxTokens: 4096;
  temperature: 0.3;
  systemPrompt: string;            // Anglesite-specific instructions
}
```

## Open Questions

- Q: Should AI have access to website analytics data?
  - A: Post-MVP, could use analytics to inform suggestions

- Q: How to handle AI-generated content attribution?
  - A: Add optional "Edited with AI" badge, user's choice

- Q: Support for custom AI models (local LLMs)?
  - A: Post-MVP, consider Ollama integration for privacy

- Q: Rate limiting for AI requests?
  - A: Implement client-side limits (10 requests/hour free tier)

## Testing Scenarios

1. **Simple Content Edit**: "Fix typos on this page"
2. **Structural Change**: "Add a pricing section with 3 tiers"
3. **Multi-File Edit**: "Update site name everywhere"
4. **SEO Optimization**: "Improve SEO for all pages"
5. **Content Generation**: "Write a blog post about X"
6. **Design Adjustment**: "Make the site more modern"
7. **Undo/Redo**: Apply AI change, undo, redo
8. **Refine Request**: Give feedback on AI proposal
9. **Error Handling**: Request impossible change
10. **Context Awareness**: "Add this to the About page" (when on Home)

## Definition of Done

- [ ] AI chat interface implemented in editor
- [ ] Claude API integration working
- [ ] Context builder collects site/page information
- [ ] Change preview and diff view functional
- [ ] Apply changes updates files correctly
- [ ] Undo/redo for AI changes working
- [ ] Security validation for AI-proposed changes
- [ ] Error handling for API failures and rate limits
- [ ] Performance: < 3 seconds for AI response
- [ ] Cost monitoring and rate limiting implemented
- [ ] Documentation: AI capabilities and best practices guide
- [ ] User testing: 10 users successfully use AI for site edits
- [ ] Quality: > 80% AI request success rate
- [ ] Safety: No security issues in penetration testing
