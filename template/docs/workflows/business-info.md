# Business info, hours, and location

Manage your business address, phone number, and opening hours with automatic LocalBusiness structured data for Google.

## What it sets up

- **Location page** (`/location`) — address, phone, hours, and OpenStreetMap embed
- **LocalBusiness JSON-LD** — structured data in the home page `<head>` for Google's knowledge panel
- **Footer info** — address and hours on every page

## Configuration

Stored in `.site-config`:

| Key | Example |
|---|---|
| `SITE_ADDRESS` | `123 Main St, Springfield, IL 62704` |
| `SITE_PHONE` | `(555) 123-4567` |
| `SITE_HOURS` | `Mon-Fri 9am-5pm, Sat 10am-3pm, Sun Closed` |
| `OSM_EMBED_URL` | OpenStreetMap embed URL for the map |

## Hours format

| Format | Example |
|---|---|
| Day range | `Mon-Fri 9am-5pm` |
| Individual days | `Mon 9am-5pm, Tue 10am-6pm` |
| Split hours | `Mon 11am-2pm 5pm-10pm` |
| Closed | `Sun Closed` |
| Full names | `Monday-Friday 9am-5pm` |

## Why structured data matters

LocalBusiness JSON-LD is how Google populates the knowledge panel that appears in search results — the box with your hours, address, phone number, and map. Without it, Google has to guess (and often gets it wrong).

## Map

The location page uses an OpenStreetMap embed (iframe, no JavaScript). This stays within the zero-third-party-JS principle since it's a simple iframe with no tracking.
