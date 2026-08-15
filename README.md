# Bike Maintenance Tracker

A tiny, dependency-free dashboard that tracks routine maintenance for your
bikes, using mileage synced from Garmin Connect (via the Garmin gear feature)
and pings you when something's due.

**Live dashboard:** _deployed URL added here once published — see below._

## Bikes tracked

- **MOG** (Enve MOG, gravel) — Garmin gear `MOG`
- **Spark** (Scott Spark, full-suspension MTB) — Garmin gear `Spark`

Garmin's "gear" feature already tracks total distance per bike across logged
activities, so that's the mileage source of truth — no manual odometer entry.

## How it works

- `data/bikes.json` — current mileage per bike, plus a `lastServiceKm` /
  `lastServiceDate` and `lastNotifiedStatus` for every maintenance item.
- `src/rules.mjs` — the maintenance catalog (intervals) and the pure
  `computeItemStatus` / `computeBikeStatus` functions that turn "current
  mileage/date vs. last service" into an `ok` / `due-soon` / `overdue`
  status. Used by both the dashboard and the sync script, so there's one
  source of truth for the schedule.
- `index.html` / `app.js` / `styles.css` — a static dashboard that fetches
  `data/bikes.json` straight from GitHub (raw.githubusercontent.com) on every
  page load and renders each bike's checklist with status badges and miles
  remaining to the next item. Because it fetches live from GitHub instead of
  a bundled copy, it never needs a redeploy — pushing updated mileage is
  enough to update the page.
- `scripts/check-due.mjs` — computes status for everything and prints the
  items that are `due-soon`/`overdue` **and** have gotten worse since the
  last notification (so you're not re-pinged every day for the same thing).
  Run with `--ack` to persist the current status back into `bikes.json`
  after notifying.

### Viewing the dashboard

No build step. From the repo root:

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

### Checking what's due, by hand

```sh
npm run check
```

## Maintenance schedule (defaults, edit in `src/rules.mjs`)

Tuned for a high-desert climate (northern Utah / Wasatch Front): hot dry
summers dry out sealant faster, and dusty singletrack wears suspension
seals, pivot bearings, and brake pads faster than a wetter climate would.

Both bikes:

| Item | Interval | Why |
|---|---|---|
| Chain wax | 250 km | Also rewax after any ride through winter road slush/mag chloride, regardless of mileage |
| Chain wear check | 2000 km | |
| Tubeless sealant refresh | 60 days | Shortened from a typical 90 for dry-climate evaporation |
| Brake pad inspection | 800 km | Shortened from a typical 1000 for trail grit wear |
| Safety bolt-torque check | 90 days | |

Spark only (full-suspension extras):

| Item | Interval | Why |
|---|---|---|
| Fork lower leg service | 600 km | Shortened from a typical 800 for dust ingress |
| Shock & fork full service | 365 days | |
| Pivot bearing check | 120 days | Shortened from a typical 180 for grit ingress |

These are sane defaults, not gospel — tune the intervals in
`src/rules.mjs` (`MAINTENANCE_CATALOG`) to match your actual wax/sealant
brand and riding conditions.

**Baselines**: every item's `lastServiceKm`/`lastServiceDate` was
initialized to today's mileage/date when this tracker was set up, since
actual last-service history wasn't available. If you know a component is
actually overdue *right now* (e.g. you haven't rewaxed the chain in 400 km),
edit that item in `data/bikes.json` to reflect the real last-service point —
otherwise the countdown starts from today.

**Logging a completed service**: just ask Claude in this repo's session,
e.g. "mark chain wax done on the Spark" — it'll update
`lastServiceKm`/`lastServiceDate` (and reset `lastNotifiedStatus`) in
`data/bikes.json` and commit it.

## Automated Garmin sync + ping

A daily Routine (Claude Code scheduled trigger, 2pm UTC / ~7am MT) does the
parts a static app can't do on its own:

1. Calls the Garmin MCP `get_gear` tool to pull each bike's current total
   distance.
2. Updates `mileageKm`/`totalActivities`/`lastSynced` in `data/bikes.json`.
3. Runs `node scripts/check-due.mjs` to see what's newly due-soon/overdue.
4. If anything is newly due, sends a summary via email (and Telegram, once
   configured — see below) to Chris, then re-runs the check with `--ack` to
   avoid re-notifying for the same status.
5. Commits and pushes the updated `data/bikes.json`.

This keeps Garmin credentials out of the app entirely — the sync only runs
inside a Claude Code session that already has the Garmin/Gmail connectors.

### Telegram

No Telegram MCP connector exists in this Claude org, so pings go through a
direct call to the Telegram Bot API instead. To enable it:

1. Message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`,
   and save the bot token it gives you.
2. Message your new bot once (anything), then visit
   `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your numeric
   `chat.id`.
3. Give Claude the token + chat ID; they get stored as env vars for the sync
   session and the routine posts to
   `https://api.telegram.org/bot<TOKEN>/sendMessage` on the same due-item
   trigger as the email.
