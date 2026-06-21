---
name: indieweb
description: "Deploy self-owned IndieAuth, Webmention, and Micropub endpoints on your domain"
allowed-tools: Bash(npm run build), Bash(npm install *), Bash(npm view *), Bash(npx wrangler *), Bash(openssl *), Bash(grep *), Bash(gh *), Write, Read, Edit, Glob, mcp__cloudflare__accounts_list, mcp__cloudflare__set_active_account, mcp__cloudflare__d1_database_create, mcp__cloudflare__d1_databases_list, mcp__cloudflare__d1_database_get, mcp__cloudflare__r2_bucket_create, mcp__cloudflare__r2_buckets_list
disable-model-invocation: true
---

Set up self-owned IndieWeb endpoints on the owner's primary domain using the `@dwk/*` worker packages. Deploys IndieAuth (sign in with your domain), Webmention (receive cross-site mentions), and Micropub (publish from third-party clients) — each independently gated and composed into the site's existing `site-entry.js` Worker.

The owner's identity, tokens, and data stay on their own Cloudflare account. No third-party identity or mention hosts.

## Architecture decisions

- [ADR-0020 Active IndieWeb](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0020-active-indieweb.md) — why self-owned endpoints via `@dwk/*` composed into `site-entry.js`
- [ADR-0003 Cloudflare Workers](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0003-cloudflare-workers-hosting.md) — why Cloudflare (free CDN, Wrangler CLI, at-cost domains)
- [ADR-0011 Owner ownership](${CLAUDE_PLUGIN_ROOT}/docs/decisions/0011-owner-controls-everything.md) — identity must live on the owner's own infrastructure

Platform integration guide: [dwk-workers.md](${CLAUDE_PLUGIN_ROOT}/docs/platforms/dwk-workers.md) — read this before running the skill for binding details, the Micropub publish loop, and the DPoP caveat.

Read `EXPLAIN_STEPS` from `.site-config`. If `true` or not set, explain before every tool call that triggers a permission prompt — say what you're about to do and why in plain language. If `false`, proceed without pre-announcing.

## Step 0 — Preflight

Read `.site-config` and verify all three prerequisites:

1. **Custom domain** — `SITE_DOMAIN` must be set and must **not** end in `.workers.dev`. IndieAuth identity is HTTPS-rooted at the owner's primary domain; a `*.workers.dev` address cannot serve as an identity root. If missing or on `workers.dev`, tell the owner: "The IndieWeb endpoints need your site on a custom domain — your identity is rooted there. Run `/anglesite:deploy` to set up a custom domain first, then come back here."
2. **Cloudflare active** — `CF_PROJECT_NAME` must be set (site has been deployed at least once). If missing: "Deploy your site first with `/anglesite:deploy` so we have a Cloudflare project to attach the endpoints to."
3. **GitHub repo** — `GITHUB_REPO` must be set (backup configured). If missing: "Run `/anglesite:backup` to connect a GitHub repo first — the Micropub publish loop needs it to commit new posts."

If any check fails, stop. Do not proceed to Step 1.

If `INDIEWEB_ENABLED=true` is already set in `.site-config`, the endpoints are already configured. Ask the owner if they want to reconfigure (e.g. enable an endpoint they skipped) or if they need help with something else.

## Step 1 — Check package availability

The `@dwk/*` packages must be published on npm before the endpoints can be installed. Check each one:

```sh
npm view @dwk/indieauth version
```

```sh
npm view @dwk/webmention version
```

```sh
npm view @dwk/micropub version
```

If **any** package returns an error (not found) or reports version `0.0.0`, stop and tell the owner:

"The IndieWeb endpoint packages aren't published yet — this feature isn't available right now. It's being built by an open-source project and will be ready soon. I'll let you know when it ships. In the meantime, your site already supports the passive IndieWeb (microformats, `rel="me"`, RSS) — see `docs/indieweb.md` for what's already working."

Do not attempt git installs, forks, or workarounds. The gate is intentional.

## Step 2 — Choose endpoints

Tell the owner: "There are three IndieWeb endpoints you can enable — each works independently, and I'd recommend all three for the full experience:"

| Endpoint | What it does |
|---|---|
| **IndieAuth** | Sign in to other IndieWeb services with your domain; issues access tokens for Micropub |
| **Webmention** | Receive (and send) cross-site mentions, replies, and likes |
| **Micropub** | Publish to your site from phone apps and other Micropub clients |

Ask: "Which would you like to enable? (Default: all three)"

