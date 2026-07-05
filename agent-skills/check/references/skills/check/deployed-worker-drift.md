# Deployed worker drift

This section verifies each Cloudflare Worker the site uses against its deployed
counterpart. It assumes the caller already confirmed `CLOUDFLARE_ACCOUNT_ID` is
set and the active Cloudflare account matches it (the "Cloudflare account
alignment" check in the main check skill) — only proceed past that gate.

## Step 1 — Build the expected-worker list

Walk `worker/` for the wrangler config files that ship with this site. Each maps to a deployed Worker name:

| Local config | Deployed Worker name | Skill |
|---|---|---|
| `worker/wrangler.toml` | `contact-form` | contact |
| `worker/forms-wrangler.toml` | `forms-handler` | forms |
| `worker/subscribe-wrangler.toml` | `newsletter-subscribe` | newsletter |
| `worker/membership-wrangler.toml` | `anglesite-membership` | membership |
| `worker/wrangler-ecommerce.toml` | `ecommerce-webhooks` | add-store |
| `worker/review-wrangler.toml` | `review-form` | testimonials |

Read the `name = "..."` field from each `.toml` rather than hard-coding — owners may have renamed a Worker. Skip configs that don't exist locally; the owner hasn't enabled that feature.

For each expected Worker, also note the matching local source file (e.g. `worker/contact-worker.js`, `worker/forms-worker.js`). The source file is what `workers_get_worker_code` will be diffed against.

## Step 2 — Verify deployment

Call `mcp__cloudflare__workers_list` once. For each expected Worker, check whether its name is in the returned list:

- **Missing entirely** — flag as "Worth fixing soon": "Your contact form code exists in the project, but it hasn't been published to Cloudflare yet. Run `/anglesite:deploy` to publish it."
- **Present** — continue to Step 3.

## Step 3 — Check freshness and drift

For each Worker that is present, call `mcp__cloudflare__workers_get_worker` to read deployment metadata (last-modified timestamp, route bindings). Compare:

1. **Local source mtime vs. deployed `modified_on`** — if the local `.js` file was edited *after* the last deploy, the deployed version is stale. Use `stat` to get the local mtime.
2. **Deployed source vs. local source** — call `mcp__cloudflare__workers_get_worker_code` and compare against the local `.js` file. Treat them as a match if the strings are byte-identical after trimming trailing whitespace; otherwise flag as drifted.

## Step 4 — Verify Workers Logs (observability)

For every helper Worker config that exists locally, grep the `.toml` file for an `[observability]` block with `enabled = true`. Workers Logs is what lets the owner diagnose a failed contact form / subscribe / webhook *after the fact* — without it, errors only surface during a live `wrangler tail` and then disappear.

| State | Severity | Plain-language framing |
|---|---|---|
| `[observability]` block missing or `enabled = false` | Worth fixing soon | "Your [feature] worker isn't keeping logs, so if a submission fails we can't see why. Add `[observability]` with `enabled = true` to `worker/[file].toml` and redeploy." |
| `[observability]` enabled locally but deployed Worker predates it | Worth fixing soon | "Logs are enabled in your project, but the live worker was deployed before that change. Re-run `/anglesite:deploy` to apply." |
| Enabled and deployed | All good | (include in scorecard, no separate bullet) |

Workers Logs is free on the Workers free plan; there's no reason to leave it off.

## Step 5 — Present findings

Report one bullet per expected Worker, using the existing severity vocabulary. Keep it boolean — owners don't need a diff:

| State | Severity | Plain-language framing |
|---|---|---|
| Worker missing on account | Worth fixing soon | "Your [feature] hasn't been published to Cloudflare yet. Run `/anglesite:deploy` to publish it." |
| Local newer than deployed | Worth fixing soon | "You changed your [feature] code on [date], but the live version is still from [earlier date]. Re-run `/anglesite:deploy` to publish your changes." |
| Code differs, mtimes match | Worth fixing soon | "The live version of your [feature] doesn't match what's in your project. Re-run `/anglesite:deploy` to bring them back in sync." |
| Up to date | All good | (include in scorecard, no separate bullet) |

Map "[feature]" to plain language — `contact-form` → "contact form", `newsletter-subscribe` → "newsletter signup", `forms-handler` → "custom forms", `anglesite-membership` → "members area", `ecommerce-webhooks` → "store order tracker", `review-form` → "review form."

This check is **read-only.** Never call any Workers write tool from here, and never offer to "fix" drift by editing the deployed code — the only safe remediation is `/anglesite:deploy`.
