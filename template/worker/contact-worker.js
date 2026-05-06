/**
 * Cloudflare Worker — Contact form handler.
 *
 * Validates input, verifies Turnstile, rate-limits by IP, persists the
 * submission to Workers KV (the `SUBMISSIONS` binding) so it can be
 * triaged from the Keystatic inbox, and forwards the message via
 * MailChannels. KV persistence is best-effort — if the binding is
 * absent (older deploys) the Worker still emails the owner.
 *
 * Environment variables (set via wrangler secret):
 *   TURNSTILE_SECRET_KEY — Turnstile secret key
 *   CONTACT_EMAIL        — Destination email address
 *   SITE_DOMAIN          — The site domain (used as From address domain)
 *   INBOX_SECRET         — Optional bearer token guarding GET /inbox
 *
 * KV bindings (set in wrangler.toml):
 *   SUBMISSIONS — namespace for persisted submissions, key prefix
 *                 `submission:contact:<id>`
 */

const RATE_LIMIT_SECONDS = 60;
const recentSubmissions = new Map();

const CONTACT_FORM_DEFINITION = {
  slug: "contact",
  title: "Contact",
  fields: [
    { name: "name", label: "Name", type: "text" },
    { name: "email", label: "Email", type: "email" },
    { name: "message", label: "Message", type: "textarea" },
  ],
};

function isRateLimited(ip) {
  const now = Date.now();
  const last = recentSubmissions.get(ip);
  if (last && now - last < RATE_LIMIT_SECONDS * 1000) {
    return true;
  }
  recentSubmissions.set(ip, now);
  // Clean old entries
  for (const [key, time] of recentSubmissions) {
    if (now - time > RATE_LIMIT_SECONDS * 2000) {
      recentSubmissions.delete(key);
    }
  }
  return false;
}

function isAllowedOrigin(origin, siteDomain) {
  if (!origin || !siteDomain) return false;
  const allowed = `https://${siteDomain}`;
  return origin === allowed || origin === `https://www.${siteDomain}`;
}

function corsHeaders(origin, siteDomain) {
  if (!isAllowedOrigin(origin, siteDomain)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function verifyTurnstile(token, secret, ip) {
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      },
    );
    const result = await response.json();
    return result.success === true;
  } catch (err) {
    console.error("Turnstile verification failed:", err);
    return false;
  }
}

function validateInput(name, email, message) {
  const errors = [];
  if (!name || name.trim().length === 0) errors.push("Name is required.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push("A valid email address is required.");
  if (!message || message.trim().length === 0)
    errors.push("Message is required.");
  if (message && message.length > 5000)
    errors.push("Message must be under 5000 characters.");
  return errors;
}

function sanitizeName(name) {
  return String(name).replace(/[\r\n\0]/g, "").trim();
}

async function sendEmail(env, name, email, message) {
  const safeName = sanitizeName(name);
  const response = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [
        { to: [{ email: env.CONTACT_EMAIL, name: "Site Owner" }] },
      ],
      from: {
        email: `contact@${env.SITE_DOMAIN}`,
        name: `${safeName} via contact form`,
      },
      reply_to: { email, name: safeName },
      subject: `Contact form: ${safeName}`,
      content: [
        {
          type: "text/plain",
          value: `Name: ${name}\nEmail: ${email}\n\n${message}`,
        },
      ],
    }),
  });
  return response.ok;
}

