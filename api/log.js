// Vercel serverless function: logs a completed maintenance item straight
// from the dashboard by committing the update to data/bikes.json via the
// GitHub Contents API.
//
// Required env vars (Vercel project settings, never exposed to the browser):
//   GITHUB_TOKEN    GitHub token with contents:write on this repo
//   LOG_PASSPHRASE  shared secret the dashboard must send in the
//                   `x-log-key` header; requests are refused if it's unset
import { timingSafeEqual, createHash } from 'node:crypto';

const GITHUB_OWNER = 'christitensor';
const GITHUB_REPO = 'bike_tracker';
const GITHUB_BRANCH = 'claude/bike-maintenance-tracker-0s7qq4';
const DATA_PATH = 'data/bikes.json';
const CONTENTS_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`;

// Allowlists for the posted body. Keep in sync with data/bikes.json and
// MAINTENANCE_CATALOG in src/rules.mjs. The handler additionally checks
// that the item actually exists on that bike in the current data.
const KNOWN_BIKE_IDS = new Set(['mog', 'spark']);
const KNOWN_ITEM_IDS = new Set([
  'chain-wax',
  'chain-wear',
  'sealant-refresh',
  'brake-pads',
  'bolt-torque',
  'fork-lowers',
  'shock-service',
  'pivot-bearings',
]);

// Constant-time comparison. Hashing both sides first gives equal-length
// buffers, so timingSafeEqual never throws and length isn't leaked.
function secretsMatch(provided, expected) {
  const a = createHash('sha256').update(String(provided), 'utf8').digest();
  const b = createHash('sha256').update(String(expected), 'utf8').digest();
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Fail closed: without a configured passphrase nobody can log.
  const passphrase = process.env.LOG_PASSPHRASE;
  if (!passphrase) {
    console.error('api/log: LOG_PASSPHRASE is not configured; refusing request.');
    res.status(500).json({ error: 'Logging is not configured on the server.' });
    return;
  }

  const providedKey = req.headers['x-log-key'];
  if (typeof providedKey !== 'string' || !providedKey || !secretsMatch(providedKey, passphrase)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('api/log: GITHUB_TOKEN is not configured.');
    res.status(500).json({ error: 'Logging is not configured on the server.' });
    return;
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Expected a JSON body.' });
    return;
  }
  const { bikeId, itemId } = body;
  if (typeof bikeId !== 'string' || typeof itemId !== 'string') {
    res.status(400).json({ error: 'bikeId and itemId are required strings.' });
    return;
  }
  if (!KNOWN_BIKE_IDS.has(bikeId)) {
    res.status(400).json({ error: 'Unknown bike.' });
    return;
  }
  if (!KNOWN_ITEM_IDS.has(itemId)) {
    res.status(400).json({ error: 'Unknown maintenance item.' });
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'bike-tracker-dashboard',
  };

  try {
    const getRes = await fetch(`${CONTENTS_URL}?ref=${GITHUB_BRANCH}`, { headers });
    if (!getRes.ok) {
      console.error(`api/log: failed to read bikes.json (${getRes.status}):`, await getRes.text());
      res.status(502).json({ error: 'Failed to read maintenance data.' });
      return;
    }
    const file = await getRes.json();
    const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));

    const bike = data.bikes.find((b) => b.id === bikeId);
    if (!bike) {
      res.status(404).json({ error: 'Unknown bike.' });
      return;
    }
    const item = bike.maintenanceItems.find((i) => i.id === itemId);
    if (!item) {
      res.status(404).json({ error: 'That item is not tracked for this bike.' });
      return;
    }
    if (typeof bike.mileageKm !== 'number' || !Number.isFinite(bike.mileageKm) || bike.mileageKm < 0) {
      console.error(`api/log: bike ${bikeId} has invalid mileageKm:`, bike.mileageKm);
      res.status(500).json({ error: 'Maintenance data is invalid; not logging.' });
      return;
    }

    item.lastServiceKm = bike.mileageKm;
    item.lastServiceDate = new Date().toISOString().slice(0, 10);
    item.lastNotifiedStatus = 'ok';

    const putRes = await fetch(CONTENTS_URL, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Log ${itemId} for ${bike.name} via dashboard`,
        content: Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64'),
        sha: file.sha,
        branch: GITHUB_BRANCH,
      }),
    });

    if (!putRes.ok) {
      console.error(`api/log: failed to save bikes.json (${putRes.status}):`, await putRes.text());
      res.status(502).json({ error: 'Failed to save maintenance data.' });
      return;
    }

    res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error('api/log: unexpected error:', err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
}
