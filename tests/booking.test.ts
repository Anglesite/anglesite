import { describe, it, expect } from "vitest";
import {
  buildCalUrl,
  buildCalendlyUrl,
  buildReserveAction,
  extractBrandColor,
  buildCalEmbed,
  buildCalendlyEmbed,
  buildBookingCSP,
} from "../template/scripts/booking.js";

// ---------------------------------------------------------------------------
// buildCalUrl
// ---------------------------------------------------------------------------

describe("buildCalUrl", () => {
  it("builds a profile URL with username only", () => {
    expect(buildCalUrl("janedoe")).toBe("https://cal.com/janedoe");
  });

  it("builds an event URL with username and event slug", () => {
    expect(buildCalUrl("janedoe", "30min")).toBe(
      "https://cal.com/janedoe/30min",
    );
  });

  it("trims whitespace from username", () => {
    expect(buildCalUrl(" janedoe ")).toBe("https://cal.com/janedoe");
  });

  it("trims whitespace from event slug", () => {
    expect(buildCalUrl("janedoe", " consultation ")).toBe(
      "https://cal.com/janedoe/consultation",
    );
  });
});

// ---------------------------------------------------------------------------
// buildCalendlyUrl
// ---------------------------------------------------------------------------

describe("buildCalendlyUrl", () => {
  it("builds a profile URL with username only", () => {
    expect(buildCalendlyUrl("janedoe")).toBe("https://calendly.com/janedoe");
  });

  it("builds an event URL with username and event slug", () => {
    expect(buildCalendlyUrl("janedoe", "haircut-45")).toBe(
      "https://calendly.com/janedoe/haircut-45",
    );
  });

  it("appends primary_color when provided", () => {
    const url = buildCalendlyUrl("janedoe", "30min", "#2563eb");
    expect(url).toBe(
      "https://calendly.com/janedoe/30min?primary_color=2563eb",
    );
  });

  it("strips the # from hex color", () => {
    const url = buildCalendlyUrl("janedoe", undefined, "#d97706");
    expect(url).toBe(
      "https://calendly.com/janedoe?primary_color=d97706",
    );
  });

  it("omits primary_color when not provided", () => {
    const url = buildCalendlyUrl("janedoe", "30min");
    expect(url).not.toContain("primary_color");
  });
});

// ---------------------------------------------------------------------------
// buildReserveAction — Schema.org JSON-LD
// ---------------------------------------------------------------------------

describe("buildReserveAction", () => {
  it("generates a single ReserveAction for one event", () => {
    const result = buildReserveAction("cal", "janedoe", ["30min"]);
    expect(result).toHaveLength(1);
    expect(result[0]["@type"]).toBe("ReserveAction");
    expect(result[0].target.urlTemplate).toBe(
      "https://cal.com/janedoe/30min",
    );
    expect(result[0].target["@type"]).toBe("EntryPoint");
  });

  it("generates multiple actions for multiple events", () => {
    const result = buildReserveAction("cal", "janedoe", [
      "30min",
      "consultation",
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].target.urlTemplate).toContain("30min");
    expect(result[1].target.urlTemplate).toContain("consultation");
  });

  it("uses Calendly URLs for calendly provider", () => {
    const result = buildReserveAction("calendly", "janedoe", ["haircut"]);
    expect(result[0].target.urlTemplate).toBe(
      "https://calendly.com/janedoe/haircut",
    );
  });

  it("falls back to profile URL when no event slugs", () => {
    const result = buildReserveAction("cal", "janedoe", []);
    expect(result).toHaveLength(1);
    expect(result[0].target.urlTemplate).toBe("https://cal.com/janedoe");
  });

  it("includes both platform types", () => {
    const result = buildReserveAction("cal", "janedoe", ["30min"]);
    expect(result[0].target.actionPlatform).toContain(
      "https://schema.org/DesktopWebPlatform",
    );
    expect(result[0].target.actionPlatform).toContain(
      "https://schema.org/MobileWebPlatform",
    );
  });

  it("sets result type to Reservation", () => {
    const result = buildReserveAction("cal", "janedoe", ["30min"]);
    expect(result[0].result["@type"]).toBe("Reservation");
    expect(result[0].result.name).toBe("Appointment");
  });
});

// ---------------------------------------------------------------------------
// extractBrandColor
// ---------------------------------------------------------------------------

