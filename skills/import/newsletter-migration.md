# Step 2.5 — Newsletter subscriber migration

If PLATFORM is `ghost` or `substack`, offer newsletter migration after content
import is complete.

Tell the owner:
> "Your [Platform] site also has a newsletter with email subscribers. Would you
> like to set up a newsletter on your new site?"

Present the options:
> - **Use Ghost for newsletters** — I'll help you connect a Ghost instance so
>   you can send blog posts as emails to your subscribers. Recommended if you
>   already have a Ghost instance or want paid subscriptions.
> - **Use Buttondown** — A simple, privacy-focused newsletter service. Free for
>   up to 100 subscribers. I'll help you export and import your subscriber list.
> - **Skip for now** — You can set up a newsletter later.

Wait for the owner's answer.

## If they choose Ghost

Read `${CLAUDE_PLUGIN_ROOT}/docs/platforms/ghost-newsletter.md` for setup details.

**Ghost → Ghost (same instance):** The subscribers are already in Ghost. Tell
the owner:
> "Your subscribers are already in Ghost, so there's nothing to migrate. I'll
> set up a signup form on the website that connects to your Ghost instance."

Ask for the Ghost Admin API URL and key. Add a newsletter signup form to the
website footer (see `${CLAUDE_PLUGIN_ROOT}/docs/platforms/ghost-newsletter.md` → Website integration).
Update the CSP `form-action` in `public/_headers`.

**Substack → Ghost:** Tell the owner:
> "Ghost can import your Substack subscribers directly. In Ghost Admin, go to
> Settings → Advanced → Import/Export → Import, select 'Substack', and upload
> the ZIP file you exported from Substack (Dashboard → Settings → Exports).
> Ghost will import your subscribers automatically."

Walk them through the process. Then set up the signup form as above.

## If they choose Buttondown

Read `${CLAUDE_PLUGIN_ROOT}/docs/platforms/buttondown.md` for setup details.

**Ghost → Buttondown:** Tell the owner:
> "I need your subscriber list from Ghost. In Ghost Admin, go to Members and
> click Export. Save the CSV file and tell me where it is."

Help them import the CSV into Buttondown (buttondown.email → Subscribers →
Import).

**Substack → Buttondown:** Tell the owner:
> "Buttondown can import from Substack directly. Go to buttondown.email →
> Settings → Importing and follow the Substack import flow. Or export your
> subscribers from Substack (Dashboard → Settings → Exports) and import the
> CSV manually."

Add the Buttondown signup form to the website footer. Update the CSP
`form-action` to allow `buttondown.email`.

## Store the newsletter choice

After setup, add the newsletter platform to `.site-config`:

```
NEWSLETTER_PLATFORM=ghost
NEWSLETTER_API_URL=https://newsletter.example.com
```

Or:

```
NEWSLETTER_PLATFORM=buttondown
```

Tell the owner:
> "Your newsletter is set up! When you publish a blog post and want to send it
> as an email, just let me know and I'll send it to your subscribers."

See `${CLAUDE_PLUGIN_ROOT}/docs/newsletter-sending.md` for the sending workflow.
