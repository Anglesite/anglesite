# Inbox

The Inbox integration adds a **Keystatic-managed collection** for messages you want to keep track
of on your own site instead of (or alongside) email.

## Adding a message

1. Open your site in Anglesite and start the dev server (or run `npx astro dev` inside `Source/`).
2. Visit `/keystatic` in the preview.
3. Under **Inbox**, click **Create**, and fill in the subject, sender, received date, and message.
   A **status** field (New/Reviewed/Archived) is also on the entry, defaulting to "New" — set it
   later as you triage.
4. Save — the entry is written to `src/content/inbox/` as a Markdown file in your site's git repo.

Use it for anything you'd otherwise handle by copying an email into a note: a message forwarded
from your contact form provider, a question someone asked in person, a reminder to follow up.

## Capturing visitor messages automatically

Beyond entries you add by hand, this Inbox can also receive messages submitted by visitors
([#587](https://github.com/Anglesite/Anglesite/issues/587)): a Worker route (`/inbox`) stages
submissions to a Cloudflare KV store, and on each site open, the app automatically pulls and
commits them into your repo's Inbox collection as new entries.

To turn this on, go to **Site Settings ▸ Workers** and enable the **Inbox Capture** toggle — the
app provisions the KV namespace and account id for you, no manual field-editing required. It
activates on your next deploy: once live, visitor messages sent to your `/inbox` endpoint flow
directly into this collection.

If you'd rather not provision Cloudflare resources for this site, keep routing visitor feedback
through the [Contact Form integration](../pages/contact.astro) instead.
