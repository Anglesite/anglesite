# Appointment booking

Embed a scheduling widget so visitors can book appointments directly from your site. Supports Cal.com (recommended, free and open-source) and Calendly.

## What gets created

- `src/components/BookingWidget.astro` — reusable booking component
- A `/book` page (if inline style) or injection into an existing page/layout
- Schema.org `ReserveAction` structured data for search engines
- Updated CSP headers to allow the provider's embed scripts

## Prerequisites

- An account on Cal.com or Calendly with at least one event type configured
- Site deployed to Cloudflare Pages (for CSP headers to take effect)

## Configuration

These values are saved to `.site-config`:

| Key | Purpose |
|---|---|
| `BOOKING_PROVIDER` | `cal` or `calendly` |
| `BOOKING_USERNAME` | Your provider username/slug |
| `BOOKING_EVENTS` | Comma-separated event type slugs |
| `BOOKING_STYLE` | `inline`, `floating`, or `button` |
| `BOOKING_PAGE` | Page where the widget appears (for inline/button) |
| `BOOKING_BUTTON_TEXT` | Text on the booking button |

## Embed styles

| Style | Where | How |
|---|---|---|
| **Inline** | Dedicated `/book` page or section of an existing page | Full calendar rendered in-page |
| **Floating** | Every page (injected into root layout) | "Book Now" button fixed to bottom-right corner |
| **Button** | Specific page | Popup opens when visitor clicks a CTA button |

## Brand color

The widget automatically uses your site's primary color (`--color-primary` from `src/styles/global.css`) for theming. To change it, update the CSS variable and re-run the command.

## Schema.org structured data

The command adds `ReserveAction` structured data to the page(s) where the widget appears. This tells search engines your site supports online booking, which can improve visibility in local search results.

## Security

Booking widgets require loading third-party JavaScript (an exception to the default no-third-party-JS policy). The command automatically:

1. Updates `public/_headers` CSP to allow the provider's domains
2. Adds the provider's script domain to the pre-deploy scan allowlist

## Updating

Re-run `/anglesite:booking` to change the provider, style, event types, or placement. The command detects existing configuration and asks what you'd like to change.
