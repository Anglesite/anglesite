# Local HTTPS

Reference for the webmaster agent and for handoff scenarios. Not user-facing.

## How it works

The dev server runs with HTTPS using locally-trusted certificates. The browser shows a padlock — no security warnings.

| Component | Role |
|---|---|
| **mkcert** | Generates certificates trusted by the system certificate store. Binary at `~/.local/bin/mkcert`. |
| **.certs/** | Cert + key files. Gitignored. Machine-specific. |
| **hosts file** | Maps `DEV_HOSTNAME` to 127.0.0.1. Location: `/etc/hosts` (macOS/Linux) or `C:\Windows\System32\drivers\etc\hosts` (Windows). |
| **Port forwarding** | Forwards port 443 → 4321 on loopback. macOS: pfctl via `/etc/pf.conf` anchor. Linux: iptables (manual). Windows: netsh (manual). |
| **Vite server.https** | Astro reads certs from `.certs/` via Vite pass-through in `astro.config.ts`. |

Astro listens on port 4321 with TLS. Port forwarding makes port 443 reach it. The cert covers `DEV_HOSTNAME`, `localhost`, and `127.0.0.1`.

## DEV_HOSTNAME in .site-config

Set during `/anglesite:start`. Format depends on what the owner knows:

| Owner knows their domain | `DEV_HOSTNAME` |
|---|---|
| Yes (`pairadocs.farm`) | `pairadocs.farm.local` |
| No (business name: "Pairadocs Farm") | `pairadocs-farm.local` |

Updated during `/anglesite:deploy` when a real domain is chosen: `pairadocs.farm.local`.

## Certificate lifecycle

- Generated during `npm run ai-setup` based on `DEV_HOSTNAME`
- Covers: `DEV_HOSTNAME`, `localhost`, `127.0.0.1`
- mkcert certs last ~2 years (825 days)
- Regenerated automatically if hostname changes (setup checks `.certs/.hostname`)
- `check-prereqs.ts` checks expiry with `openssl x509 -checkend`

## The .local TLD

macOS uses `.local` for mDNS (Bonjour). Having the entry in the hosts file takes priority over mDNS resolution. There may be a brief delay on first resolution if mDNS fires before the hosts file is checked. This is acceptable for a dev environment.

On Linux and Windows, `.local` may also be used by mDNS/Avahi, but the hosts file entry takes precedence.

## Port forwarding

**macOS:** pfctl rules live in `/etc/pf.anchors/com.anglesite` and are referenced from `/etc/pf.conf`. macOS loads these at boot via the system `com.apple.pfctl` LaunchDaemon, so they persist across reboots. If rules are lost (macOS update, manual pf.conf edit), `npm run ai-setup` re-applies them.

**Linux:** Port forwarding requires manual iptables or socat configuration. The setup script logs the commands needed. Rules do not persist by default — add them to your init system if needed.

**Windows:** Port forwarding requires `netsh` commands run as Administrator. The setup script logs the commands needed. Rules persist until manually removed.

## New machine setup

When the project is moved to a new machine (handoff, new laptop), run `npm run ai-setup`. It installs mkcert, trusts the CA, generates new certs, updates the hosts file, and configures port forwarding (auto on macOS, manual instructions on Linux/Windows). Certificates are machine-specific and never committed to git.

## Cleanup

To remove all system modifications without deleting the project:

```sh
npm run ai-cleanup
```

This removes the hosts file entry and port forwarding rules (macOS). To also remove the local certificate authority:

```sh
~/.local/bin/mkcert -uninstall
```
