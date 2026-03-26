import { describe, it, expect } from "vitest";
import {
  parseHours,
  parseAddress,
  businessTypeToSchemaType,
  generateLocalBusinessJsonLd,
  formatHoursForDisplay,
  type BusinessInfo,
  type DayHours,
} from "../template/scripts/business-info.js";

// ---------------------------------------------------------------------------
// parseHours
// ---------------------------------------------------------------------------

describe("parseHours", () => {
  it("parses simple range: Mon-Fri 9am-5pm", () => {
    const result = parseHours("Mon-Fri 9am-5pm");
    expect(result.length).toBe(5);
    expect(result[0]).toEqual({ day: "Monday", open: "09:00", close: "17:00" });
    expect(result[4]).toEqual({ day: "Friday", open: "09:00", close: "17:00" });
  });

  it("parses individual days with comma separator", () => {
    const result = parseHours("Mon 9am-5pm, Tue 10am-6pm");
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ day: "Monday", open: "09:00", close: "17:00" });
    expect(result[1]).toEqual({ day: "Tuesday", open: "10:00", close: "18:00" });
  });

  it("handles Closed days", () => {
    const result = parseHours("Mon-Sat 9am-5pm, Sun Closed");
    const sunday = result.find((d) => d.day === "Sunday");
    expect(sunday).toBeUndefined();
    expect(result.length).toBe(6);
  });

  it("handles 12-hour time with pm", () => {
    const result = parseHours("Mon 11am-2pm");
    expect(result[0]).toEqual({ day: "Monday", open: "11:00", close: "14:00" });
  });

  it("handles noon (12pm)", () => {
    const result = parseHours("Mon 12pm-9pm");
    expect(result[0]).toEqual({ day: "Monday", open: "12:00", close: "21:00" });
  });

  it("handles split hours", () => {
    const result = parseHours("Mon 11am-2pm 5pm-10pm");
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ day: "Monday", open: "11:00", close: "14:00" });
    expect(result[1]).toEqual({ day: "Monday", open: "17:00", close: "22:00" });
  });

  it("returns empty array for empty string", () => {
    expect(parseHours("")).toEqual([]);
  });

  it("handles full day names", () => {
    const result = parseHours("Monday-Friday 9am-5pm");
    expect(result.length).toBe(5);
    expect(result[0].day).toBe("Monday");
  });

  it("rejects invalid hour values like 13pm (would produce 25:00)", () => {
    const result = parseHours("Mon 13pm-5pm");
    expect(result.length).toBe(0);
  });

  it("rejects out-of-range 24h input like 25:30", () => {
    const result = parseHours("Mon 25:30-5pm");
    expect(result.length).toBe(0);
  });

  it("rejects invalid minutes like 9:61am", () => {
    const result = parseHours("Mon 9:61am-5pm");
    expect(result.length).toBe(0);
  });

  it("keeps valid entries and skips invalid ones in mixed input", () => {
    const result = parseHours("Mon 9am-5pm, Tue 13pm-5pm");
    expect(result.length).toBe(1);
    expect(result[0].day).toBe("Monday");
  });
});

// ---------------------------------------------------------------------------
// parseAddress
// ---------------------------------------------------------------------------

describe("parseAddress", () => {
  it("parses street, city, state, zip", () => {
    const result = parseAddress("123 Main St, Springfield, IL 62704");
    expect(result.street).toBe("123 Main St");
    expect(result.city).toBe("Springfield");
    expect(result.state).toBe("IL");
    expect(result.zip).toBe("62704");
  });

  it("handles multi-word city names", () => {
    const result = parseAddress("456 Oak Ave, San Francisco, CA 94102");
    expect(result.city).toBe("San Francisco");
    expect(result.state).toBe("CA");
  });

  it("handles missing zip", () => {
    const result = parseAddress("789 Elm St, Portland, OR");
    expect(result.street).toBe("789 Elm St");
    expect(result.city).toBe("Portland");
    expect(result.state).toBe("OR");
  });

  it("returns raw string as street for unparseable addresses", () => {
    const result = parseAddress("Just a place");
    expect(result.street).toBe("Just a place");
  });
});

// ---------------------------------------------------------------------------
// businessTypeToSchemaType
// ---------------------------------------------------------------------------

