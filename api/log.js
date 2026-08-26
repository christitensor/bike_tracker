// Vercel serverless function: logs a completed maintenance item straight
// from the dashboard by committing the update to data/bikes.json via the
// GitHub Contents API. Requires a GITHUB_TOKEN env var (repo contents:write)
// configured in the Vercel project — never exposed to the browser.
const GITHUB_OWNER = 'christitensor';
const GITHUB_REPO = 'bike_tracker';
const GITHUB_BRANCH = 'claude/bike-maintenance-tracker-0s7qq4';
const DATA_PATH = 'data/bikes.json';
const CONTENTS_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Server is missing GITHUB_TOKEN.' });
    return;
  }

  const { bikeId, itemId } = req.body ?? {};
  if (!bikeId || !itemId) {
    res.status(400).json({ error: 'bikeId and itemId are required.' });
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
      res.status(502).json({ error: `Failed to read bikes.json (${getRes.status}): ${await getRes.text()}` });
      return;
    }
    const file = await getRes.json();
    const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));

    const bike = data.bikes.find((b) => b.id === bikeId);
    if (!bike) {
      res.status(404).json({ error: `Unknown bike: ${bikeId}` });
      return;
    }
    const item = bike.maintenanceItems.find((i) => i.id === itemId);
    if (!item) {
      res.status(404).json({ error: `Unknown maintenance item: ${itemId}` });
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
      res.status(502).json({ error: `Failed to save bikes.json (${putRes.status}): ${await putRes.text()}` });
      return;
    }

    res.status(200).json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message ?? 'Unknown error' });
  }
}
