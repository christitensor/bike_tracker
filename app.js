import { computeBikeStatus } from './src/rules.mjs';

// Fetched fresh on every load so the dashboard reflects the latest Garmin
// sync without needing a redeploy — GitHub raw serves CORS-enabled JSON.
const DATA_URL =
  'https://raw.githubusercontent.com/christitensor/bike_tracker/claude/bike-maintenance-tracker-0s7qq4/data/bikes.json';

const KM_TO_MI = 0.621371;

function fmtMiles(km) {
  return (km * KM_TO_MI).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function statusLabel(status) {
  if (status === 'overdue') return 'Overdue';
  if (status === 'due-soon') return 'Due soon';
  return 'OK';
}

function itemSubtext(item) {
  const parts = [];
  if (item.kmRemaining != null) {
    parts.push(
      item.kmRemaining >= 0
        ? `${fmtMiles(item.kmRemaining)} mi left`
        : `${fmtMiles(-item.kmRemaining)} mi overdue`
    );
  }
  if (item.daysRemaining != null) {
    parts.push(
      item.daysRemaining >= 0 ? `${item.daysRemaining}d left` : `${-item.daysRemaining}d overdue`
    );
  }
  return parts.join(' · ');
}

function renderBike(bike, todayISO) {
  const evaluated = computeBikeStatus(bike, todayISO);
  const card = document.createElement('section');
  card.className = 'bike-card';

  const worst = evaluated.items.reduce((acc, it) => {
    const rank = { ok: 0, 'due-soon': 1, overdue: 2 };
    return rank[it.status] > rank[acc] ? it.status : acc;
  }, 'ok');

  const mileageItems = evaluated.items.filter((it) => it.kmRemaining != null);
  const nextUp = mileageItems.length
    ? mileageItems.reduce((a, b) => (a.kmRemaining < b.kmRemaining ? a : b))
    : null;
  const nextUpText = nextUp
    ? nextUp.kmRemaining >= 0
      ? `${fmtMiles(nextUp.kmRemaining)} mi to ${nextUp.label}`
      : `${fmtMiles(-nextUp.kmRemaining)} mi overdue for ${nextUp.label}`
    : '';

  card.innerHTML = `
    <header class="bike-header">
      <div>
        <h2>${bike.name}</h2>
        <p class="bike-sub">${bike.fullName} · ${fmtMiles(bike.mileageKm)} mi · ${bike.totalActivities} rides</p>
        ${nextUpText ? `<p class="bike-next">${nextUpText}</p>` : ''}
      </div>
      <span class="pill pill-${worst}">${statusLabel(worst)}</span>
    </header>
    <ul class="item-list"></ul>
  `;

  const list = card.querySelector('.item-list');
  for (const item of evaluated.items) {
    const li = document.createElement('li');
    li.className = `item item-${item.status}`;
    li.innerHTML = `
      <div class="item-main">
        <span class="item-label">${item.label}</span>
        <span class="pill pill-${item.status} pill-sm">${statusLabel(item.status)}</span>
      </div>
      <p class="item-desc">${item.description}</p>
      ${item.note ? `<p class="item-note">${item.note}</p>` : ''}
      <p class="item-meta">${itemSubtext(item)}</p>
    `;
    list.appendChild(li);
  }

  return card;
}

async function main() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
  const data = await res.json();
  const today = new Date().toISOString().slice(0, 10);

  document.getElementById('last-synced').textContent = `Last synced from Garmin: ${data.lastSynced}`;

  const root = document.getElementById('bikes');
  for (const bike of data.bikes) {
    root.appendChild(renderBike(bike, today));
  }
}

main();
