/**
 * Cloudflare Worker — Custom forms handler.
 *
 * Generalizes the contact-form pattern to any number of user-defined
 * forms (RSVP, lead capture, survey, callback). The form catalog is
 * shipped alongside the Worker as `forms.json`, keyed by slug. Each
 * submission is matched to its form definition; server-side validation
 * mirrors the client-side rules. Verified submissions are forwarded to
 * the form's `destinationEmail` via MailChannels. No data is stored.
 *
 * Submission payloads accept either `application/x-www-form-urlencoded`
 * or `application/json`. The form slug must be supplied either in the
 * URL path (`POST /<slug>`), as a `formSlug` field, or as the path's
 * final segment.
 *
 * Environment variables (set via wrangler secret):
 *   TURNSTILE_SECRET_KEY — Turnstile secret key
 *   SITE_DOMAIN          — The site domain (used as From address domain)
 */

import formsCatalog from "./forms.json";

const recentSubmissions = new Map();

function rateLimitKey(slug, ip) {
  return `${slug}:${ip}`;
}

function isRateLimited(slug, ip, seconds) {
  const now = Date.now();
  const key = rateLimitKey(slug, ip);
  const last = recentSubmissions.get(key);
  if (last && now - last < seconds * 1000) return true;
  recentSubmissions.set(key, now);
  for (const [k, time] of recentSubmissions) {
    if (now - time > seconds * 2000) recentSubmissions.delete(k);
  }
  return false;
}

