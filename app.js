import { computeBikeStatus } from './src/rules.mjs';

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

  card.innerHTML = `
    <header class="bike-header">
      <div>
        <h2>${bike.name}</h2>
        <p class="bike-sub">${bike.fullName} · ${fmtMiles(bike.mileageKm)} mi · ${bike.totalActivities} rides</p>
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
      <p class="item-meta">${itemSubtext(item)}</p>
    `;
    list.appendChild(li);
  }

  return card;
}

async function main() {
  const res = await fetch('./data/bikes.json');
  const data = await res.json();
  const today = new Date().toISOString().slice(0, 10);

  document.getElementById('last-synced').textContent = `Last synced from Garmin: ${data.lastSynced}`;

  const root = document.getElementById('bikes');
  for (const bike of data.bikes) {
    root.appendChild(renderBike(bike, today));
  }
}

main();
