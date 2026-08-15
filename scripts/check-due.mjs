#!/usr/bin/env node
// Computes maintenance status for every bike and prints a JSON report.
//
// Usage:
//   node scripts/check-due.mjs            print a report of items that are
//                                          due-soon/overdue AND have gotten
//                                          worse since the last notification
//   node scripts/check-due.mjs --ack      same, then persist the current
//                                          status into data/bikes.json so
//                                          those items aren't re-reported
//                                          until they change again
//
// This script is invoked by the scheduled sync (see README.md) after the
// caller has refreshed data/bikes.json with the latest Garmin mileage.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { computeBikeStatus } from '../src/rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'bikes.json');

const ack = process.argv.includes('--ack');
const today = new Date().toISOString().slice(0, 10);

const raw = await readFile(DATA_PATH, 'utf8');
const data = JSON.parse(raw);

const toNotify = [];

for (const bike of data.bikes) {
  const evaluated = computeBikeStatus(bike, today);
  for (const item of evaluated.items) {
    if (item.status !== 'ok' && item.worseningSinceLastNotified) {
      toNotify.push({
        bike: bike.name,
        item: item.label,
        status: item.status,
        description: item.description,
        kmRemaining: item.kmRemaining ?? null,
        daysRemaining: item.daysRemaining ?? null,
        dueAtKm: item.dueAtKm ?? null,
        dueAtDate: item.dueAtDate ?? null,
      });
      if (ack) {
        const raw_item = bike.maintenanceItems.find((i) => i.id === item.id);
        raw_item.lastNotifiedStatus = item.status;
      }
    }
  }
}

if (ack) {
  data.lastSynced = today;
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
}

console.log(JSON.stringify({ today, toNotify }, null, 2));
