# Local HTTPS

Reference for the webmaster agent and for handoff scenarios. Not user-facing.

## How it works

The dev server runs with HTTPS using locally-trusted certificates. The browser shows a padlock — no security warnings.

| Component | Role |
|---|---|
| **mkcert** | Generates certificates trusted by macOS Keychain. Binary at `~/.local/bin/mkcert`. |
| **.certs/** | Cert + key files. Gitignored, .nosync'd. Machine-specific. |
| **/etc/hosts** | Maps `DEV_HOSTNAME` to 127.0.0.1. |
| **pfctl** | Forwards port 443 → 4321 on loopback. Persists via `/etc/pf.conf` anchor. |
| **Vite server.https** | Astro reads certs from `.certs/` via Vite pass-through in `astro.config.ts`. |

Astro listens on port 4321 with TLS. pfctl makes port 443 reach it. The cert covers `DEV_HOSTNAME`, `localhost`, and `127.0.0.1`.

## DEV_HOSTNAME in .site-config

Set during `/start`. Format depends on what the owner knows:

| Owner knows their domain | `DEV_HOSTNAME` |
|---|---|
| Yes (`keithelectric.com`) | `keithelectric.com.local` |
| No (business name: "Keith Electric") | `keithelectric.local` |

Updated during `/deploy` when a real domain is chosen: `keithelectric.com.local`.

## Certificate lifecycle

- Generated during `setup.sh` based on `DEV_HOSTNAME`
- Covers: `DEV_HOSTNAME`, `localhost`, `127.0.0.1`
- mkcert certs last ~2 years (825 days)
- Regenerated automatically if hostname changes (`setup.sh` checks `.certs/.hostname`)
- `check-prereqs.sh` checks expiry with `openssl x509 -checkend`

## The .local TLD

macOS uses `.local` for mDNS (Bonjour). Having the entry in `/etc/hosts` takes priority over mDNS resolution. There may be a brief delay on first resolution if mDNS fires before `/etc/hosts` is checked. This is acceptable for a dev environment.

## Port forwarding

pfctl rules live in `/etc/pf.anchors/com.anglesite` and are referenced from `/etc/pf.conf`. macOS loads these at boot via the system `com.apple.pfctl` LaunchDaemon, so they persist across reboots.

If rules are lost (macOS update, manual pf.conf edit), `setup.sh` re-applies them.

## New machine setup

When the project is moved to a new machine (handoff, new laptop), run `zsh scripts/setup.sh`. It installs mkcert, trusts the CA, generates new certs, adds `/etc/hosts`, and configures pfctl. Certificates are machine-specific and never committed to git.

## Cleanup

To remove all system modifications without deleting the project:

```sh
zsh scripts/cleanup.sh
```

This removes the `/etc/hosts` entry and pfctl anchor. To also remove the CA from Keychain:

```sh
~/.local/bin/mkcert -uninstall
```
