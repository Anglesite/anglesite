---
name: booking
description: "Embed appointment scheduling (Cal.com or Calendly) into the site"
allowed-tools: Write, Read, Glob, Bash(npm run build), Bash(npx astro check)
disable-model-invocation: true
---

Embed a booking widget into the site so visitors can schedule appointments directly. Supports Cal.com (default, open-source) and Calendly as providers. Generates a reusable `BookingWidget.astro` component, wires it into the appropriate page(s), applies the site's brand color, injects Schema.org structured data, and updates CSP headers.

## Architecture decisions

- [ADR-0008 No third-party JS](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0008-no-third-party-javascript.md) — booking widgets are a sanctioned exception; must update CSP allowlist and pre-deploy scan config
- [ADR-0009 Industry tools first](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0009-industry-tools-over-custom-code.md) — use existing scheduling platforms rather than building custom booking logic

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that will trigger a permission prompt. If `false`, proceed without pre-announcing.

## Flags

The command accepts flags that skip prompts:

| Flag | Skips |
|---|---|
| `--provider=cal\|calendly` | Provider prompt |
| `--username=<slug>` | Username prompt |
| `--event=<slug>` | Event type prompt (repeatable) |
| `--style=inline\|floating\|button` | Style prompt |
| `--page=<path>` | Target page prompt (for inline/button) |

Parse flags from the command arguments before starting the prompt flow. Skip any prompt whose value was provided via flag.

## Step 0 — Check prerequisites

Read `.site-config` for `BOOKING_PROVIDER` and `BOOKING_USERNAME`. If both exist, this is an update — tell the owner: "You already have a booking widget set up. I can update it, add more event types, or change the style. What would you like to do?"

## Step 1 — Collect information

Ask the owner each question in order, skipping any answered by flags:

### 1a. Provider

"Which scheduling service do you use — Cal.com or Calendly? Cal.com is free, open-source, and privacy-friendly, so I'd recommend it if you're starting fresh."

Default to `cal` if the owner has no preference.

### 1b. Username

"What's your {provider} username? It's the part after {provider-url}/ — for example, if your booking page is {provider-url}/janedoe, your username is `janedoe`."

If the owner doesn't have an account:

- **Cal.com:** "No problem! You can sign up for free at https://cal.com/signup — come back when you're set up."
- **Calendly:** "You can create an account at https://calendly.com/signup — come back when you're ready."

Exit gracefully. Do not write any files.

### 1c. Event types

"What appointment types do you offer? For example, `30min`, `consultation`, `haircut-45`. I'll set up each one. You can also skip this to use your default booking page."

Loop until the owner is done. Store as a comma-separated list.

### 1d. Embed style

"How would you like the booking widget to appear?"

- **Inline** — "A full calendar embedded in a page section. Best for a dedicated `/book` page."
- **Floating** — "A 'Book Now' button fixed to the bottom-right corner of every page."
- **Button** — "A popup that opens when someone clicks a button. I can add it to any page."

### 1e. Placement (conditional)

- If **inline**: "Should I create a new `/book` page, or add it to an existing page?"
- If **button**: "Which page should the button go on, and what should it say?" Default text: "Book Now"
- If **floating**: No placement question needed — goes in the root layout.

### 1f. Button text (for floating and button styles)

"What should the button say?" Default: "Book Now"

## Step 2 — Extract brand color

Read `src/styles/global.css` and extract `--color-primary` using the logic from `${CLAUDE_PLUGIN_ROOT}/template/scripts/booking.ts:extractBrandColor()`. Fall back to `#000000` if not found.

## Step 3 — Generate the component

Create `src/components/BookingWidget.astro` using the embed code from the helper functions in `${CLAUDE_PLUGIN_ROOT}/template/scripts/booking.ts`. The component should:

1. Accept props: `provider`, `username`, `eventSlug`, `style`, `buttonText`, `brandColor`
2. Render the appropriate embed code based on provider and style
3. Use `is:inline` for all scripts (required for third-party embed loaders)

If the component already exists, update it.

Use the pre-built template at `${CLAUDE_PLUGIN_ROOT}/template/src/components/BookingWidget.astro` as a starting point — copy it to the site and customize with the owner's settings.

## Step 4 — Place the widget

Based on the chosen style:

### Inline

If creating a new `/book` page:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import BookingWidget from '../components/BookingWidget.astro';
---
<BaseLayout title="Book an Appointment" description="Schedule your appointment online.">
  <main>
    <h1>Book an Appointment</h1>
    <BookingWidget
      provider="{provider}"
      username="{username}"
      eventSlug="{eventSlug}"
      style="inline"
      brandColor="{brandColor}"
    />
  </main>
</BaseLayout>
```

If adding to an existing page, insert the `<BookingWidget>` import and tag in the appropriate content area.

### Floating

Import and render `BookingWidget` in `src/layouts/BaseLayout.astro`, just before `</body>`:

```astro
<BookingWidget
  provider="{provider}"
  username="{username}"
  eventSlug="{eventSlug}"
  style="floating"
  buttonText="{buttonText}"
  brandColor="{brandColor}"
/>
```

### Button

Insert a `<BookingWidget style="button">` at the target location in the specified page. Import the component at the top.

## Step 5 — Inject Schema.org structured data

Generate `ReserveAction` JSON-LD using `buildReserveAction()` from `${CLAUDE_PLUGIN_ROOT}/template/scripts/booking.ts`.

Add the `potentialAction` entries to the existing LocalBusiness JSON-LD if present, or create a standalone `<script type="application/ld+json">` block in the `<head>` of the page(s) where the widget appears.

For floating style (site-wide), add the structured data to the root layout or homepage.

## Step 6 — Update CSP and pre-deploy scan

### Content Security Policy

Read `public/_headers` and update the CSP to allow the provider's domains. Use `buildBookingCSP()` from `${CLAUDE_PLUGIN_ROOT}/template/scripts/booking.ts` to get the required domains:

**Cal.com:** Add `app.cal.com` to `script-src`, `style-src`, and `frame-src`.

**Calendly:** Add `assets.calendly.com` to `script-src` and `style-src`. Add `calendly.com` to `frame-src`.

### Pre-deploy scan

The pre-deploy scan blocks third-party scripts by default. Update `scripts/pre-deploy-check.ts` (or `.site-config`) to allowlist the provider's script domains:

- Cal.com: `SCRIPT_ALLOW=app.cal.com`
- Calendly: `SCRIPT_ALLOW=assets.calendly.com`

Add to `.site-config` as a comma-separated allowlist if multiple providers are configured.

## Step 7 — Save configuration

Save to `.site-config`:

```
BOOKING_PROVIDER=cal
BOOKING_USERNAME=janedoe
BOOKING_EVENTS=30min,consultation
BOOKING_STYLE=inline
BOOKING_PAGE=/book
BOOKING_BUTTON_TEXT=Book Now
```

## Step 8 — Verify

Run `npm run build` to ensure the site builds cleanly with the new component.

Tell the owner: "Your booking widget is set up! Visitors can now book appointments directly from your site. Want to preview it?"

If the build fails, diagnose and fix before presenting to the owner.

## Re-running the command

If `/anglesite:booking` is run again on a site that already has a booking widget:

1. Read existing config from `.site-config`
2. Ask what the owner wants to change
3. Update the component, page placement, CSP, and config as needed
4. Re-build to verify

The command is idempotent — running it again with the same settings should produce the same result.