function isAllowedOrigin(origin, siteDomain) {
  if (!origin || !siteDomain) return false;
  return (
    origin === `https://${siteDomain}` ||
    origin === `https://www.${siteDomain}`
  );
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asString(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function validateField(field, raw) {
  const errors = [];
  const isEmpty =
    raw == null ||
    (typeof raw === "string" && raw.trim() === "") ||
    (Array.isArray(raw) && raw.length === 0);

  if (field.required && isEmpty) {
    errors.push(`${field.label} is required.`);
    return errors;
  }
  if (isEmpty) return errors;

  const str = asString(raw);
  const num = Number(str);

  switch (field.type) {
    case "email":
      if (!EMAIL_RE.test(str)) errors.push(`${field.label} must be a valid email.`);
      break;
    case "tel":
      if (field.pattern && !new RegExp(field.pattern).test(str))
        errors.push(`${field.label} format is invalid.`);
      break;
    case "text":
    case "textarea":
      if (field.minLength != null && str.length < field.minLength)
        errors.push(`${field.label} must be at least ${field.minLength} characters.`);
      if (field.maxLength != null && str.length > field.maxLength)
        errors.push(`${field.label} must be under ${field.maxLength} characters.`);
      else if (field.type === "textarea" && str.length > 5000)
        errors.push(`${field.label} must be under 5000 characters.`);
      if (field.pattern && !new RegExp(field.pattern).test(str))
        errors.push(`${field.label} format is invalid.`);
      break;
    case "number":
    case "scale": {
      if (Number.isNaN(num)) {
        errors.push(`${field.label} must be a number.`);
        break;
      }
      if (field.min != null && num < field.min)
        errors.push(`${field.label} must be at least ${field.min}.`);
      if (field.max != null && num > field.max)
        errors.push(`${field.label} must be at most ${field.max}.`);
      break;
    }
    case "select":
    case "radio":
      if (Array.isArray(field.options) && field.options.length > 0 && !field.options.includes(str))
        errors.push(`${field.label} must be one of the listed options.`);
      break;
    case "checkbox": {
      const values = Array.isArray(raw) ? raw : [raw];
      if (Array.isArray(field.options) && field.options.length > 0) {
        for (const v of values) {
          if (!field.options.includes(asString(v)))
            errors.push(`${field.label} contains an unsupported option.`);
        }
      }
      break;
    }
    case "date":
      if (Number.isNaN(Date.parse(str)))
        errors.push(`${field.label} must be a valid date.`);
      break;
    case "hidden":
      // Pass-through; trim length defensively.
      if (str.length > 500) errors.push(`${field.label} is too long.`);
      break;
  }

  return errors;
}

function sanitize(value) {
  return asString(value).replace(/[\r\n\0]/g, " ").trim();
}

function formatBody(form, values) {
  const lines = [`Form: ${form.title} (${form.slug})`, ""];
  for (const field of form.fields) {
    const raw = values[field.name];
    if (raw == null || (typeof raw === "string" && raw.trim() === "")) continue;
    lines.push(`${field.label}: ${asString(raw)}`);
  }
  return lines.join("\n");
}

async function sendEmail(env, form, values) {
  const replyEmail = Object.values(values).find(
    (v) => typeof v === "string" && EMAIL_RE.test(v.trim()),
  );
  const personalizations = [
    { to: [{ email: form.destinationEmail, name: "Site Owner" }] },
  ];
  const payload = {
    personalizations,
    from: {
      email: `forms@${env.SITE_DOMAIN}`,
      name: `${sanitize(form.title)} (forms)`,
    },
    subject: `Form submission: ${sanitize(form.title)}`,
    content: [{ type: "text/plain", value: formatBody(form, values) }],
  };
  if (replyEmail) {
    payload.reply_to = { email: replyEmail.trim() };
  }
  const response = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.ok;
}

function jsonError(errors, status, origin, siteDomain) {
  return new Response(JSON.stringify({ errors }), {
    status,
    headers: {
      ...corsHeaders(origin, siteDomain),
      "Content-Type": "application/json",
    },
  });
}

function readSlug(url, body) {
  const path = url.pathname.replace(/\/+$/, "");
  const last = path.split("/").filter(Boolean).pop();
  if (last && formsCatalog[last]) return last;
  if (body && typeof body.formSlug === "string" && formsCatalog[body.formSlug])
    return body.formSlug;
  return null;
}

function collectValues(form, source) {
  const values = {};
  for (const field of form.fields) {
    if (field.type === "checkbox") {
      const all =
        typeof source.getAll === "function"
          ? source.getAll(field.name)
          : Array.isArray(source[field.name])
            ? source[field.name]
            : source[field.name] != null
              ? [source[field.name]]
              : [];
      values[field.name] = all.map(asString);
    } else {
      const v =
        typeof source.get === "function" ? source.get(field.name) : source[field.name];
      values[field.name] = v == null ? "" : asString(v);
    }
  }
  return values;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const siteDomain = env.SITE_DOMAIN;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, siteDomain),
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders(origin, siteDomain),
      });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const contentType = request.headers.get("Content-Type") || "";

    let formSlug = null;
    let valuesSource = null;
    let turnstileToken = null;

    try {
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await request.formData();
        formSlug = readSlug(url, { formSlug: formData.get("formSlug") });
        if (!formSlug) {
          return jsonError(["Unknown form."], 404, origin, siteDomain);
        }
        valuesSource = formData;
        turnstileToken = formData.get("cf-turnstile-response");
      } else if (contentType.includes("application/json")) {
        const body = await request.json();
        formSlug = readSlug(url, body);
        if (!formSlug) {
          return jsonError(["Unknown form."], 404, origin, siteDomain);
        }
        valuesSource = body;
        turnstileToken = body["cf-turnstile-response"];
      } else {
        return new Response("Unsupported content type", {
          status: 415,
          headers: corsHeaders(origin, siteDomain),
        });
      }
    } catch {
      return jsonError(["Invalid request body."], 400, origin, siteDomain);
    }

    const form = formsCatalog[formSlug];
    if (!form) {
      return jsonError(["Unknown form."], 404, origin, siteDomain);
    }

    const rateLimit = Number.isFinite(form.rateLimitSeconds)
      ? form.rateLimitSeconds
      : 60;
    if (isRateLimited(formSlug, ip, rateLimit)) {
      return new Response("Too many requests. Please wait a minute.", {
        status: 429,
        headers: corsHeaders(origin, siteDomain),
      });
    }

    const values = collectValues(form, valuesSource);

    const errors = [];
    for (const field of form.fields) {
      errors.push(...validateField(field, values[field.name]));
    }
    if (errors.length > 0) {
      return jsonError(errors, 400, origin, siteDomain);
    }

    if (!turnstileToken) {
      return jsonError(
        ["Please complete the verification."],
        400,
        origin,
        siteDomain,
      );
    }

    const turnstileValid = await verifyTurnstile(
      turnstileToken,
      env.TURNSTILE_SECRET_KEY,
      ip,
    );
    if (!turnstileValid) {
      return jsonError(
        ["Verification failed. Please try again."],
        403,
        origin,
        siteDomain,
      );
    }

    const sent = await sendEmail(env, form, values);
    if (!sent) {
      return jsonError(
        ["Failed to send. Please try again later."],
        500,
        origin,
        siteDomain,
      );
    }

    if (contentType.includes("application/x-www-form-urlencoded") && origin) {
      const target =
        form.redirectUrl && form.redirectUrl.length > 0
          ? form.redirectUrl
          : `${origin}/forms/${formSlug}/thanks`;
      return Response.redirect(target, 303);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        ...corsHeaders(origin, siteDomain),
        "Content-Type": "application/json",
      },
    });
  },
};
