/**
 * Cloudflare Worker — Contact form handler.
 *
 * Validates input, verifies Turnstile, rate-limits by IP,
 * and forwards the message via MailChannels. No data is stored.
 *
 * Environment variables (set via wrangler secret):
 *   TURNSTILE_SECRET_KEY — Turnstile secret key
 *   CONTACT_EMAIL        — Destination email address
 *   SITE_DOMAIN          — The site domain (used as From address domain)
 */

const RATE_LIMIT_SECONDS = 60;
const recentSubmissions = new Map();

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

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function verifyTurnstile(token, secret, ip) {
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders(origin),
      });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    if (isRateLimited(ip)) {
      return new Response("Too many requests. Please wait a minute.", {
        status: 429,
        headers: corsHeaders(origin),
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
          headers: corsHeaders(origin),
        });
      }
    } catch {
      return new Response(
        JSON.stringify({ errors: ["Invalid request body."] }),
        {
          status: 400,
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
        },
      );
    }

    // Validate input
    const errors = validateInput(name, email, message);
    if (errors.length > 0) {
      return new Response(JSON.stringify({ errors }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Verify Turnstile
    if (!turnstileToken) {
      return new Response(
        JSON.stringify({ errors: ["Please complete the verification."] }),
        {
          status: 400,
          headers: {
            ...corsHeaders(origin),
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
            ...corsHeaders(origin),
            "Content-Type": "application/json",
          },
        },
      );
    }

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
            ...corsHeaders(origin),
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
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  },
};
