/**
 * Server-rendered HTML for the passkey IndieAuth owner-auth flow (no build step,
 * no framework). Two pages:
 *
 *   - renderConsentPage: shown by approveAuthorization when the owner must sign
 *     in (passkey or backup code) and approve a client's authorization request.
 *   - renderRegisterPage: the owner-only passkey enrolment page.
 *
 * Client/scope values come from the (attacker-controlled) query string, so every
 * interpolated value is HTML-escaped.
 */

// Serialize a value for safe interpolation into an inline <script>. JSON.stringify
// alone does NOT escape `</script>` (or the U+2028/U+2029 line separators that
// break JS string literals), so a `</script>` in attacker-controlled input would
// terminate the element. Escaping `<`,`>`,`&` to \uXXXX keeps it inert.
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

const SHELL = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<meta name="robots" content="noindex">` +
  `<title>${escapeHtml(title)}</title>` +
  `<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}` +
  `button{font:inherit;padding:.6rem 1rem;cursor:pointer}details{margin-top:1.5rem}` +
  `.client{font-weight:600}.scopes{font-family:ui-monospace,monospace}</style></head>` +
  `<body>${body}</body></html>`;

/**
 * @param request  the inbound /auth request (its query string carries the
 *                 authorization params we echo back to /auth/consent).
 * @param authenticated  true when a valid owner session already exists (skip the
 *                 passkey step; just show Approve/Deny).
 */
export function renderConsentPage({ request, authenticated = false }) {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  const clientId = url.searchParams.get("client_id") ?? "";
  const scope = url.searchParams.get("scope") ?? "";

  const signIn = authenticated
    ? ""
    : `<p>Sign in as the site owner to continue.</p>
       <button id="passkey-signin" type="button">Sign in with a passkey</button>
       <details><summary>Use a backup code instead</summary>
         <form id="backup-form" method="POST" action="/auth/consent">
           <input type="hidden" name="query" value="${escapeHtml(query)}">
           <label>Backup code <input name="backupCode" autocomplete="one-time-code" required></label>
           <button type="submit">Use code</button>
         </form>
       </details>`;

  const approve = authenticated
    ? `<form method="POST" action="/auth/consent">
         <input type="hidden" name="query" value="${escapeHtml(query)}">
         <input type="hidden" name="approve" value="1">
         <button type="submit">Approve</button>
       </form>`
    : "";

  const body =
    `<h1>Authorize sign-in</h1>` +
    `<p><span class="client">${escapeHtml(clientId || "An application")}</span> wants to sign in as you` +
    (scope ? ` and request <span class="scopes">${escapeHtml(scope)}</span>` : "") +
    `.</p>` +
    signIn +
    approve +
    `<script type="module">
      const QUERY = ${jsonForScript(query)};
      const btn = document.getElementById("passkey-signin");
      function b64urlToBytes(s){s=s.replace(/-/g,"+").replace(/_/g,"/");const p=s.length%4?"=".repeat(4-s.length%4):"";const b=atob(s+p);return Uint8Array.from(b,c=>c.charCodeAt(0));}
      function bytesToB64url(buf){let s=btoa(String.fromCharCode(...new Uint8Array(buf)));return s.replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");}
      btn && btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const optRes = await fetch("/auth/webauthn/authenticate/options", { method: "POST" });
          const opts = await optRes.json();
          const pk = opts.publicKey ?? opts;
          pk.challenge = b64urlToBytes(pk.challenge);
          (pk.allowCredentials||[]).forEach(c => c.id = b64urlToBytes(c.id));
          const cred = await navigator.credentials.get({ publicKey: pk });
          const assertion = {
            id: cred.id,
            rawId: bytesToB64url(cred.rawId),
            type: cred.type,
            response: {
              clientDataJSON: bytesToB64url(cred.response.clientDataJSON),
              authenticatorData: bytesToB64url(cred.response.authenticatorData),
              signature: bytesToB64url(cred.response.signature),
              userHandle: cred.response.userHandle ? bytesToB64url(cred.response.userHandle) : null,
            },
          };
          const res = await fetch("/auth/consent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ assertion, query: QUERY }),
          });
          if (res.redirected) { location.href = res.url; }
          else { btn.disabled = false; alert("Sign-in failed."); }
        } catch (e) { btn.disabled = false; alert("Sign-in failed."); }
      });
    </script>`;

  return SHELL("Authorize sign-in", body);
}

/**
 * Owner-only passkey enrolment page. `token` (when present) is the one-time
 * registration token threaded into the ceremony fetches so the worker gate
 * accepts an otherwise-unauthenticated enrolment.
 */
export function renderRegisterPage({ token = "" } = {}) {
  const body =
    `<h1>Register a passkey</h1>` +
    `<p>Add a passkey for your phone or laptop. Register at least two so a lost ` +
    `device doesn't lock you out.</p>` +
    `<button id="passkey-register" type="button">Register a passkey</button>` +
    `<script type="module">
      const TOKEN = ${jsonForScript(token)};
      const qs = TOKEN ? ("?token=" + encodeURIComponent(TOKEN)) : "";
      function b64urlToBytes(s){s=s.replace(/-/g,"+").replace(/_/g,"/");const p=s.length%4?"=".repeat(4-s.length%4):"";const b=atob(s+p);return Uint8Array.from(b,c=>c.charCodeAt(0));}
      function bytesToB64url(buf){let s=btoa(String.fromCharCode(...new Uint8Array(buf)));return s.replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");}
      const btn = document.getElementById("passkey-register");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const optRes = await fetch("/auth/webauthn/register/options" + qs, { method: "POST" });
          const opts = await optRes.json();
          const pk = opts.publicKey ?? opts;
          pk.challenge = b64urlToBytes(pk.challenge);
          pk.user.id = b64urlToBytes(pk.user.id);
          (pk.excludeCredentials||[]).forEach(c => c.id = b64urlToBytes(c.id));
          const cred = await navigator.credentials.create({ publicKey: pk });
          const attestation = {
            id: cred.id,
            rawId: bytesToB64url(cred.rawId),
            type: cred.type,
            response: {
              clientDataJSON: bytesToB64url(cred.response.clientDataJSON),
              attestationObject: bytesToB64url(cred.response.attestationObject),
            },
          };
          const res = await fetch("/auth/webauthn/register/verify" + qs, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(attestation),
          });
          alert(res.ok ? "Passkey registered." : "Registration failed.");
          btn.disabled = false;
        } catch (e) { btn.disabled = false; alert("Registration failed."); }
      });
    </script>`;

  return SHELL("Register a passkey", body);
}