describe("extractBrandColor", () => {
  it("extracts --color-primary from CSS", () => {
    const css = `:root {\n  --color-primary: #2563eb;\n  --color-accent: #d97706;\n}`;
    expect(extractBrandColor(css)).toBe("#2563eb");
  });

  it("handles spaces around the value", () => {
    const css = `--color-primary:  #ff0000 ;`;
    expect(extractBrandColor(css)).toBe("#ff0000");
  });

  it("returns fallback when not found", () => {
    expect(extractBrandColor("body { color: red; }")).toBe("#000000");
  });

  it("returns fallback for empty string", () => {
    expect(extractBrandColor("")).toBe("#000000");
  });

  it("accepts a custom fallback", () => {
    expect(extractBrandColor("", "#ffffff")).toBe("#ffffff");
  });
});

// ---------------------------------------------------------------------------
// buildCalEmbed
// ---------------------------------------------------------------------------

describe("buildCalEmbed", () => {
  it("generates inline embed with element selector", () => {
    const html = buildCalEmbed("janedoe", "30min", "inline", "#2563eb");
    expect(html).toContain('id="booking-cal"');
    expect(html).toContain("Cal(");
    expect(html).toContain("janedoe/30min");
    expect(html).toContain("2563eb");
  });

  it("generates floating embed with button text", () => {
    const html = buildCalEmbed("janedoe", "30min", "floating", "#2563eb", "Book Now");
    expect(html).toContain("floatingButton");
    expect(html).toContain("Book Now");
    expect(html).not.toContain('id="booking-cal"');
  });

  it("generates button/popup embed", () => {
    const html = buildCalEmbed("janedoe", "30min", "button", "#2563eb", "Schedule");
    expect(html).toContain("pop");
    expect(html).toContain("Schedule");
  });

  it("uses profile URL when no event slug", () => {
    const html = buildCalEmbed("janedoe", undefined, "inline", "#000");
    expect(html).toContain("janedoe");
    expect(html).not.toContain("janedoe/");
  });

  it("defaults button text to Book Now", () => {
    const html = buildCalEmbed("janedoe", "30min", "floating", "#000");
    expect(html).toContain("Book Now");
  });

  it("escapes quotes in button text", () => {
    const html = buildCalEmbed("janedoe", "30min", "floating", "#000", 'It\'s Free');
    expect(html).toContain("It\\'s Free");
    expect(html).not.toContain("It's Free");
  });

  it("escapes double quotes in calLink", () => {
    const html = buildCalEmbed('jane"doe', "30min", "inline", "#000");
    expect(html).toContain('jane\\"doe');
  });
});

// ---------------------------------------------------------------------------
// buildCalendlyEmbed
// ---------------------------------------------------------------------------

describe("buildCalendlyEmbed", () => {
  it("generates inline embed with widget div", () => {
    const html = buildCalendlyEmbed("janedoe", "30min", "inline", "#2563eb");
    expect(html).toContain("calendly-inline-widget");
    expect(html).toContain("calendly.com/janedoe/30min");
    expect(html).toContain("widget.js");
    expect(html).toContain("widget.css");
  });

  it("generates floating embed with badge widget", () => {
    const html = buildCalendlyEmbed("janedoe", "30min", "floating", "#2563eb", "Book Now");
    expect(html).toContain("initBadgeWidget");
    expect(html).toContain("Book Now");
    expect(html).toContain("calendly.com/janedoe/30min");
  });

  it("generates button/popup embed", () => {
    const html = buildCalendlyEmbed("janedoe", "30min", "button", "#2563eb", "Schedule");
    expect(html).toContain("initPopupWidget");
    expect(html).toContain("Schedule");
  });

  it("passes brand color to Calendly", () => {
    const html = buildCalendlyEmbed("janedoe", "30min", "inline", "#d97706");
    expect(html).toContain("d97706");
  });

  it("escapes quotes in button text", () => {
    const html = buildCalendlyEmbed("janedoe", "30min", "floating", "#000", "It's Free");
    expect(html).toContain("It\\'s Free");
    expect(html).not.toContain("text:'It's");
  });
});

// ---------------------------------------------------------------------------
// buildBookingCSP
// ---------------------------------------------------------------------------

describe("buildBookingCSP", () => {
  it("returns Cal.com script-src for cal provider", () => {
    const csp = buildBookingCSP("cal");
    expect(csp["script-src"]).toContain("app.cal.com");
  });

  it("returns Calendly domains for calendly provider", () => {
    const csp = buildBookingCSP("calendly");
    expect(csp["script-src"]).toContain("assets.calendly.com");
    expect(csp["style-src"]).toContain("assets.calendly.com");
  });

  it("includes frame-src for cal", () => {
    const csp = buildBookingCSP("cal");
    expect(csp["frame-src"]).toContain("app.cal.com");
  });

  it("includes frame-src for calendly", () => {
    const csp = buildBookingCSP("calendly");
    expect(csp["frame-src"]).toContain("calendly.com");
  });
});
