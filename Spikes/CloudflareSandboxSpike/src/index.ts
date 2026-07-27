// Throwaway spike (#61): drive the shared Anglesite dev-server image inside a
// Cloudflare Sandbox and measure the things the design doc needs real numbers for
// (cold start, HMR over the tunnel, in-container deploy, snapshots).
//
// NOT production code. The real consumer is RemoteSandboxSiteRuntime (#66); this
// Worker just proves the substrate end-to-end and feeds the findings doc
// (docs/specs/2026-06-10-cloudflare-sandbox-spike-notes.md).
//
// API per https://developers.cloudflare.com/sandbox/ (SDK 0.12.x):
//   getSandbox, proxyToSandbox, sandbox.exec/startProcess/exposePort/getProcessLogs/destroy

import { getSandbox, proxyToSandbox, Sandbox } from "@cloudflare/sandbox";

// Required: the Worker must re-export the Sandbox Durable Object class.
export { Sandbox };

interface Env {
  // Typed with the Sandbox class so getSandbox/proxyToSandbox accept it (the SDK's
  // helpers require DurableObjectNamespace<Sandbox>, not a bare namespace).
  Sandbox: DurableObjectNamespace<Sandbox>;
  DEFAULT_GIT_URL: string;
  DEFAULT_GIT_REF: string;
  SITE_DIR: string;
  DEV_PORT: string;
  // Shared secret gating every code-execution route. Set as a Worker secret:
  //   npx wrangler secret put SPIKE_SECRET
  // Unset → all privileged routes fail closed (503).
  SPIKE_SECRET?: string;
}

// One session for the spike. (#66 scopes the id to user+site.)
const SANDBOX_ID = "anglesite-spike";

// These routes run code / clone / deploy / tear down inside the container — every one
// is behind the bearer-secret gate. Only `/` (help) is public.
const PUBLIC_ROUTES = new Set(["/"]);

// Strict allowlists for user-supplied values that reach a shell. Anything with shell
// metacharacters (;, &, |, $, backtick, spaces, …) is rejected before interpolation.
const REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?$/;
const REF_RE = /^[A-Za-z0-9._\-/]+$/;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });

const now = () => Date.now();

