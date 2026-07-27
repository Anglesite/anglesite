# Newsletter subscribe Worker setup

The newsletter integration's subscribe form posts to a small Cloudflare Worker
that forwards each submission to your newsletter platform. Running it as a
separate Worker keeps your platform API key off the client — it never appears
in the site's HTML or JavaScript.

This site includes the Worker's source at `worker/subscribe-worker.js` and its
config at `worker/subscribe-wrangler.toml`. Deploying it is a one-time, manual
step from a terminal (it isn't deployed automatically when you deploy the
site itself):

1. **Get an API key.**
   - **Buttondown**: sign up at buttondown.email, then Settings → API → copy the key.
   - **Mailchimp**: sign up at mailchimp.com, create an audience, then Account → Extras → API keys → create a key. Also note the Audience ID (Audience → Settings → Audience name and defaults).
   - **beehiiv**: sign up at beehiiv.com (the free Launch plan includes API access), then Settings → API → create a key. Also note your publication ID (starts with `pub_`, shown on the same page).
   - **Kit**: sign up at kit.com (the free Newsletter plan includes API access), then Settings → Developer → create a V4 API key. Also create a form (Grow → Landing Pages & Forms) with **double opt-in enabled** in its settings, and note the form ID — the number in the form's URL.

2. **From a terminal, in this site's directory, store the secrets:**

   ```sh
   npx wrangler secret put NEWSLETTER_API_KEY --config worker/subscribe-wrangler.toml
   npx wrangler secret put NEWSLETTER_PLATFORM --config worker/subscribe-wrangler.toml
   npx wrangler secret put SITE_DOMAIN --config worker/subscribe-wrangler.toml
   ```

   Paste the API key, `buttondown`, `mailchimp`, `beehiiv`, or `kit`, and your
   site's domain (e.g. `example.com`) when prompted. If you're using Mailchimp,
   also run:

   ```sh
   npx wrangler secret put MAILCHIMP_LIST_ID --config worker/subscribe-wrangler.toml
   ```

   If you're using beehiiv, also run:

   ```sh
   npx wrangler secret put BEEHIIV_PUBLICATION_ID --config worker/subscribe-wrangler.toml
   ```

   If you're using Kit, also run:

   ```sh
   npx wrangler secret put KIT_FORM_ID --config worker/subscribe-wrangler.toml
   ```

3. **Deploy the Worker:**

   ```sh
   npx wrangler deploy --config worker/subscribe-wrangler.toml
   ```

   Wrangler prints the deployed Worker's URL (something like
   `https://newsletter-subscribe.<your-account>.workers.dev`).

4. **Paste that URL into the newsletter wizard's "Subscribe Worker URL" field.**
   The wizard writes it to `.site-config` and allows it through the site's
   Content-Security-Policy automatically.
