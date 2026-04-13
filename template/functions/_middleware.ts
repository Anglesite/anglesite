/**
 * Cloudflare Pages Function — A/B test variant assignment middleware.
 *
 * Intercepts requests for pages under active experiment, assigns a variant
 * at the edge via cookie, and serves the pre-rendered variant HTML.
 * Zero layout flicker — variant selection happens before any HTML reaches
 * the browser.
 *
 * Environment bindings:
 *   EXPERIMENTS (KV)         — Active experiment config
 *   ANALYTICS   (Analytics Engine) — Event stream for impressions
 *
 * The middleware reads experiment config from KV on each request.
 * Variant assignment is persisted in a first-party cookie (no PII,
 * session-scoped, GDPR/CCPA-safe without consent banner).
 */

import type { Experiment } from "../scripts/experiments";
import {
  assignVariant,
  parseVariantCookie,
  serializeVariantCookie,
  resolveVariantPath,
} from "../scripts/experiments";
import { buildImpressionDataPoint } from "../scripts/ab-analytics";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  EXPERIMENTS: KVNamespace;
  ANALYTICS?: AnalyticsEngineDataset;
}

interface PagesContext {
  request: Request;
  next: () => Promise<Response>;
  env: Env;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // Only intercept HTML page requests (not assets, API calls, etc.)
  const accept = request.headers.get("Accept") ?? "";
  if (!accept.includes("text/html")) return next();

  // Load active experiments from KV
  const configJson = await env.EXPERIMENTS.get("active-experiments");
  if (!configJson) return next();

  let experiments: Experiment[];
  try {
    experiments = JSON.parse(configJson);
  } catch {
    return next();
  }

  // Find an active experiment for this path
  const normalized = url.pathname.replace(/\/+$/, "") || "/";
  const experiment = experiments.find(
    (exp) => exp.active && exp.page === normalized,
  );
  if (!experiment) return next();

  // Check for existing assignment cookie, validate against known variants
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const existingVariant = parseVariantCookie(cookieHeader, experiment.id);
  const validVariant =
    existingVariant && experiment.variants.includes(existingVariant)
      ? existingVariant
      : null;
  const variant = validVariant ?? assignVariant(experiment.variants, experiment.weights);

  // Resolve the variant file path
  const variantPath = resolveVariantPath(url.pathname, variant);
  const variantUrl = new URL(variantPath, url.origin);
  const variantRequest = new Request(variantUrl.toString(), request);

  // Fetch the variant HTML from static assets
  const response = await env.ASSETS.fetch(variantRequest);
  const newResponse = new Response(response.body, response);

  // Set the variant cookie if this is a new assignment
  if (!existingVariant) {
    newResponse.headers.append(
      "Set-Cookie",
      serializeVariantCookie(experiment.id, variant),
    );
  }

  // Prevent cache contamination between variants
  newResponse.headers.set("Cache-Control", "no-store");

  // Log impression to Analytics Engine (non-blocking)
  if (env.ANALYTICS) {
    const sessionId = hashSession(request);
    const dataPoint = buildImpressionDataPoint(experiment.id, variant, sessionId);
    try {
      env.ANALYTICS.writeDataPoint(dataPoint);
    } catch {
      // Non-blocking — don't fail the request if analytics write fails
    }
  }

  return newResponse;
}

/**
 * Derive a session identifier from the request without storing PII.
 * Uses IP + User-Agent + date to create a daily session hash.
 */
function hashSession(request: Request): string {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ua = request.headers.get("User-Agent") ?? "unknown";
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // Simple hash — good enough for session grouping, not crypto
  let hash = 0;
  const str = `${ip}:${ua}:${date}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