describe("businessTypeToSchemaType", () => {
  it("maps restaurant", () => {
    expect(businessTypeToSchemaType("restaurant")).toBe("Restaurant");
  });

  it("maps salon", () => {
    expect(businessTypeToSchemaType("salon")).toBe("BeautySalon");
  });

  it("maps accounting", () => {
    expect(businessTypeToSchemaType("accounting")).toBe("AccountingService");
  });

  it("maps healthcare", () => {
    expect(businessTypeToSchemaType("healthcare")).toBe("MedicalBusiness");
  });

  it("maps florist", () => {
    expect(businessTypeToSchemaType("florist")).toBe("Florist");
  });

  it("maps brewery", () => {
    expect(businessTypeToSchemaType("brewery")).toBe("Brewery");
  });

  it("falls back to LocalBusiness for unknown types", () => {
    expect(businessTypeToSchemaType("unknown-type")).toBe("LocalBusiness");
  });

  it("falls back to LocalBusiness for empty string", () => {
    expect(businessTypeToSchemaType("")).toBe("LocalBusiness");
  });
});

// ---------------------------------------------------------------------------
// generateLocalBusinessJsonLd
// ---------------------------------------------------------------------------

describe("generateLocalBusinessJsonLd", () => {
  const info: BusinessInfo = {
    name: "Joe's Pizza",
    businessType: "restaurant",
    address: "123 Main St, Springfield, IL 62704",
    phone: "(555) 123-4567",
    hours: "Mon-Sat 11am-10pm, Sun 12pm-9pm",
    url: "https://joespizza.com",
  };

  it("includes @context and @type", () => {
    const ld = generateLocalBusinessJsonLd(info);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Restaurant");
  });

  it("includes name and url", () => {
    const ld = generateLocalBusinessJsonLd(info);
    expect(ld.name).toBe("Joe's Pizza");
    expect(ld.url).toBe("https://joespizza.com");
  });

  it("includes telephone", () => {
    const ld = generateLocalBusinessJsonLd(info);
    expect(ld.telephone).toBe("(555) 123-4567");
  });

  it("includes structured address", () => {
    const ld = generateLocalBusinessJsonLd(info);
    const addr = ld.address as Record<string, string>;
    expect(addr["@type"]).toBe("PostalAddress");
    expect(addr.streetAddress).toBe("123 Main St");
    expect(addr.addressLocality).toBe("Springfield");
    expect(addr.addressRegion).toBe("IL");
    expect(addr.postalCode).toBe("62704");
  });

  it("includes openingHoursSpecification", () => {
    const ld = generateLocalBusinessJsonLd(info);
    const hours = ld.openingHoursSpecification as any[];
    expect(hours.length).toBeGreaterThan(0);
    expect(hours[0]["@type"]).toBe("OpeningHoursSpecification");
    expect(hours[0].dayOfWeek).toBeDefined();
    expect(hours[0].opens).toBeDefined();
    expect(hours[0].closes).toBeDefined();
  });

  it("omits address when not provided", () => {
    const ld = generateLocalBusinessJsonLd({ ...info, address: undefined });
    expect(ld.address).toBeUndefined();
  });

  it("omits hours when not provided", () => {
    const ld = generateLocalBusinessJsonLd({ ...info, hours: undefined });
    expect(ld.openingHoursSpecification).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatHoursForDisplay
// ---------------------------------------------------------------------------

describe("formatHoursForDisplay", () => {
  it("formats hours as readable lines", () => {
    const hours: DayHours[] = [
      { day: "Monday", open: "09:00", close: "17:00" },
      { day: "Tuesday", open: "09:00", close: "17:00" },
    ];
    const result = formatHoursForDisplay(hours);
    expect(result).toContain("Monday");
    expect(result).toContain("9:00 AM");
    expect(result).toContain("5:00 PM");
  });

  it("groups consecutive days with same hours", () => {
    const hours: DayHours[] = [
      { day: "Monday", open: "09:00", close: "17:00" },
      { day: "Tuesday", open: "09:00", close: "17:00" },
      { day: "Wednesday", open: "09:00", close: "17:00" },
    ];
    const result = formatHoursForDisplay(hours);
    expect(result).toContain("Monday–Wednesday");
  });

  it("returns message for empty hours", () => {
    const result = formatHoursForDisplay([]);
    expect(result.toLowerCase()).toContain("hours not");
  });
});
