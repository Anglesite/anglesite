// ---------------------------------------------------------------------------
// Booking widget helpers — URL builders, embed generators, Schema.org, CSP
// ---------------------------------------------------------------------------

export type BookingProvider = "cal" | "calendly";
export type BookingStyle = "inline" | "floating" | "button";

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

/**
 * Build a Cal.com booking URL.
 * @param username - Cal.com username or slug
 * @param eventSlug - Optional event type slug (omit for profile page)
 * @returns Full Cal.com URL
 */
export function buildCalUrl(username: string, eventSlug?: string): string {
  const user = username.trim();
  const base = `https://cal.com/${user}`;
  return eventSlug ? `${base}/${eventSlug.trim()}` : base;
}

/**
 * Build a Calendly booking URL.
 * @param username - Calendly username or slug
 * @param eventSlug - Optional event type slug (omit for profile page)
 * @param brandColor - Optional hex color (with or without #) for primary_color param
 * @returns Full Calendly URL with optional color param
 */
export function buildCalendlyUrl(
  username: string,
  eventSlug?: string,
  brandColor?: string,
): string {
  const user = username.trim();
  const base = eventSlug
    ? `https://calendly.com/${user}/${eventSlug.trim()}`
    : `https://calendly.com/${user}`;
  if (brandColor) {
    const hex = brandColor.replace(/^#/, "");
    return `${base}?primary_color=${hex}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Schema.org ReserveAction
// ---------------------------------------------------------------------------

/** A Schema.org ReserveAction for structured data */
export interface ReserveAction {
  "@type": "ReserveAction";
  target: {
    "@type": "EntryPoint";
    urlTemplate: string;
    inLanguage: string;
    actionPlatform: string[];
  };
  result: {
    "@type": "Reservation";
    name: string;
  };
}

/**
 * Build Schema.org ReserveAction entries for booking event types.
 * @param provider - "cal" or "calendly"
 * @param username - Provider username/slug
 * @param eventSlugs - Event type slugs (empty array = profile page)
 * @returns Array of ReserveAction objects for JSON-LD injection
 */
export function buildReserveAction(
  provider: BookingProvider,
  username: string,
  eventSlugs: string[],
): ReserveAction[] {
  const buildUrl = provider === "cal" ? buildCalUrl : buildCalendlyUrl;
  const slugs = eventSlugs.length > 0 ? eventSlugs : [undefined];

  return slugs.map((slug) => ({
    "@type": "ReserveAction" as const,
    target: {
      "@type": "EntryPoint" as const,
      urlTemplate: buildUrl(username, slug),
      inLanguage: "en-US",
      actionPlatform: [
        "https://schema.org/DesktopWebPlatform",
        "https://schema.org/MobileWebPlatform",
      ],
    },
    result: {
      "@type": "Reservation" as const,
      name: "Appointment",
    },
  }));
}

// ---------------------------------------------------------------------------
// Brand color extraction
// ---------------------------------------------------------------------------

/**
 * Extract the --color-primary CSS custom property value from a CSS string.
 * @param css - CSS file contents
 * @param fallback - Fallback hex color if not found (default: "#000000")
 * @returns Hex color string
 */
export function extractBrandColor(css: string, fallback = "#000000"): string {
  const match = css.match(/--color-primary:\s*([^;]+)/);
  return match ? match[1].trim() : fallback;
}

// ---------------------------------------------------------------------------
// Embed snippet generators
// ---------------------------------------------------------------------------

/** Escape a string for safe inclusion in a JavaScript string literal */
function escapeJS(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/</g, "\\x3c")
    .replace(/>/g, "\\x3e")
    .replace(/\n/g, "\\n");
}

const CAL_LOADER = `(function(C,A,L){let p=function(a,ar){a.q.push(ar)};let d=C.document;C.Cal=C.Cal||function(){let cal=C.Cal;let ar=arguments;if(!cal.loaded){cal.ns={};cal.q=cal.q||[];d.head.appendChild(d.createElement("script")).src=A;cal.loaded=true}if(ar[0]===L){const api=function(){p(api,arguments)};const namespace=ar[1];api.q=api.q||[];typeof namespace==="string"?(cal.ns[namespace]=api)&&p(api,ar):p(cal,ar);return}p(cal,ar)}})(window,"https://app.cal.com/embed/embed.js","init");Cal("init",{origin:"https://cal.com"});`;

/**
 * Generate Cal.com embed HTML for a given style.
 * @param username - Cal.com username
 * @param eventSlug - Optional event slug
 * @param style - "inline" | "floating" | "button"
 * @param brandColor - Hex color for theming
 * @param buttonText - Button label (default: "Book Now")
 * @returns HTML string to embed in an Astro component
 */
export function buildCalEmbed(
  username: string,
  eventSlug: string | undefined,
  style: BookingStyle,
  brandColor: string,
  buttonText = "Book Now",
): string {
  const calLink = escapeJS(eventSlug ? `${username.trim()}/${eventSlug.trim()}` : username.trim());
  const color = escapeJS(brandColor.replace(/^#/, ""));
  const safeButtonText = escapeJS(buttonText);

  if (style === "inline") {
    return `<div id="booking-cal"></div>\n<script is:inline>\n${CAL_LOADER}\nCal("inline",{elementOrSelector:"#booking-cal",calLink:"${calLink}",config:{theme:"auto",brandColor:"${color}"}});\n</script>`;
  }

  if (style === "floating") {
    return `<script is:inline>\n${CAL_LOADER}\nCal("floatingButton",{calLink:"${calLink}",buttonText:"${safeButtonText}",config:{theme:"auto",brandColor:"${color}"}});\n</script>`;
  }

  // button → popup
  return `<button class="booking-button" data-cal-link="${calLink}">${safeButtonText}</button>\n<script is:inline>\n${CAL_LOADER}\nCal("pop",{calLink:"${calLink}",config:{theme:"auto",brandColor:"${color}"}});\n</script>`;
}

/**
 * Generate Calendly embed HTML for a given style.
 * @param username - Calendly username
 * @param eventSlug - Optional event slug
 * @param style - "inline" | "floating" | "button"
 * @param brandColor - Hex color for theming
 * @param buttonText - Button label (default: "Book Now")
 * @returns HTML string to embed in an Astro component
 */
export function buildCalendlyEmbed(
  username: string,
  eventSlug: string | undefined,
  style: BookingStyle,
  brandColor: string,
  buttonText = "Book Now",
): string {
  const url = escapeJS(buildCalendlyUrl(username, eventSlug, brandColor));
  const color = escapeJS(brandColor.replace(/^#/, ""));
  const safeButtonText = escapeJS(buttonText);

  const cssLink = `<link href="https://assets.calendly.com/assets/external/widget.css" rel="stylesheet">`;
  const jsScript = `<script src="https://assets.calendly.com/assets/external/widget.js" async></script>`;

  if (style === "inline") {
    return `${cssLink}\n<div class="calendly-inline-widget" data-url="${url}" style="min-width:320px;height:700px;"></div>\n${jsScript}`;
  }

  if (style === "floating") {
    return `${cssLink}\n<script is:inline>\nwindow.onload=function(){Calendly.initBadgeWidget({url:'${url}',text:'${safeButtonText}',color:'#${color}',textColor:'#ffffff'})};\n</script>\n${jsScript}`;
  }

  // button → popup
  return `${cssLink}\n<button class="booking-button" onclick="Calendly.initPopupWidget({url:'${url}'});return false;">${safeButtonText}</button>\n${jsScript}`;
}

// ---------------------------------------------------------------------------
// CSP directives
// ---------------------------------------------------------------------------

/** CSP directives needed for a booking provider */
export interface BookingCSP {
  "script-src": string[];
  "style-src": string[];
  "frame-src": string[];
}

/**
 * Build CSP directives required for a booking provider.
 * @param provider - "cal" or "calendly"
 * @returns Object with arrays of domains to add to each CSP directive
 */
export function buildBookingCSP(provider: BookingProvider): BookingCSP {
  if (provider === "cal") {
    return {
      "script-src": ["app.cal.com"],
      "style-src": ["app.cal.com"],
      "frame-src": ["app.cal.com"],
    };
  }
  return {
    "script-src": ["assets.calendly.com"],
    "style-src": ["assets.calendly.com"],
    "frame-src": ["calendly.com"],
  };
}