function newSubmissionId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}`;
}

function buildContactSubmission({ name, email, message, ip }) {
  return {
    id: newSubmissionId(),
    formSlug: CONTACT_FORM_DEFINITION.slug,
    formTitle: CONTACT_FORM_DEFINITION.title,
    submittedAt: new Date().toISOString(),
    status: "new",
    senderName: String(name || "").trim(),
    senderEmail: String(email || "").trim(),
    ip,
    entries: [
      { key: "name", label: "Name", type: "text", value: String(name || "") },
      { key: "email", label: "Email", type: "email", value: String(email || "") },
      { key: "message", label: "Message", type: "textarea", value: String(message || "") },
    ],
  };
}

async function persistSubmission(env, submission) {
  if (!env.SUBMISSIONS) return false;
  const key = `submission:${submission.formSlug}:${submission.id}`;
  try {
    await env.SUBMISSIONS.put(key, JSON.stringify(submission), {
      metadata: {
        formSlug: submission.formSlug,
        submittedAt: submission.submittedAt,
        status: submission.status,
      },
    });
    return true;
  } catch (err) {
    console.error("KV persist failed:", err);
    return false;
  }
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function handleInboxList(request, env) {
  if (!env.SUBMISSIONS) {
    return new Response(
      JSON.stringify({ error: "Inbox not configured (no KV binding)." }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    );
  }
  const expected = env.INBOX_SECRET;
  if (!expected) {
    return new Response(
      JSON.stringify({ error: "INBOX_SECRET not set on the Worker." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!timingSafeEqual(bearerToken(request), expected)) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const items = [];
  let cursor;
  do {
    const page = await env.SUBMISSIONS.list({
      prefix: `submission:${CONTACT_FORM_DEFINITION.slug}:`,
      cursor,
    });
    for (const k of page.keys) {
      const raw = await env.SUBMISSIONS.get(k.name);
      if (raw) {
        try {
          items.push(JSON.parse(raw));
        } catch {
          // skip corrupt entry
        }
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  items.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "GET" && url.pathname === "/inbox") {
      return handleInboxList(request, env);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env.SITE_DOMAIN) });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders(origin, env.SITE_DOMAIN),
      });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    if (isRateLimited(ip)) {
      return new Response("Too many requests. Please wait a minute.", {
        status: 429,
        headers: corsHeaders(origin, env.SITE_DOMAIN),
      });
    }

    const contentType = request.headers.get("Content-Type") || "";
    let name, email, message, turnstileToken;

    try {
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await request.formData();
        name = formData.get("name");
        email = formData.get("email");
        message = formData.get("message");
        turnstileToken = formData.get("cf-turnstile-response");
      } else if (contentType.includes("application/json")) {
        const body = await request.json();
        name = body.name;
        email = body.email;
        message = body.message;
        turnstileToken = body["cf-turnstile-response"];
      } else {
        return new Response("Unsupported content type", {
          status: 415,
          headers: corsHeaders(origin, env.SITE_DOMAIN),
        });
      }
    } catch {
      return new Response(
        JSON.stringify({ errors: ["Invalid request body."] }),
        {
          status: 400,
          headers: { ...corsHeaders(origin, env.SITE_DOMAIN), "Content-Type": "application/json" },
        },
      );
    }

    // Validate input
    const errors = validateInput(name, email, message);
    if (errors.length > 0) {
      return new Response(JSON.stringify({ errors }), {
        status: 400,
        headers: { ...corsHeaders(origin, env.SITE_DOMAIN), "Content-Type": "application/json" },
      });
    }

    // Verify Turnstile
    if (!turnstileToken) {
      return new Response(
        JSON.stringify({ errors: ["Please complete the verification."] }),
        {
          status: 400,
          headers: {
            ...corsHeaders(origin, env.SITE_DOMAIN),
            "Content-Type": "application/json",
          },
        },
      );
    }

    const turnstileValid = await verifyTurnstile(
      turnstileToken,
      env.TURNSTILE_SECRET_KEY,
      ip,
    );
    if (!turnstileValid) {
      return new Response(
        JSON.stringify({ errors: ["Verification failed. Please try again."] }),
        {
          status: 403,
          headers: {
            ...corsHeaders(origin, env.SITE_DOMAIN),
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Persist before sending so MailChannels failure doesn't lose the message.
    const submission = buildContactSubmission({ name, email, message, ip });
    await persistSubmission(env, submission);

    // Send email
    const sent = await sendEmail(env, name, email, message);

    if (!sent) {
      return new Response(
        JSON.stringify({
          errors: ["Failed to send message. Please try again later."],
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders(origin, env.SITE_DOMAIN),
            "Content-Type": "application/json",
          },
        },
      );
    }

    // For form submissions, redirect to thank you page
    if (contentType.includes("application/x-www-form-urlencoded") && origin) {
      return Response.redirect(`${origin}/contact/thanks`, 303);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders(origin, env.SITE_DOMAIN), "Content-Type": "application/json" },
    });
  },
};

export {
  buildContactSubmission,
  newSubmissionId,
  timingSafeEqual,
  handleInboxList,
  persistSubmission,
  CONTACT_FORM_DEFINITION,
};
