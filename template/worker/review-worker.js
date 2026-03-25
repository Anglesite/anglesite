/**
 * Cloudflare Worker — Review/testimonial submission handler.
 *
 * Validates input, verifies Turnstile, rate-limits by IP,
 * and emails the review to the owner for moderation via MailChannels.
 * No data is stored — the owner adds approved reviews as Keystatic entries.
 *
 * Environment variables (set via wrangler secret):
 *   TURNSTILE_SECRET_KEY — Turnstile secret key
 *   CONTACT_EMAIL        — Owner's email for moderation
 *   SITE_DOMAIN          — Site domain (used as From address domain)
 */

const RATE_LIMIT_SECONDS = 300; // 5 minutes between submissions
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

function validateInput(name, rating, text) {
  const errors = [];
  if (!name || name.trim().length === 0) errors.push("Name is required.");
  if (rating === undefined || rating === null) {
    errors.push("Rating is required.");
  } else {
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      errors.push("Rating must be between 1 and 5.");
    }
  }
  if (!text || text.trim().length === 0) errors.push("Review text is required.");
  if (text && text.length > 2000) errors.push("Review must be under 2000 characters.");
  return errors;
}

async function emailReview(env, name, rating, text) {
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  const response = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [
        { to: [{ email: env.CONTACT_EMAIL, name: "Site Owner" }] },
      ],
      from: {
        email: `reviews@${env.SITE_DOMAIN}`,
        name: "Review submission",
      },
      subject: `New review: ${stars} from ${name}`,
      content: [
        {
          type: "text/plain",
          value: [
            `New review submission for moderation:`,
            ``,
            `Name: ${name}`,
            `Rating: ${stars} (${rating}/5)`,
            ``,
            `${text}`,
            ``,
            `---`,
            `To approve, add this as a testimonial in Keystatic.`,
          ].join("\n"),
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
      return new Response("Too many submissions. Please wait a few minutes.", {
        status: 429,
        headers: corsHeaders(origin),
      });
    }

    const contentType = request.headers.get("Content-Type") || "";
    let name, rating, text, turnstileToken;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      name = formData.get("name");
      rating = Number(formData.get("rating"));
      text = formData.get("text");
      turnstileToken = formData.get("cf-turnstile-response");
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      name = body.name;
      rating = Number(body.rating);
      text = body.text;
      turnstileToken = body["cf-turnstile-response"];
    } else {
      return new Response("Unsupported content type", {
        status: 415,
        headers: corsHeaders(origin),
      });
    }

    const errors = validateInput(name, rating, text);
    if (errors.length > 0) {
      return new Response(JSON.stringify({ errors }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    if (!turnstileToken) {
      return new Response(
        JSON.stringify({ errors: ["Please complete the verification."] }),
        {
          status: 400,
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
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
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
        },
      );
    }

    const sent = await emailReview(env, name, rating, text);

    if (!sent) {
      return new Response(
        JSON.stringify({ errors: ["Failed to submit review. Please try again later."] }),
        {
          status: 500,
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
        },
      );
    }

    if (contentType.includes("application/x-www-form-urlencoded") && origin) {
      return Response.redirect(`${origin}/review/thanks`, 303);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  },
};
