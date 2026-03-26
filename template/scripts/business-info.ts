/**
 * Business info utilities — hours parsing, address parsing,
 * LocalBusiness JSON-LD generation, and schema.org type mapping.
 *
 * Used by the business-info skill and the home page layout.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DayHours {
  day: string;
  open: string;  // 24h format "09:00"
  close: string; // 24h format "17:00"
}

export interface BusinessInfo {
  name: string;
  businessType: string;
  address?: string;
  phone?: string;
  hours?: string;
  url?: string;
}

export interface ParsedAddress {
  street: string;
  city?: string;
  state?: string;
  zip?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_NAMES: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const SCHEMA_TYPE_MAP: Record<string, string> = {
  restaurant: "Restaurant",
  salon: "BeautySalon",
  "hair-salon": "HairSalon",
  accounting: "AccountingService",
  healthcare: "MedicalBusiness",
  florist: "Florist",
  brewery: "Brewery",
  bakery: "Bakery",
  bookshop: "BookStore",
  "auto-dealer": "AutoDealer",
  "car-wash": "AutoWash",
  childcare: "ChildCare",
  cleaning: "HousekeepingService",
  "dance-studio": "DanceGroup",
  dentist: "Dentist",
  "dry-cleaning": "DryCleaningOrLaundry",
  laundry: "DryCleaningOrLaundry",
  education: "EducationalOrganization",
  "pet-services": "PetStore",
  fitness: "HealthClub",
  grocery: "GroceryStore",
  hardware: "HardwareStore",
  hotel: "Hotel",
  hospitality: "LodgingBusiness",
  campground: "Campground",
  insurance: "InsuranceAgency",
  jewelry: "JewelryStore",
  "real-estate": "RealEstateAgent",
  storage: "SelfStorage",
  trades: "HomeAndConstructionBusiness",
  plumber: "Plumber",
  electrician: "Electrician",
  hvac: "HVACBusiness",
  photography: "Photographer",
  "credit-union": "CreditUnion",
  pharmacy: "Pharmacy",
  "travel-agency": "TravelAgency",
  veterinarian: "VeterinaryCare",
  "animal-shelter": "AnimalShelter",
};

// ---------------------------------------------------------------------------
// Hours parsing
// ---------------------------------------------------------------------------

function expandDayRange(rangeStr: string): string[] {
  const parts = rangeStr.split("-").map((s) => s.trim().toLowerCase());
  if (parts.length === 1) {
    const full = DAY_NAMES[parts[0]];
    return full ? [full] : [];
  }

  const startDay = DAY_NAMES[parts[0]];
  const endDay = DAY_NAMES[parts[1]];
  if (!startDay || !endDay) return [];

  const startIdx = DAY_ORDER.indexOf(startDay);
  const endIdx = DAY_ORDER.indexOf(endDay);
  if (startIdx < 0 || endIdx < 0) return [];

  const days: string[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    days.push(DAY_ORDER[i]);
  }
  return days;
}

function parseTo24h(timeStr: string): string | null {
  const match = timeStr.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2] || "0", 10);
  const period = (match[3] || "").toLowerCase();

  // With am/pm, valid input hours are 1–12
  if (period && (hours < 1 || hours > 12)) return null;

  if (period === "pm" && hours < 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/**
 * Parse hours string like "Mon-Fri 9am-5pm, Sun Closed"
 * into structured DayHours array.
 */
