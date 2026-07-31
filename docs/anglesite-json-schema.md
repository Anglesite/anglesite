# `anglesite.json` schema

`Source/anglesite.json` is a git-tracked file recording the domain, DNS, edge-hardening,
email, and Workers configuration Anglesite has actually applied to a site. It lives beside the
site's Astro project, travels with the repo, and is safe to hand-edit — see
[`docs/superpowers/specs/2026-07-31-domain-config-in-git-investigation.md`](superpowers/specs/2026-07-31-domain-config-in-git-investigation.md)
for the full design rationale.

A site with no file, or an empty `{}`, has no declarations — this is the normal state for a
freshly scaffolded site and every field below is optional. As of this writing (schema version
1), nothing in Anglesite reads a decision *from* this file yet, and nothing writes to it either
— it exists so later slices ([#1170](https://github.com/Anglesite/Anglesite/issues/1170)–[#1173](https://github.com/Anglesite/Anglesite/issues/1173))
have a place to declare intent into.

## What never appears in this file

Secrets, API tokens, Cloudflare zone/account IDs, and provisioned resource IDs (D1 database IDs,
KV namespace IDs, R2 bucket names, queue names) are never written here — those stay in the app's
private `Config/` directory or the system Keychain, and are scoped to one account. This file is
portable: it should make sense read on its own, cloned to a different machine or a different
Cloudflare account.

DNS records the owner already had before Anglesite touched the zone are never mirrored into
`dns.managedRecords` — only records Anglesite itself created appear here.

## Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `version` | number | Schema version. Currently always `1`. Missing is tolerated and treated as `1`. |
| `domain` | object | See [Domain](#domain). |
| `dns` | object | See [DNS](#dns). |
| `edge` | object | See [Edge](#edge). |
| `email` | object | See [Email](#email). |
| `workers` | object | See [Workers](#workers). |

Every section is optional. A field the app has never written is simply absent — never `null`.

## Domain

| Field | Type | Meaning |
|---|---|---|
| `hostname` | string | The owner's declared domain, e.g. `"example.com"`. |
| `choice` | string | How the owner is getting this domain: `"buy"`, `"transfer"`, or `"later"`. Readers should treat any other value as unrecognized rather than erroring — this field intentionally isn't a closed set at the schema level. |
| `attach` | boolean | Whether the owner intends this domain attached to the site's deployment. The Cloudflare-side receipt of *actually* attaching stays in `.site-config`'s `CF_DOMAIN_ATTACHED` key — this field is intent, not confirmation. |

## DNS

| Field | Type | Meaning |
|---|---|---|
| `managedRecords` | array of [DNS record](#dns-record) | DNS records Anglesite created and therefore owns. |

### DNS record

| Field | Type | Meaning |
|---|---|---|
| `type` | string | The DNS record type, e.g. `"MX"`, `"TXT"`. |
| `name` | string | The record name, e.g. `"@"`, `"_atproto"`. |
| `content` | string | The record's value. |
| `priority` | number | Optional. Used by record types like `MX` that carry a priority. |
| `purpose` | string | Optional. A namespaced tag describing why Anglesite created this record, e.g. `"email:icloud"`, `"verification:bluesky"` — mirrors the `comment` field Anglesite stamps on the live Cloudflare record, so declared and live records can be matched up. |

## Edge

The edge-hardening posture Anglesite has applied. Reflects exactly what was applied, never an
aspirational target — if a field is present, the app made that change; if it's absent, the app
hasn't touched that setting (which is different from the app having explicitly turned it off).

| Field | Type | Meaning |
|---|---|---|
| `dnssec` | boolean | Whether DNSSEC is enabled. |
| `alwaysUseHTTPS` | boolean | Whether Always-Use-HTTPS is enabled. |
| `hsts` | object | See [HSTS](#hsts). |
| `cloudflare` | object | See [Cloudflare edge](#cloudflare-edge). Cloudflare-specific settings live under this key rather than at the top level of `edge`, since Cloudflare is the only v1 deploy target but not necessarily the only future one. |

### HSTS

| Field | Type | Meaning |
|---|---|---|
| `maxAge` | number | The `Strict-Transport-Security` `max-age` value, in seconds. |
| `includeSubdomains` | boolean | Whether the `includeSubDomains` directive is set. |
| `preload` | boolean | Whether the `preload` directive is set. |

### Cloudflare edge

| Field | Type | Meaning |
|---|---|---|
| `botFightMode` | boolean | Whether Cloudflare Bot Fight Mode is enabled. |
| `wafRules` | array of [WAF rule](#waf-rule) | Custom WAF rules Anglesite has applied. |

### WAF rule

| Field | Type | Meaning |
|---|---|---|
| `description` | string | A human-readable label for the rule. |
| `expression` | string | The Cloudflare WAF rule expression. |
| `action` | string | The action Cloudflare takes when the expression matches, e.g. `"block"`. |

## Email

| Field | Type | Meaning |
|---|---|---|
| `provider` | string | The email provider the owner chose, e.g. `"icloud"`. |
| `dmarcReportEmail` | string | The address DMARC aggregate reports are sent to. |

## Workers

| Field | Type | Meaning |
|---|---|---|
| `active` | array of string | The catalog IDs of the Workers the owner has activated for this site, e.g. `["webmention-receive", "micropub"]`. |

## Compatibility

Unknown keys — either a whole section this version of Anglesite doesn't recognize, or an extra
field inside a section it does — are preserved when the app rewrites this file. A hand edit, or
a field written by a newer Anglesite version, survives being loaded and re-saved by an older one.

A file that isn't valid JSON, or whose known fields don't match the types above, fails to load
with a specific error rather than being silently ignored.
