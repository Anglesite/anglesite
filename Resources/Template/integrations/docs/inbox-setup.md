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

## What this doesn't do yet

The infrastructure for capturing visitor messages into this Inbox exists ([#587](https://github.com/Anglesite/Anglesite/issues/587)): a
Worker route (`/inbox`) stages submissions to a KV store, and on each site open, the app automatically
pulls and commits them into your repo's Inbox collection as new entries. To use it, you need to set up
a Cloudflare KV namespace for staging and configure your site with its ID and your account ID — this
requires manual provisioning steps for now. Once you've done that, visitor messages sent to your `/inbox`
endpoint will flow directly into this collection.

Until a Settings wizard to automate this provisioning is built, you can either set up the namespace
manually (store the IDs in `SiteSettings.inboxCaptureAccountID` and `inboxCaptureKVNamespaceID`), or
keep routing visitor feedback through the [Contact Form integration](../pages/contact.astro) as you do today.
