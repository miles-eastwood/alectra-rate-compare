# Alectra Usage Compare

Chrome extension for comparing Alectra electricity usage under Ontario tiered and time-of-use (TOU) pricing. Not that this extension is not affiliated with Alectra in any way.

## How to use

1. Install the extension in Chrome.
2. Sign in to [Alectra](https://myalectra.alectrautilities.com/).
3. Open the [Usage Overview](https://myalectra.alectrautilities.com/portal/#/Usages) page and wait for it to load.
4. Open Alectra Usage Compare from the Chrome toolbar.
5. Choose an inclusive `From` and `To` date range, then select **Fetch & Compare**.

The side panel shows total usage, tiered cost, TOU cost, savings, monthly usage, and cost breakdowns by TOU bucket and tier.

## Pricing assumptions

On each fetch, the extension tries to pull current tiered and TOU per-kWh rates directly from Alectra's rate plan API (the same one used to calculate the rates that would appear on your bill), scoped by month. If that request fails or returns unexpected data, the extension falls back to these hardcoded defaults:

- Tier 1: `$0.120/kWh` up to `600 kWh` per month from May through October.
- Tier 1: `$0.120/kWh` up to `1,000 kWh` per month from November through April.
- Tier 2: `$0.142/kWh` above the applicable monthly threshold.
- TOU off-peak: `$0.098/kWh`.
- TOU mid-peak: `$0.157/kWh`.
- TOU on-peak: `$0.203/kWh`.

The side panel notes whether a comparison used live or default rates. Ultra-Low Overnight (ULO) rates are returned by the same API but are not supported by this extension; only Tiered (RPP) and TOU rates are used.

TOU periods are calculated from each usage record's timestamp. Weekends and statutory holidays are off-peak all day, year-round. On other days:

- Summer (May 1 - October 31): 7:00-11:00 and 17:00-19:00 are mid-peak, 11:00-17:00 is on-peak.
- Winter (November 1 - April 30): 7:00-11:00 and 17:00-19:00 are on-peak, 11:00-17:00 is mid-peak.
- All other hours are off-peak.

### Statutory holidays

The following Ontario statutory holidays are billed at the off-peak rate all day, matching [OEB holidays](https://www.oeb.ca/consumer-information-and-protection/electricity-rates/holiday-schedule-time-use-and-ultra-low):

- New Year's Day (January 1)
- Family Day (3rd Monday of February)
- Good Friday (Friday before Easter Sunday)
- Victoria Day (Monday preceding May 25)
- Canada Day (July 1)
- Civic Holiday (1st Monday of August)
- Labour Day (1st Monday of September)
- Thanksgiving Day (2nd Monday of October)
- Christmas Day (December 25)
- Boxing Day (December 26)

If a fixed-date holiday (New Year's Day, Canada Day, Christmas Day, or Boxing Day) falls on a weekend, the holiday's off-peak pricing shifts to the next weekday that isn't already a holiday.

## Privacy and data handling

- The extension runs on the Alectra website to detect the authenticated usage request.
- The captured bearer token, account number, and meter number are stored in Chrome extension local storage.
- Usage requests are sent to the Alectra service API for the selected date range.
- Usage records are processed locally in the extension to calculate the comparison.
- The extension does not send data to an analytics or advertising service.

Use **Clear Data** in the side panel to remove saved usage results. Removing the extension removes its local extension storage.

## Development

Requirements: Node.js 14.18 or newer and pnpm.

Install dependencies and build the extension:

```sh
pnpm install
pnpm build
```

Load the `build` directory from `chrome://extensions` with **Developer mode** enabled. After changing source files, rebuild and reload the unpacked extension.

Create a distributable archive with:

```sh
pnpm zip
```

## Limitations

- You must be signed in and visit the Alectra Usage Overview page before fetching data.
- Results depend on the usage data returned by Alectra and the pricing assumptions above.
- The extension is intended for personal comparison and is not an official Alectra billing statement.
