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

**Logging a completed service**: three ways —
1. Tap "Log done" next to any item on the dashboard. It calls the `/api/log`
   Vercel function, which commits the update to `data/bikes.json` straight
   from the browser — no other app needed.
2. Text the bot directly — either a slash command (`/wax mog`) or free
   text ("waxed the Spark chain"). See "Logging via Telegram" below.
3. Ask Claude in this repo's session directly, e.g. "mark chain wax done
   on the Spark."

## Automated Garmin sync + ping

A daily Routine (Claude Code scheduled trigger, 2pm UTC / ~7am MT) does the
parts a static app can't do on its own:

1. Calls the Garmin v2 MCP `get_gear` tool to pull each bike's current total
   distance.
2. Updates `mileageKm`/`totalActivities`/`lastSynced` in `data/bikes.json`.
3. Runs `node scripts/check-due.mjs` to see what's newly due-soon/overdue.
4. If anything is newly due, sends a summary via Telegram (see below) to
   Chris, then re-runs the check with `--ack` to avoid re-notifying for the
   same status.
5. Commits and pushes the updated `data/bikes.json`.

This keeps Garmin credentials out of the app entirely — the sync only runs
inside a Claude Code session that already has the Garmin v2/Gmail connectors.

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

Type `/` in the chat to see the registered command menu (set via
`setMyCommands`):

| Command | Logs |
|---|---|
| `/wax <bike>` | Chain wax |
| `/sealant <bike>` | Tubeless sealant refresh |
| `/brakes <bike>` | Brake pad/rotor inspection |
| `/chainwear <bike>` | Chain wear check |
| `/bolts <bike>` | Safety bolt-torque check |
| `/fork <bike>` | Fork lower leg service (Spark only) |
| `/shock <bike>` | Shock & fork full service (Spark only) |
| `/pivot <bike>` | Pivot bearing check (Spark only) |
| `/status` | Current status of every item on both bikes, on demand |
| `/help` | Lists commands and usage |

`<bike>` is `mog` or `spark` (or `both` to log the same item on both
bikes). Free text also works if you'd rather not use the menu — "waxed
the Spark chain" is parsed the same as `/wax spark`.

A Routine ("Bike maintenance log listener") polls the bot hourly and
processes each new message:

1. Fetches new messages via `getUpdates`, using an offset persisted in
   `data/telegram-offset.json` so each message is only processed once.
2. `/status` and `/help` just reply — no data changes.
3. A recognized log command/phrase (slash command or free text, matched
   against `MAINTENANCE_CATALOG` in `src/rules.mjs`): refreshes that
   bike's mileage from Garmin, sets the item's `lastServiceKm`/
   `lastServiceDate` to now, resets `lastNotifiedStatus` to `ok`, commits
   and pushes, and replies confirming what was logged (e.g. "✅ Logged:
   MOG chain wax at 3,830 mi").
4. An ambiguous log attempt (can't tell which bike, or a Spark-only item
   requested for MOG) gets a clarifying reply instead of a guess, and
   `bikes.json` isn't touched.
5. Anything that isn't a command or log attempt is ignored silently — the
   bot only replies to things it's confident are (or look like an attempt
   at) a command or log entry.

Expect up to an hour of lag between texting the bot and seeing the
dashboard/next-due countdown update, since it's polled hourly rather than
via webhook.

## In-app logging (`/api/log`)

The "Log done" button on the dashboard calls a Vercel serverless function
(`api/log.js`) instead of bouncing through Telegram. Given `{ bikeId,
itemId }`, it reads `data/bikes.json` via the GitHub Contents API, sets that
item's `lastServiceKm` to the bike's current `mileageKm`, `lastServiceDate`
to today, and `lastNotifiedStatus` to `ok`, then commits and pushes the
change directly to the `claude/bike-maintenance-tracker-0s7qq4` branch. The
response includes the updated data so the dashboard re-renders immediately
without waiting on raw.githubusercontent.com's cache.

This requires a `GITHUB_TOKEN` environment variable in the Vercel
project (Settings → Environment Variables) — a GitHub token scoped to
contents:write on this repo. It's never exposed to the browser; only the
serverless function reads it. If logging starts failing with a 500 error
mentioning `GITHUB_TOKEN`, the token is missing or expired and needs to be
regenerated and reset there.
