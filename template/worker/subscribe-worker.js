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
  if (response.status === 409) return { ok: false, error: "Already subscribed." };

  const body = await response.text();
  return { ok: false, error: `Subscribe failed: ${response.status}` };
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
    const body = await response.json();
    if (body.title === "Member Exists") return { ok: false, error: "Already subscribed." };
  }

  return { ok: false, error: `Subscribe failed: ${response.status}` };
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

    const contentType = request.headers.get("Content-Type") || "";
    let email;

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

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ error: "A valid email address is required." }),
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
      result = { ok: false, error: `Unknown platform: ${platform}` };
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

    return new Response(JSON.stringify({ error: result.error }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  },
};
