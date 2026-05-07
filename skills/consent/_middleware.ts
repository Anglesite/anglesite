// Cloudflare Pages middleware. Copied to <site>/functions/_middleware.ts by
// `/anglesite:consent` when CONSENT_DEFAULT=geo.
//
// Injects a <meta name="cf-country" content="DE"> tag into every HTML response
// using the request's `cf.country` field. The consent banner runtime reads this
// tag on first paint and applies EU/UK default-deny when the country is in the
// regulated list. If the meta tag is missing (older browsers, edge errors, or
// non-Cloudflare hosts), the runtime falls back to default-deny everywhere.

interface PagesContext {
  request: Request;
  next: () => Promise<Response>;
}

class CountryInjector {
  constructor(private country: string) {}
  element(el: { append: (html: string, opts: { html: boolean }) => void }): void {
    el.append(`<meta name="cf-country" content="${this.country}">`, { html: true });
  }
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  // `request.cf` is provided by the Cloudflare runtime. Defensively handle its
  // absence (e.g. local `wrangler pages dev`, some preview environments).
  const cf = (context.request as Request & { cf?: { country?: string } }).cf;
  const rawCountry = cf?.country ?? "XX";
  const country = rawCountry.replace(/[^A-Z0-9]/gi, "").slice(0, 4).toUpperCase() || "XX";

  return new HTMLRewriter()
    .on("head", new CountryInjector(country))
    .transform(response);
};