Note the dependency: Micropub requires IndieAuth for token issuance. If the owner selects Micropub but not IndieAuth, explain this and recommend enabling both. Webmention is fully independent.

Record the choices for use in subsequent steps. If the owner selects all three (or accepts the default), proceed with all.

## Step 3 — Provision bindings

Provision the Cloudflare resources each selected endpoint needs. Use the MCP tools when available; fall back to wrangler CLI otherwise.

### 3a — D1 databases

Each endpoint stores data in its own D1 database. Create only the databases for selected endpoints:

| Endpoint | D1 database name | Binding name | `.site-config` key |
|---|---|---|---|
| IndieAuth | `indieauth` | `AUTH_DB` | `INDIEWEB_AUTH_DB_ID` |
| IndieAuth (owner auth) | `owner-auth` | `OWNER_AUTH_DB` | `INDIEWEB_OWNER_AUTH_DB_ID` |
| Micropub | `micropub` | `MICROPUB_DB` | `INDIEWEB_MICROPUB_DB_ID` |
| Webmention | `webmention` | `WEBMENTION_INBOX` | `INDIEWEB_WEBMENTION_DB_ID` |

**Preferred — Cloudflare MCP (no copy-paste):**

1. Call `mcp__cloudflare__accounts_list` if the active account hasn't been resolved yet, then `mcp__cloudflare__set_active_account` with the matching `account_id`.
2. For each selected endpoint, call `mcp__cloudflare__d1_database_create` with the database name from the table above. Read the `uuid` from the response.
3. Save each database ID to `.site-config` using the Write tool (e.g. `INDIEWEB_AUTH_DB_ID=<uuid>`).