/** Constant-time-ish string compare (length leak is acceptable for a spike secret). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Require `Authorization: Bearer <SPIKE_SECRET>` on privileged routes. */
function authorized(request: Request, env: Env): boolean {
  if (!env.SPIKE_SECRET) return false; // fail closed when no secret is configured
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && safeEqual(token, env.SPIKE_SECRET);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route requests to any exposed port FIRST (this is what serves the preview
    // when using exposePort() — including the HMR WebSocket upgrade).
    const proxied = await proxyToSandbox(request, env);
    if (proxied) return proxied;

    const url = new URL(request.url);

    // Auth gate: every route except `/` runs code in the container, so require the
    // bearer secret. A deployed Worker is public — without this it's an open RCE.
    if (!PUBLIC_ROUTES.has(url.pathname) && !authorized(request, env)) {
      return json(
        { error: env.SPIKE_SECRET ? "unauthorized" : "SPIKE_SECRET not configured (wrangler secret put SPIKE_SECRET)" },
        env.SPIKE_SECRET ? 401 : 503,
      );
    }

    const sandbox = getSandbox(env.Sandbox, SANDBOX_ID);
    const SITE_DIR = env.SITE_DIR || "/workspace";
    const PORT = env.DEV_PORT || "4321";

    try {
      switch (url.pathname) {
        case "/":
          return json({
            spike: "cloudflare-sandbox (#61)",
            routes: {
              "POST /start?repo=&ref=": "clone + hydrate + astro dev; returns phase timings + exposePort URL",
              "POST /tunnel": "start a cloudflared quick tunnel to the dev port; returns the *.trycloudflare.com URL",
              "POST /deploy": "run pre-deploy-check + `wrangler deploy` inside the container",
              "GET  /status": "list processes + exposed ports",
              "GET  /logs?id=": "accumulated logs for a process id (default: the dev server)",
              "POST /destroy": "tear the sandbox down",
            },
          });

        // ── Cold-start path: clone → hydrate → astro dev → ready → expose ──
        case "/start": {
          const repo = url.searchParams.get("repo") || env.DEFAULT_GIT_URL;
          const ref = url.searchParams.get("ref") || env.DEFAULT_GIT_REF;
          // Validate before these reach a shell (defense in depth alongside the auth gate).
          if (!REPO_RE.test(repo)) return json({ error: "invalid repo (must be https://github.com/owner/name[.git])" }, 400);
          if (!REF_RE.test(ref)) return json({ error: "invalid ref (alphanumerics, . _ - / only)" }, 400);
          const hostname = url.hostname; // for exposePort preview URL (needs custom domain)
          const t: Record<string, number> = {};
          const t0 = now();

          // 1. Clone the site (Git is the source of truth — design §3.1).
          //    The /sandbox entrypoint bypasses the image's entrypoint.sh hydrate,
          //    so we drive clone + hydrate explicitly (the #66 model).
          const clone = await sandbox.exec(
            `rm -rf ${SITE_DIR}/* ${SITE_DIR}/.[!.]* 2>/dev/null; git clone --branch ${ref} --depth 1 ${repo} ${SITE_DIR}`,
          );
          t.clone_ms = now() - t0;
          if (!clone.success) return json({ phase: "clone", ...clone, timings: t }, 500);

          // 2. Hydrate deps using the image's pre-baked toolchain (design #5b):
          //    hardlink baked node_modules if the lockfile matches, else npm ci warm.
          const tHydrate = now();
          const hydrate = await sandbox.exec(`hydrate.sh ${SITE_DIR}`, { cwd: SITE_DIR });
          t.hydrate_ms = now() - tHydrate;
          if (!hydrate.success) return json({ phase: "hydrate", ...hydrate, timings: t }, 500);

          // 3. Start astro dev in the background.
          const tDev = now();
          const proc = await sandbox.startProcess(`start-dev-server.sh`, {
            cwd: SITE_DIR,
            env: { SITE_DIR, PORT },
          });

          // 4. Poll readiness with an in-container HTTP probe (mirrors AstroDevServer).
          let ready = false;
          for (let i = 0; i < 60; i++) {
            const probe = await sandbox.exec(`curl -sf -o /dev/null http://localhost:${PORT}/`);
            if (probe.success) { ready = true; break; }
            await new Promise((r) => setTimeout(r, 500));
          }
          t.dev_ready_ms = now() - tDev;
          t.total_ms = now() - t0;
          if (!ready) {
            const logs = await sandbox.getProcessLogs(proc.id).catch(() => null);
            return json({ phase: "dev-ready-timeout", process: proc, logs, timings: t }, 504);
          }

          // 5. Expose the dev port → preview URL (needs a custom domain w/ wildcard
          //    DNS; on .workers.dev use POST /tunnel instead).
          let exposed: { url: string } | { error: string };
          try {
            exposed = await sandbox.exposePort(Number(PORT), { hostname, name: "astro" });
          } catch (e) {
            exposed = { error: `exposePort failed (expected on .workers.dev): ${String(e)}. Use POST /tunnel.` };
          }

          return json({ ok: true, repo, ref, process: proc, exposed, timings: t,
            hint: "Open the exposed URL (or POST /tunnel), edit a file in-container, and watch HMR." });
        }

        // ── Per-session quick tunnel (no wildcard DNS): *.trycloudflare.com ──
        case "/tunnel": {
          // cloudflared prints the tunnel URL to stderr; capture it from the logs.
          const proc = await sandbox.startProcess(
            `cloudflared tunnel --no-autoupdate --url http://localhost:${PORT}`,
          );
          let tunnelUrl: string | null = null;
          for (let i = 0; i < 30; i++) {
            const logs = await sandbox.getProcessLogs(proc.id).catch(() => null);
            const text = `${logs?.stdout ?? ""}\n${logs?.stderr ?? ""}`;
            const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (m) { tunnelUrl = m[0]; break; }
            await new Promise((r) => setTimeout(r, 1000));
          }
          return json({ process: proc, tunnelUrl,
            hint: tunnelUrl ? "Open it; HMR rides the tunnel WebSocket." : "No URL yet — GET /logs?id=" + proc.id });
        }

        // ── In-container deploy: the plugin security hook must run here too ──
        case "/deploy": {
          // pre-deploy-check is the plugin's security gate. The app invariant (CLAUDE.md)
          // is that a failure is ALWAYS surfaced and never bypassed — and #66 will copy
          // this shape — so it must hard-gate the deploy, not be swallowed by `|| true`.
          const check = await sandbox.exec(`npm run -s pre-deploy-check`, { cwd: SITE_DIR });
          if (!check.success) return json({ phase: "pre-deploy-check", ...check }, 422);
          const build = await sandbox.exec(`npm run -s build`, { cwd: SITE_DIR });
          const deploy = build.success
            ? await sandbox.exec(`npx --yes wrangler deploy`, {
                cwd: SITE_DIR,
                env: { CLOUDFLARE_API_TOKEN: request.headers.get("x-cf-token") || "" },
              })
            : { skipped: "build failed" };
          return json({ check, build, deploy });
        }

        case "/status": {
          const processes = await sandbox.listProcesses().catch((e) => ({ error: String(e) }));
          const ports = await sandbox.getExposedPorts(url.hostname).catch((e) => ({ error: String(e) }));
          return json({ processes, ports });
        }

        case "/logs": {
          const id = url.searchParams.get("id");
          if (!id) return json({ error: "pass ?id=<processId>" }, 400);
          return json(await sandbox.getProcessLogs(id));
        }

        case "/destroy":
          await sandbox.destroy();
          return json({ destroyed: true });

        default:
          return json({ error: "not found", try: "/" }, 404);
      }
    } catch (e) {
      console.error("Sandbox spike request failed", e);
      return json({ error: "internal server error" }, 500);
    }
  },
};
