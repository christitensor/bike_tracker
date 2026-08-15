// Shared maintenance logic used by both the dashboard (browser) and the
// check-due script (Node). Keep this file dependency-free and ISO-date based
// so it runs unmodified in either environment.

// Intervals tuned for a high-desert climate (northern Utah / Wasatch
// Front): hot dry summers dry out sealant faster, and dusty singletrack is
// harder on suspension seals, pivot bearings, and brake pads than a wetter
// climate. Winter road/commute riding on mag-chloride slush also warrants
// an extra chain-wax pass outside the normal mileage cadence.
export const MAINTENANCE_CATALOG = {
  'chain-wax': {
    label: 'Chain wax',
    description: 'Strip and hot-wax the chain. Also rewax after any ride through winter road slush/mag chloride, regardless of mileage.',
    intervalKm: 250,
  },
  'chain-wear': {
    label: 'Chain wear check',
    description: 'Measure chain stretch with a gauge; replace once past 0.75%.',
    intervalKm: 2000,
  },
  'sealant-refresh': {
    label: 'Tubeless sealant refresh',
    description: 'Top up or replace sealant in both tires. Shortened for dry-climate evaporation — check sooner if riding through peak summer heat.',
    intervalDays: 60,
  },
  'brake-pads': {
    label: 'Brake pad inspection',
    description: 'Check pad thickness and rotor wear. Shortened for dusty-trail grit wear.',
    intervalKm: 800,
  },
  'bolt-torque': {
    label: 'Safety bolt-torque check',
    description: 'Check torque on stem, seatpost, disc rotors, and thru-axles.',
    intervalDays: 90,
  },
  'fork-lowers': {
    label: 'Fork lower leg service',
    description: 'Clean and re-oil fork lower legs and seals. Shortened for dust ingress on dry singletrack.',
    intervalKm: 600,
  },
  'shock-service': {
    label: 'Shock & fork full service',
    description: 'Full air-can/damper rebuild (suspension specialist or home rebuild).',
    intervalDays: 365,
  },
  'pivot-bearings': {
    label: 'Pivot bearing check',
    description: 'Inspect and regrease rear-suspension pivot bearings. Shortened for grit ingress on dusty trails.',
    intervalDays: 120,
  },
};

const STATUS_RANK = { ok: 0, 'due-soon': 1, overdue: 2 };

export function daysBetween(fromISO, toISO) {
  const from = new Date(fromISO + 'T00:00:00Z');
  const to = new Date(toISO + 'T00:00:00Z');
  return Math.floor((to - from) / 86400000);
}

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Computes the current status of a single maintenance item.
// item: { id, lastServiceKm, lastServiceDate, lastNotifiedStatus }
// Returns null if the catalog entry is unknown.
export function computeItemStatus(item, bikeMileageKm, todayISO) {
  const catalog = MAINTENANCE_CATALOG[item.id];
  if (!catalog) return null;

  const ratios = [];
  const details = {};

  if (catalog.intervalKm != null) {
    const kmSince = bikeMileageKm - item.lastServiceKm;
    ratios.push(kmSince / catalog.intervalKm);
    details.kmSince = round1(kmSince);
    details.kmRemaining = round1(catalog.intervalKm - kmSince);
    details.dueAtKm = round1(item.lastServiceKm + catalog.intervalKm);
  }

  if (catalog.intervalDays != null) {
    const daysSince = daysBetween(item.lastServiceDate, todayISO);
    ratios.push(daysSince / catalog.intervalDays);
    details.daysSince = daysSince;
    details.daysRemaining = catalog.intervalDays - daysSince;
    details.dueAtDate = addDays(item.lastServiceDate, catalog.intervalDays);
  }

  const progress = Math.max(...ratios);
  let status = 'ok';
  if (progress >= 1) status = 'overdue';
  else if (progress >= 0.85) status = 'due-soon';

  return {
    id: item.id,
    label: catalog.label,
    description: catalog.description,
    intervalKm: catalog.intervalKm ?? null,
    intervalDays: catalog.intervalDays ?? null,
    progress,
    status,
    worseningSinceLastNotified: STATUS_RANK[status] > STATUS_RANK[item.lastNotifiedStatus ?? 'ok'],
    ...details,
  };
}

export function computeBikeStatus(bike, todayISO) {
  const items = bike.maintenanceItems.map((item) => computeItemStatus(item, bike.mileageKm, todayISO));
  return { ...bike, items };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
