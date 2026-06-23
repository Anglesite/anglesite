# Seasonal Marketing Calendar

Month-by-month content hooks for the webmaster agent. Read `BUSINESS_TYPE` from `.site-config`, scan the current quarter file, and surface 3–5 relevant hooks to the owner.

## How to use

1. Read the owner's `BUSINESS_TYPE` (may be comma-separated for multi-mode businesses).
2. Read the file for the current quarter (and next quarter if near the boundary):
   - [q1.md](q1.md) — January, February, March
   - [q2.md](q2.md) — April, May, June
   - [q3.md](q3.md) — July, August, September
   - [q4.md](q4.md) — October, November, December
3. Include all `types: all` hooks plus any that match the owner's business type(s).
4. Check lead times — if a hook in the next quarter has a long lead time, surface it now.
5. Present hooks as content suggestions with the actionable description. Cross-reference with the "Content ideas" section in the owner's SMB file for more specific angles.
6. If the owner serves international customers, also read [international.md](international.md).

## Lead time guidance

Content published the day of a holiday is too late. Customers search and plan ahead.

| Hook type | Start creating | Publish by |
|---|---|---|
| Gift-giving holidays (Valentine's, Mother's Day, Christmas) | 4 weeks before | 3 weeks before |
| Booking-dependent (weddings, travel, events) | 8 weeks before | 6 weeks before |
| Awareness months | Week before the month | First week of the month |
| Seasonal tips (winterize, spring prep) | 3 weeks before season | 2 weeks before |
| Sale events (Presidents' Day, Black Friday) | 2 weeks before | 1 week before |
| Everything else | 2 weeks before | 1 week before |

When an individual hook says "Lead time: X" it overrides these defaults.

## Industry awareness days

Each SMB file in `docs/smb/` has a "Key dates" section with industry-specific awareness days. Read the file matching the owner's `BUSINESS_TYPE` for their relevant dates.
