/**
 * Cloudflare Worker — Newsletter subscribe proxy.
 *
 * Proxies email subscribe form submissions to the newsletter API
 * so the API key is never exposed client-side.
 *
 * Environment variables (set via wrangler secret):
 *   NEWSLETTER_API_KEY  — Buttondown or Mailchimp API key
 *   NEWSLETTER_PLATFORM — "buttondown" or "mailchimp"
 *   SITE_DOMAIN         — For CORS origin validation
 */

const RATE_LIMIT_SECONDS = 30;
const recentSubmissions = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const last = recentSubmissions.get(ip);
  if (last && now - last < RATE_LIMIT_SECONDS * 1000) {
    return true;
  }
  recentSubmissions.set(ip, now);
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

async function subscribeButtondown(email, apiKey) {
  const response = await fetch(
    "https://api.buttondown.email/v1/subscribers",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, type: "regular" }),
    },
  );

  if (response.status === 201) return { ok: true };
  if (response.status === 409) return { ok: false, errors: ["Already subscribed."] };

  return { ok: false, errors: ["Subscribe failed. Please try again later."] };
}

async function subscribeMailchimp(email, apiKey, listId) {
  // Mailchimp API key format: key-dc (e.g., abc123-us21)
  const dc = apiKey.split("-").pop();
  const response = await fetch(
    `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: email,
        status: "pending", // double opt-in
      }),
    },
  );

  if (response.ok) return { ok: true };
  if (response.status === 400) {
    try {
      const body = await response.json();
      if (body.title === "Member Exists") return { ok: false, errors: ["Already subscribed."] };
    } catch {
      // Ignore JSON parse errors from Mailchimp
    }
  }

  return { ok: false, errors: ["Subscribe failed. Please try again later."] };
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
      return new Response("Too many requests. Please wait a moment.", {
        status: 429,
        headers: corsHeaders(origin),
      });
    }

    const contentType = request.headers.get("Content-Type") || "";
    let email;

    try {
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await request.formData();
        email = formData.get("email");
      } else if (contentType.includes("application/json")) {
        const body = await request.json();
        email = body.email;
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

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ errors: ["A valid email address is required."] }),
        {
          status: 400,
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
        },
      );
    }

    const platform = (env.NEWSLETTER_PLATFORM || "buttondown").toLowerCase();
    let result;

    if (platform === "buttondown") {
      result = await subscribeButtondown(email, env.NEWSLETTER_API_KEY);
    } else if (platform === "mailchimp") {
      result = await subscribeMailchimp(
        email,
        env.NEWSLETTER_API_KEY,
        env.MAILCHIMP_LIST_ID,
      );
    } else {
      result = { ok: false, errors: ["Newsletter service not configured."] };
    }

    if (result.ok) {
      // For form submissions, redirect to thank you
      if (contentType.includes("application/x-www-form-urlencoded") && origin) {
        return Response.redirect(`${origin}/subscribe/thanks`, 303);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ errors: result.errors }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  },
};