export function parseHours(hoursString: string): DayHours[] {
  if (!hoursString.trim()) return [];

  const result: DayHours[] = [];
  const segments = hoursString.split(",").map((s) => s.trim());

  for (const segment of segments) {
    // Match: DayRange TimeRange [TimeRange2]
    const match = segment.match(
      /^([\w-]+(?:\s*-\s*[\w]+)?)\s+(.+)$/,
    );
    if (!match) continue;

    const dayPart = match[1];
    const timePart = match[2].trim();

    if (/closed/i.test(timePart)) continue;

    const days = expandDayRange(dayPart);

    // Split time ranges (e.g., "11am-2pm 5pm-10pm")
    const timeRanges = timePart.match(/\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi) || [];

    for (const day of days) {
      for (const range of timeRanges) {
        const [openStr, closeStr] = range.split("-").map((s) => s.trim());
        const open = parseTo24h(openStr);
        const close = parseTo24h(closeStr);
        if (open === null || close === null) continue;
        result.push({ day, open, close });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Address parsing
// ---------------------------------------------------------------------------

/**
 * Parse an address string into components.
 * Expects: "Street, City, ST ZIP" or "Street, City, ST"
 */
export function parseAddress(addressString: string): ParsedAddress {
  const parts = addressString.split(",").map((s) => s.trim());

  if (parts.length < 2) {
    return { street: addressString };
  }

  const street = parts[0];
  const city = parts.length >= 3 ? parts.slice(1, -1).join(", ") : parts[1];

  // Last part: "ST 12345" or "ST"
  const lastPart = parts[parts.length - 1];
  const stateZipMatch = lastPart.match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/);

  if (stateZipMatch) {
    return {
      street,
      city: parts.length >= 3 ? city : undefined,
      state: stateZipMatch[1],
      zip: stateZipMatch[2] || undefined,
    };
  }

  // Try to extract city from second part if only 2 parts
  if (parts.length === 2) {
    return { street, city: parts[1] };
  }

  return { street, city, state: lastPart };
}

// ---------------------------------------------------------------------------
// Schema.org type mapping
// ---------------------------------------------------------------------------

/**
 * Map Anglesite business type to schema.org @type.
 */
export function businessTypeToSchemaType(businessType: string): string {
  if (!businessType) return "LocalBusiness";
  const type = businessType.toLowerCase().split(",")[0].trim();
  return SCHEMA_TYPE_MAP[type] || "LocalBusiness";
}

// ---------------------------------------------------------------------------
// JSON-LD generation
// ---------------------------------------------------------------------------

/**
 * Generate a LocalBusiness JSON-LD object from business info.
 */
export function generateLocalBusinessJsonLd(
  info: BusinessInfo,
): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": businessTypeToSchemaType(info.businessType),
    name: info.name,
  };

  if (info.url) ld.url = info.url;
  if (info.phone) ld.telephone = info.phone;

  if (info.address) {
    const addr = parseAddress(info.address);
    const postalAddress: Record<string, string> = {
      "@type": "PostalAddress",
      streetAddress: addr.street,
    };
    if (addr.city) postalAddress.addressLocality = addr.city;
    if (addr.state) postalAddress.addressRegion = addr.state;
    if (addr.zip) postalAddress.postalCode = addr.zip;
    ld.address = postalAddress;
  }

  if (info.hours) {
    const dayHours = parseHours(info.hours);
    if (dayHours.length > 0) {
      ld.openingHoursSpecification = dayHours.map((dh) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: `https://schema.org/${dh.day}`,
        opens: dh.open,
        closes: dh.close,
      }));
    }
  }

  return ld;
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

function to12h(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr || "00";
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${period}`;
}

/**
 * Format hours for human display, grouping consecutive days with same hours.
 */
export function formatHoursForDisplay(hours: DayHours[]): string {
  if (hours.length === 0) return "Hours not available.";

  // Group by day, collecting all time ranges per day
  const byDay = new Map<string, string[]>();
  for (const dh of hours) {
    const range = `${to12h(dh.open)}–${to12h(dh.close)}`;
    if (!byDay.has(dh.day)) byDay.set(dh.day, []);
    byDay.get(dh.day)!.push(range);
  }

  // Build ordered entries
  const entries: { days: string[]; ranges: string }[] = [];
  for (const day of DAY_ORDER) {
    if (!byDay.has(day)) continue;
    const ranges = byDay.get(day)!.join(", ");
    const last = entries[entries.length - 1];
    if (last && last.ranges === ranges) {
      last.days.push(day);
    } else {
      entries.push({ days: [day], ranges });
    }
  }

  return entries
    .map((e) => {
      const dayLabel =
        e.days.length === 1
          ? e.days[0]
          : `${e.days[0]}–${e.days[e.days.length - 1]}`;
      return `${dayLabel}: ${e.ranges}`;
    })
    .join("\n");
}
