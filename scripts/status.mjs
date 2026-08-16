#!/usr/bin/env node
// Prints the full current status of every bike/item, regardless of
// notification history — unlike check-due.mjs, which only reports items
// that got newly worse. Used by `npm run status` and by the Telegram
// /status command.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { computeBikeStatus } from '../src/rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'bikes.json');

const KM_TO_MI = 0.621371;
const fmtMiles = (km) => Math.round(km * KM_TO_MI).toLocaleString();

const today = new Date().toISOString().slice(0, 10);
const raw = await readFile(DATA_PATH, 'utf8');
const data = JSON.parse(raw);

const STATUS_ICON = { ok: '✅', 'due-soon': '⚠️', overdue: '🔴' };

const lines = [];
for (const bike of data.bikes) {
  const evaluated = computeBikeStatus(bike, today);
  lines.push(`${bike.name} — ${fmtMiles(bike.mileageKm)} mi`);
  for (const item of evaluated.items) {
    const remaining =
      item.kmRemaining != null
        ? item.kmRemaining >= 0
          ? `${fmtMiles(item.kmRemaining)} mi left`
          : `${fmtMiles(-item.kmRemaining)} mi over`
        : item.daysRemaining >= 0
          ? `${item.daysRemaining}d left`
          : `${-item.daysRemaining}d over`;
    lines.push(`  ${STATUS_ICON[item.status]} ${item.label}: ${remaining}`);
  }
  lines.push('');
}

console.log(lines.join('\n').trim());