**Fallback — wrangler CLI** (use only if the Cloudflare MCP server isn't connected):

```sh
npx wrangler d1 create indieauth
```

Copy the `database_id` from the output. Save to `.site-config` as `INDIEWEB_AUTH_DB_ID=<id>`. Repeat for each selected endpoint's database.

### 3b — R2 bucket (Micropub only)

If Micropub is selected, create an R2 bucket for the media endpoint:

**Preferred — MCP:**

Call `mcp__cloudflare__r2_bucket_create` with `bucket_name: "micropub-media"`. Save the result to `.site-config` as `INDIEWEB_MEDIA_BUCKET=micropub-media`.

**Fallback:**

```sh
npx wrangler r2 bucket create micropub-media
```

Save to `.site-config` as `INDIEWEB_MEDIA_BUCKET=micropub-media`.

### 3c — Queue (Webmention only)

If Webmention is selected, create a Queue for async source-link verification. Queues are not available via the MCP tools — use wrangler:

```sh
npx wrangler queues create webmention-queue
```

Save to `.site-config` as `INDIEWEB_WEBMENTION_QUEUE=webmention-queue`.

## Step 4 — Wire bindings into `wrangler.jsonc`

Read `wrangler.jsonc`. Add the binding blocks for each provisioned resource using the Edit tool — do not Write the whole file. Insert them after the `"observability"` block.

For each selected endpoint's D1 database, add a `d1_databases` entry:

```jsonc
"d1_databases": [
  // ... any existing entries ...
  {
    "binding": "AUTH_DB",
    "database_name": "indieauth",
    "database_id": "<INDIEWEB_AUTH_DB_ID from .site-config>"
  }
]
```

If a `"d1_databases"` array already exists (e.g. from `/anglesite:inbox`), append to it rather than creating a duplicate key.

If Webmention is selected, also set the `SITE_URL` var to the site's own origin — `@dwk/webmention` needs it as its `baseUrl` at construction (the queue consumer runs off-request, with no request URL to derive an origin from). Edit the `"vars"` block in `wrangler.jsonc`:

```jsonc
"vars": {
  "SITE_URL": "https://<SITE_DOMAIN from .site-config>"
}
```

For the R2 bucket (Micropub):

```jsonc
"r2_buckets": [
  {
    "binding": "MEDIA",
    "bucket_name": "micropub-media"
  }
]
```

For the Queue (Webmention):

```jsonc
"queues": {
  "producers": [
    {
      "binding": "WEBMENTION_QUEUE",
      "queue": "webmention-queue"
    }
  ],
  "consumers": [
    {
      "queue": "webmention-queue",
      "max_batch_size": 10,
      "max_batch_timeout": 30
    }
  ]
}
```

## Step 4b — Install the endpoint packages

`site-entry.js` imports the `@dwk/*` worker packages for the endpoints it serves, so install the ones for the selected endpoints. Webmention additionally needs `microformats-parser`: the site's rich inbox (`worker/webmention-inbox.js`) parses each verified source's microformats2 so stored mentions carry the author's name, photo, and a content snippet — not just the source URL.

Install only what the owner selected:

```sh
npm install @dwk/webmention microformats-parser
```

```sh
npm install @dwk/indieauth @dwk/webauthn
```

```sh
npm install @dwk/micropub
```

(IndieAuth and Micropub are a pair — Micropub validates IndieAuth-issued tokens — so install `@dwk/indieauth` whenever `@dwk/micropub` is selected.)

## Step 5 — Store secrets

### 5a — IndieAuth signing key (if IndieAuth selected)

Generate a signing key:

```sh
openssl rand -hex 32
```

Store it as a wrangler secret on the site Worker (use the `name` value from `wrangler.jsonc`):

```sh
npx wrangler secret put INDIEAUTH_SIGNING_KEY --name <CF_PROJECT_NAME>
```

Tell the owner to paste the generated key when prompted. The key never appears in source code or `.site-config` — it lives only in Cloudflare's secret store.

### 5c — Passkey owner authentication (if IndieAuth selected)

IndieAuth signs the owner in to other sites with their domain, so the owner must
prove they are the owner before a token is minted. Anglesite uses **passkeys**
(`@dwk/webauthn`, served from the `WEBAUTHN` Durable Object — already declared in
`wrangler.jsonc`, no resource to create) plus printable backup codes.

1. **Session + registration secrets.** Generate and store both:

   ```sh
   openssl rand -hex 32
   ```

   ```sh
   npx wrangler secret put INDIEAUTH_SESSION_KEY --name <CF_PROJECT_NAME>
   ```

   ```sh
   openssl rand -hex 24
   ```

   ```sh
   npx wrangler secret put INDIEWEB_REG_TOKEN --name <CF_PROJECT_NAME>
   ```

   `INDIEAUTH_SESSION_KEY` signs the owner-session cookie; `INDIEWEB_REG_TOKEN`
   is the one-time gate for the first passkey enrolment. Both live only in the
   secret store — the deploy scan fails the build if either is committed.

2. **Enrol the first passkey.** After the next deploy, give the owner the
   one-time link (substitute the token value just set):

   `https://<SITE_DOMAIN>/auth/register?token=<INDIEWEB_REG_TOKEN>`

   Tell them to open it on each device they want to sign in from and **register
   at least two passkeys** (e.g. phone + laptop) so a lost device isn't a
   lockout. Once a passkey exists, they can add more from a signed-in session at
   `/auth/register`.

3. **Backup codes.** Have the owner generate 10 single-use backup codes from
   `/auth/register` and **print or save them now**. A code can stand in for a
   passkey on the sign-in screen if every device is unavailable. Only hashes are
   stored; the plaintext is shown once.

4. **Recovery.** Three layers: multiple passkeys, the backup codes, and — as the
   ultimate root — redeploy access. If the owner loses everything, re-run
   `/anglesite:indieweb` and choose "reset owner auth", which rotates
   `INDIEWEB_REG_TOKEN` and re-opens registration (only someone who controls the
   Cloudflare account can do this).

### 5b — GitHub token (if Micropub selected)

The Micropub→Git bridge needs a fine-grained GitHub Personal Access Token to commit new posts to the site repo.

Guide the owner:

1. Open: `https://github.com/settings/personal-access-tokens/new`
2. Token name: `anglesite-micropub`
3. Expiration: 90 days (recommend setting a calendar reminder to rotate)
4. Repository access: **Only select repositories** → pick the site repo
5. Permissions: **Contents** → Read and write (nothing else)
6. Click "Generate token" and copy it

Store it as a wrangler secret:

```sh
npx wrangler secret put GITHUB_TOKEN --name <CF_PROJECT_NAME>
```

Tell the owner to paste the token when prompted.

Also set it as a GitHub repo secret for the Actions deploy workflow:

```sh
gh secret set GITHUB_TOKEN --repo <GITHUB_REPO>
```

If `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets are not already set (check with `gh secret list --repo <GITHUB_REPO>`), guide the owner through setting those too — the Actions deploy workflow needs them:

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo <GITHUB_REPO>
```

```sh
gh secret set CLOUDFLARE_ACCOUNT_ID --repo <GITHUB_REPO>
```

The owner can find their Cloudflare API token at `https://dash.cloudflare.com/profile/api-tokens` (use the "Edit Cloudflare Workers" template) and their account ID in the Cloudflare dashboard sidebar.

## Step 6 — Write `.site-config`

Update `.site-config` with the IndieWeb configuration using the Write tool (update the existing file):

```
INDIEWEB_ENABLED=true
INDIEWEB_ME=https://<SITE_DOMAIN>
INDIEWEB_INDIEAUTH=<true|false>
INDIEWEB_MICROPUB=<true|false>
INDIEWEB_WEBMENTION=<true|false>
```

Set each endpoint flag to `true` or `false` based on the owner's choices in Step 2.

`INDIEWEB_ME` is the owner's IndieWeb identity URL — their primary domain over HTTPS. This is the `me` value that IndieAuth and Micropub use to identify the site owner.

If `OWNER_NAME` is not already set in `.site-config` and Micropub or IndieAuth is enabled, ask the owner: "What name should appear on your IndieWeb profile?" Save it as `OWNER_NAME=<name>`.

## Step 7 — Verify

Build the site to confirm everything compiles with the new dependencies and bindings:

```sh
npm run build
```

If the build fails, read the error and fix the issue before proceeding. Common causes: missing packages (re-run `npm install`), binding misconfiguration in `wrangler.jsonc` (check syntax — it's JSONC, trailing commas are OK).

## Step 8 — Summary

Tell the owner what's live and what to expect:

"Your IndieWeb endpoints are set up! Here's what we configured:"

For each enabled endpoint, explain in one sentence:

- **IndieAuth** — "You can now sign in to IndieWeb services (and any IndieAuth-compatible app) with `https://<SITE_DOMAIN>`. Your tokens are issued by your own server."
- **Webmention** — "Your site can now receive mentions, replies, and likes from other websites. They appear on your posts automatically as cards showing the sender's name, photo, and a snippet of what they wrote."
- **Micropub** — "You can publish to your site from Micropub clients (like phone apps). New posts appear as notes — they're committed to your repo and go live after a rebuild (~1–2 minutes)."

Important caveats to surface:

- **DPoP-only**: "Your Micropub endpoint requires DPoP-secured tokens for every request. This is more secure than bearer tokens, but it means some older Micropub clients won't work. Look for clients that support DPoP."
- **Rebuild delay**: "Posts published via Micropub go live after the site rebuilds (~1–2 minutes). They're queryable instantly via the Micropub API, but the public page takes a moment to appear."
- **Token rotation**: If a GitHub token was set, remind the owner about the 90-day expiration: "You set a 90-day GitHub token for the publish bridge. Set a reminder to rotate it — when it expires, new Micropub posts won't sync to your repo until you update it. Run `/anglesite:indieweb` again to reconfigure."

Suggest next steps:

- Run `/anglesite:deploy` to publish the changes
- Test IndieAuth by signing in at `https://indieauth.com` (or any relying party) with their domain
- Try posting a note from a Micropub client

## Notes

- **Per-binding gating.** Every endpoint is gated on the presence of its D1 binding in `site-entry.js`. A partially configured site still serves static pages normally — the guards are all false until the bindings exist.
- **No cost.** Everything runs within Cloudflare's free tier (Workers, D1, R2, Queues). No third-party service fees.
- **Privacy.** Webmention data (mentions from other sites) is stored in D1 on the owner's account. The owner should mention in their privacy policy that the site receives and stores Webmentions. Micropub posts are committed to the owner's private GitHub repo.
- **Diagnostics.** If endpoints misbehave, check the Worker logs: `https://dash.cloudflare.com/<account-id>/workers/services/view/<CF_PROJECT_NAME>/production/observability/logs`. Or run `/anglesite:check` which will inspect the IndieWeb endpoint configuration.
- **Schema management.** The `@dwk/indieauth` / `@dwk/micropub` packages manage their own D1 schemas, which run automatically on first request. Webmention is the exception: the site's rich inbox (`worker/webmention-inbox.js`) owns its `webmentions` table — an extended schema (author name/url/photo, content, permalink, reply/like/repost type) created on first verified mention, replacing the package's default source/target-only inbox. **Migration:** a site that already ran the earlier minimal Webmention has a 3-column `webmentions` table; `CREATE TABLE IF NOT EXISTS` won't add the new columns, so the first rich UPSERT would fail. Drop the old table once so the rich schema is recreated on the next mention (verified mentions are re-sent/re-verifiable, so nothing is permanently lost): `npx wrangler d1 execute webmention --remote --command "DROP TABLE IF EXISTS webmentions"`.
