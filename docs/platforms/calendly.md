# Calendly

**Used by:** Any appointment-based business — consultations, services, coaching, real estate, photography, fitness, tutoring, freelance work.

## When to recommend

Calendly is a scheduling tool for businesses that book time with customers. Recommend it when:
- The owner takes appointments, consultations, or calls
- Customers need to pick a time slot
- The owner wants a polished booking experience with automated reminders
- The business doesn't already have scheduling built into their industry platform

Don't recommend Calendly if the business already uses Cal.com, Square Appointments, Fresha, Vagaro, Jane App, or another industry-specific booking tool that includes scheduling.

### Calendly vs Cal.com

Both work well. Key differences:
- **Calendly** — more polished UI, better known, free tier covers most small business needs, paid plans for teams and routing
- **Cal.com** — open source, self-hostable, no branding on free tier, more flexible API

Recommend Calendly if the owner values simplicity and recognizable branding. Recommend Cal.com if they prefer open source or want zero third-party branding.

## Setup

1. Create a free account at calendly.com
2. Set up event types matching the business's services:
   - **Consultation** (30 min) — for initial meetings
   - **Service appointment** (duration varies) — for the actual service
   - **Phone call** (15 min) — for quick questions
3. Set availability (business hours, buffer time, minimum notice period)
4. Connect the owner's calendar (Google Calendar, Apple Calendar, Outlook, Office 365) to prevent double-booking
5. Customize the booking page with business name and branding

## Website integration

- **Link from the website.** Add a "Book an appointment" or "Schedule a call" button on the services page, contact page, and/or home page that links to the Calendly booking page.
- **Use their direct link.** Each event type has a shareable URL (e.g., `calendly.com/businessname/consultation`). Link directly to the relevant event type from each service page.
- **Don't embed the widget.** Calendly offers embed scripts and popup widgets, but embedding them adds third-party JavaScript. Linking keeps the site clean and avoids CSP issues per ADR-0008.

Example button markup:
```html
<a href="https://calendly.com/businessname/consultation" class="button">
  Book a consultation
</a>
```

## Tips for the owner

- **Set buffer time between appointments.** 15 minutes between appointments prevents back-to-back stress and accounts for cleanup or travel.
- **Set a minimum notice period.** At least 24 hours prevents last-minute bookings the owner can't prepare for.
- **Turn on email reminders.** Calendly sends confirmation and reminder emails automatically — this reduces no-shows significantly.
- **Add questions to the booking form.** Calendly lets you add custom questions ("What would you like to discuss?") that help the owner prepare.
- **Use the mobile app.** The owner can see upcoming appointments and manage availability from their phone.
- **Set up a cancellation policy.** Calendly can show a cancellation policy and minimum cancellation notice to customers.
