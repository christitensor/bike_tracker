import { computeBikeStatus } from './src/rules.mjs';

// Fetched fresh on every load so the dashboard reflects the latest Garmin
// sync without needing a redeploy — GitHub raw serves CORS-enabled JSON.
const DATA_URL =
  'https://raw.githubusercontent.com/christitensor/bike_tracker/claude/bike-maintenance-tracker-0s7qq4/data/bikes.json';

// Build/geo info changes rarely (only when a component gets swapped), so
// this is served straight from the repo instead of GitHub raw — no live
// sync needed, just a normal deploy when it's edited.
const BIKE_INFO_URL = './data/bike-info.json';

const KM_TO_MI = 0.621371;

// Everything rendered from data files goes through esc() before it touches
// innerHTML, so a stray `<` or a malicious string in bikes.json /
// bike-info.json can never become markup.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Only absolute http(s) URLs are allowed as link targets (no javascript:,
// data:, etc.). Returns the normalized href, or null if not allowed.
function safeHttpUrl(href) {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// Renders a note that may contain <a href="..."> links (e.g. the
// geometryNote fields in bike-info.json) without ever injecting the string
// as HTML. It's parsed into an inert document (DOMParser doesn't run
// scripts or load resources), then rebuilt from scratch: text stays text,
// <a> with an http(s) href becomes a fresh anchor carrying only its text,
// and every other element is flattened to its text content.
function appendRichText(target, source) {
  const doc = new DOMParser().parseFromString(String(source ?? ''), 'text/html');
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.appendChild(document.createTextNode(child.textContent));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const href = child.tagName === 'A' ? safeHttpUrl(child.getAttribute('href')) : null;
        if (href) {
          const a = document.createElement('a');
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = child.textContent;
          target.appendChild(a);
        } else {
          walk(child);
        }
      }
    }
  };
  walk(doc.body);
  return target;
}

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
        <h2>${esc(bike.name)}</h2>
        <p class="bike-sub">${esc(bike.fullName)} · ${esc(fmtMiles(bike.mileageKm))} mi · ${esc(bike.totalActivities)} rides</p>
        ${nextUpText ? `<p class="bike-next">${esc(nextUpText)}</p>` : ''}
      </div>
      <span class="pill pill-${esc(worst)}">${esc(statusLabel(worst))}</span>
    </header>
    <ul class="item-list"></ul>
  `;

  const list = card.querySelector('.item-list');
  for (const item of evaluated.items) {
    const li = document.createElement('li');
    li.className = `item item-${item.status}`;
    li.innerHTML = `
      <div class="item-main">
        <span class="item-label">${esc(item.label)}</span>
        <span class="pill pill-${esc(item.status)} pill-sm">${esc(statusLabel(item.status))}</span>
      </div>
      <p class="item-desc">${esc(item.description)}</p>
      ${item.note ? `<p class="item-note">${esc(item.note)}</p>` : ''}
      <div class="item-footer">
        <p class="item-meta">${esc(itemSubtext(item))}</p>
        <button class="log-btn" data-bike="${esc(bike.id)}" data-item="${esc(item.id)}">Log done</button>
      </div>
    `;
    list.appendChild(li);
  }

  return card;
}

function renderBikeInfo(bike) {
  const card = document.createElement('section');
  card.className = 'bike-card';

  const geoRows = (bike.geometry ?? [])
    .map((g) => `<div class="spec-row"><span class="spec-label">${esc(g.label)}</span><span class="spec-value">${esc(g.value)}</span></div>`)
    .join('');

  card.innerHTML = `
    <header class="bike-header">
      <div>
        <h2>${esc(bike.name)}</h2>
        <p class="bike-sub">${esc(bike.fullName)}${bike.year ? ` · ${esc(bike.year)}` : ''}${bike.type ? ` · ${esc(bike.type)}` : ''}</p>
      </div>
    </header>
    ${geoRows ? `<div class="spec-group"><h3 class="spec-heading">Geometry</h3><div class="spec-list">${geoRows}</div>${bike.geometryNote ? '<p class="geo-note"></p>' : ''}</div>` : ''}
    <div class="spec-group">
      <h3 class="spec-heading">Build</h3>
      <ul class="build-list"></ul>
    </div>
    ${bike.note ? `<p class="item-note">${esc(bike.note)}</p>` : ''}
  `;

  // The geometry note carries source links, so it's built node-by-node
  // (http(s) anchors only) rather than injected as HTML.
  const geoNote = card.querySelector('.geo-note');
  if (geoNote) appendRichText(geoNote, bike.geometryNote);

  const buildList = card.querySelector('.build-list');
  for (const part of bike.build ?? []) {
    const li = document.createElement('li');
    li.className = 'build-item';
    li.innerHTML = `
      <span class="build-category">${esc(part.category)}</span>
      <span class="build-spec">${esc(part.spec)}</span>
      ${part.note ? `<span class="build-note">${esc(part.note)}</span>` : ''}
    `;
    buildList.appendChild(li);
  }

  return card;
}

function renderAllBikeInfo(data) {
  const root = document.getElementById('bike-info');
  root.innerHTML = '';
  for (const bike of data.bikes) {
    root.appendChild(renderBikeInfo(bike));
  }
}

async function loadBikeInfo() {
  try {
    const res = await fetch(BIKE_INFO_URL);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    renderAllBikeInfo(await res.json());
  } catch (err) {
    console.error('Failed to load bike info:', err);
    document.getElementById('bike-info').textContent = 'Error loading bike info';
  }
}

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      document.getElementById('maintenance-panel').hidden = btn.dataset.tab !== 'maintenance';
      document.getElementById('bike-info-panel').hidden = btn.dataset.tab !== 'bike-info';
    });
  });
}

function renderAll(data) {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('last-synced').textContent = `Last synced from Garmin: ${data.lastSynced}`;
  const root = document.getElementById('bikes');
  root.innerHTML = '';
  for (const bike of data.bikes) {
    root.appendChild(renderBike(bike, today));
  }
}

// After a successful /api/log, raw.githubusercontent.com can take a few
// seconds to reflect the new commit. Remember what we just wrote so the
// next fetch (manual refresh or a fresh page load) can tell a stale read
// apart from a real one and retry instead of flashing the old status.
const PENDING_LOG_KEY = 'bikeTracker.pendingLog';
const PENDING_LOG_MAX_AGE_MS = 3 * 60 * 1000;
const RETRY_DELAYS_MS = [800, 1500, 2500, 4000];

function rememberPendingLog(bikeId, itemId, item) {
  try {
    localStorage.setItem(
      PENDING_LOG_KEY,
      JSON.stringify({
        bikeId,
        itemId,
        expected: { lastServiceKm: item.lastServiceKm, lastServiceDate: item.lastServiceDate },
        at: Date.now(),
      })
    );
  } catch {
    // localStorage unavailable (private mode, etc.) — retries just won't kick in.
  }
}

function readPendingLog() {
  try {
    const raw = localStorage.getItem(PENDING_LOG_KEY);
    if (!raw) return null;
    const marker = JSON.parse(raw);
    if (Date.now() - marker.at > PENDING_LOG_MAX_AGE_MS) {
      localStorage.removeItem(PENDING_LOG_KEY);
      return null;
    }
    return marker;
  } catch {
    return null;
  }
}

function clearPendingLog() {
  try {
    localStorage.removeItem(PENDING_LOG_KEY);
  } catch {
    // ignore
  }
}

function dataReflectsPendingLog(data, marker) {
  const bike = data.bikes.find((b) => b.id === marker.bikeId);
  const item = bike?.maintenanceItems.find((i) => i.id === marker.itemId);
  return (
    !!item &&
    item.lastServiceKm === marker.expected.lastServiceKm &&
    item.lastServiceDate === marker.expected.lastServiceDate
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBikesData() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

async function loadAndRender() {
  try {
    let data = await fetchBikesData();

    const marker = readPendingLog();
    if (marker && !dataReflectsPendingLog(data, marker)) {
      for (const delay of RETRY_DELAYS_MS) {
        await sleep(delay);
        data = await fetchBikesData();
        if (dataReflectsPendingLog(data, marker)) break;
      }
    }
    if (marker && dataReflectsPendingLog(data, marker)) {
      clearPendingLog();
    }

    renderAll(data);
  } catch (err) {
    console.error('Failed to load data:', err);
    document.getElementById('last-synced').textContent = 'Error loading data';
  }
}

function initRefreshButton() {
  const btn = document.getElementById('refresh-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    await loadAndRender();
    btn.disabled = false;
    btn.style.opacity = '1';
  });
}

// /api/log requires a shared passphrase (LOG_PASSPHRASE on the server),
// sent as the x-log-key header. It's asked for once and remembered in this
// browser's localStorage; a 401 clears it and asks again.
const LOG_KEY_STORAGE = 'bikeTracker.logKey';

function getStoredLogKey() {
  try {
    return localStorage.getItem(LOG_KEY_STORAGE) || null;
  } catch {
    return null;
  }
}

function storeLogKey(key) {
  try {
    if (key) localStorage.setItem(LOG_KEY_STORAGE, key);
    else localStorage.removeItem(LOG_KEY_STORAGE);
  } catch {
    // localStorage unavailable — the key just won't be remembered.
  }
}

function promptForLogKey(message) {
  const entered = window.prompt(message);
  const key = entered ? entered.trim() : '';
  return key || null;
}

class LogCancelled extends Error {}

async function postLog(bikeId, itemId) {
  let key = getStoredLogKey() ?? promptForLogKey('Enter the logging passphrase:');
  // One initial attempt plus one re-prompt after a 401.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!key) throw new LogCancelled();
    const res = await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-log-key': key },
      body: JSON.stringify({ bikeId, itemId }),
    });
    if (res.status === 401) {
      storeLogKey(null);
      if (attempt > 0) throw new Error('Passphrase not accepted');
      key = promptForLogKey('Passphrase was not accepted. Try again:');
      continue;
    }
    // Anything other than 401 means the passphrase was accepted.
    storeLogKey(key);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }
  throw new LogCancelled();
}

async function handleLogClick(btn) {
  const { bike: bikeId, item: itemId } = btn.dataset;
  btn.disabled = true;
  btn.textContent = 'Logging…';
  try {
    const json = await postLog(bikeId, itemId);
    const loggedBike = json.data.bikes.find((b) => b.id === bikeId);
    const loggedItem = loggedBike?.maintenanceItems.find((i) => i.id === itemId);
    if (loggedItem) rememberPendingLog(bikeId, itemId, loggedItem);
    renderAll(json.data);
  } catch (err) {
    if (err instanceof LogCancelled) {
      btn.textContent = 'Log done';
    } else {
      console.error('Failed to log item:', err);
      btn.textContent = 'Failed — tap to retry';
    }
    btn.disabled = false;
  }
}

function initLogButtons() {
  document.getElementById('bikes').addEventListener('click', (e) => {
    const btn = e.target.closest('.log-btn');
    if (btn) handleLogClick(btn);
  });
}

loadAndRender();
initRefreshButton();
initLogButtons();
loadBikeInfo();
initTabs();
