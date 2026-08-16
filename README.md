# Bike Maintenance Tracker

A tiny, dependency-free dashboard that tracks routine maintenance for your
bikes, using mileage synced from Garmin Connect (via the Garmin gear feature)
and pings you when something's due.

**Live dashboard:** https://bike-maintenance-tracker-tau.vercel.app/

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

**Logging a completed service**: text the Telegram bot, e.g. "waxed the
Spark chain" or "did brake pads on the mog" — see "Logging via Telegram"
below. You can also just ask Claude in this repo's session directly, e.g.
"mark chain wax done on the Spark."

## Automated Garmin sync + ping

A daily Routine (Claude Code scheduled trigger, 2pm UTC / ~7am MT) does the
parts a static app can't do on its own:

1. Calls the Garmin MCP `get_gear` tool to pull each bike's current total
   distance.
2. Updates `mileageKm`/`totalActivities`/`lastSynced` in `data/bikes.json`.
3. Runs `node scripts/check-due.mjs` to see what's newly due-soon/overdue.
4. If anything is newly due, sends a summary via email and Telegram (see
   below) to Chris, then re-runs the check with `--ack` to avoid
   re-notifying for the same status.
5. Commits and pushes the updated `data/bikes.json`.

This keeps Garmin credentials out of the app entirely — the sync only runs
inside a Claude Code session that already has the Garmin/Gmail connectors.

### Telegram

No Telegram MCP connector exists in this Claude org, so pings go through a
direct call to the Telegram Bot API instead of a connector tool. A bot
(`@bike_maintenance_tracker_bot`) was created via BotFather and is now
messaged on the same due-item trigger as the email.

The bot token and chat ID are **not** stored in this repo (it's public) —
they live only in the Routines' own trigger configuration (`curl` calls to
`api.telegram.org`), which is private to the account that created them. If
the bot ever needs to be rotated, generate a new token via BotFather and
update both Routines' prompts (`trig_01V1nxS43Akd69nj611sguub` for the
daily sync, `trig_...` for the log listener — see `list_triggers`).

### Logging via Telegram

A second Routine ("Bike maintenance log listener") polls the bot hourly
for new messages and treats each one as a maintenance-log command:

1. Fetches new messages via `getUpdates`, using an offset persisted in
   `data/telegram-offset.json` so each message is only processed once.
2. For each message, matches it against a bike (MOG / Spark, or "both")
   and a maintenance item from `MAINTENANCE_CATALOG` in `src/rules.mjs`
   (e.g. "wax"/"waxed" → chain-wax, "sealant" → sealant-refresh, "brake
   pads"/"rotors" → brake-pads, "chain wear"/"chain stretch" → chain-wear,
   "fork" → fork-lowers, "shock"/"full suspension service" →
   shock-service, "pivot"/"bearings" → pivot-bearings, "bolt"/"torque" →
   bolt-torque). Free text is fine — "just waxed the gravel bike's chain"
   works as well as "mog chain wax".
3. On a confident match: refreshes that bike's mileage from Garmin, sets
   the item's `lastServiceKm`/`lastServiceDate` to now, resets
   `lastNotifiedStatus` to `ok`, commits and pushes, and replies on
   Telegram confirming what was logged (e.g. "✅ Logged: MOG chain wax at
   3,830 mi").
4. On an ambiguous match (can't tell which bike, or no recognizable item):
   replies asking for clarification instead of guessing, and doesn't touch
   `bikes.json`.
5. Messages that aren't maintenance-log commands at all are ignored
   silently — the bot only replies to things it's confident are (or look
   like an attempt at) a log entry.

Expect up to an hour of lag between texting the bot and seeing the
dashboard/next-due countdown update, since it's polled hourly rather than
via webhook.
