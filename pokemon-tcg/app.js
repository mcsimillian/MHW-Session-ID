'use strict';

const API_BASE   = 'https://api.pokemontcg.io/v2/cards';
const PAGE_SIZE  = 250;
const CACHE_KEY  = 'ptcg-ir-sir-cards-v1';
const CACHE_TTL  = 24 * 60 * 60 * 1000; // 24 hours
const OWNED_KEY  = 'ptcg-owned-cards-v1';

// ── State ──────────────────────────────────────────────────────
let allCards  = [];
let ownedSet  = new Set(JSON.parse(localStorage.getItem(OWNED_KEY) || '[]'));

const filters = { rarity: 'all', owned: 'all', set: '', search: '' };

// ── DOM refs ───────────────────────────────────────────────────
const $loading     = document.getElementById('loading');
const $loadingMsg  = document.getElementById('loading-msg');
const $grid        = document.getElementById('card-grid');
const $resultBar   = document.getElementById('result-bar');
const $resultCount = document.getElementById('result-count');
const $search      = document.getElementById('search');
const $setFilter   = document.getElementById('set-filter');
const $ownedCount  = document.getElementById('owned-count');
const $totalCount  = document.getElementById('total-count');
const $progressFill= document.getElementById('progress-fill');
const $modalOverlay= document.getElementById('modal-overlay');
const $modalImg    = document.getElementById('modal-img');
const $modalName   = document.getElementById('modal-name');
const $modalSet    = document.getElementById('modal-set');
const $modalNumber = document.getElementById('modal-number');
const $modalArtist = document.getElementById('modal-artist');
const $modalTypes  = document.getElementById('modal-types');
const $modalRarity = document.getElementById('modal-rarity');
const $modalOwnBtn = document.getElementById('modal-own-btn');
const $modalClose  = document.getElementById('modal-close');

let modalCardId = null;

// ── API ────────────────────────────────────────────────────────
async function fetchAllForRarity(rarity) {
  let page = 1, cards = [], total = Infinity;

  while (cards.length < total) {
    const q   = encodeURIComponent(`rarity:"${rarity}"`);
    const url = `${API_BASE}?q=${q}&pageSize=${PAGE_SIZE}&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    total = json.totalCount;
    cards.push(...json.data);
    if (json.data.length < PAGE_SIZE) break;
    page++;
  }

  return cards;
}

async function loadAllCards() {
  // Check cache
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.cards;
    }
  } catch (_) { /* ignore corrupted cache */ }

  $loadingMsg.textContent = 'Fetching Illustration Rares…';
  const ir = await fetchAllForRarity('Illustration Rare');

  $loadingMsg.textContent = 'Fetching Special Illustration Rares…';
  const sir = await fetchAllForRarity('Special Illustration Rare');

  const cards = [...ir, ...sir].sort((a, b) => {
    const setDiff = (a.set?.releaseDate || '').localeCompare(b.set?.releaseDate || '');
    if (setDiff !== 0) return setDiff;
    return String(a.number || '').localeCompare(String(b.number || ''), undefined, { numeric: true });
  });

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), cards }));
  } catch (_) { /* storage full, skip caching */ }

  return cards;
}

// ── Filtering ──────────────────────────────────────────────────
function getFiltered() {
  const q = filters.search.toLowerCase();
  return allCards.filter(c => {
    if (filters.rarity === 'ir'  && c.rarity !== 'Illustration Rare')         return false;
    if (filters.rarity === 'sir' && c.rarity !== 'Special Illustration Rare') return false;
    if (filters.set && c.set?.id !== filters.set)                             return false;
    if (filters.owned === 'owned'   && !ownedSet.has(c.id))                  return false;
    if (filters.owned === 'missing' &&  ownedSet.has(c.id))                  return false;
    if (q && !c.name.toLowerCase().includes(q))                              return false;
    return true;
  });
}

// ── Rendering ──────────────────────────────────────────────────
function cardHTML(c) {
  const owned  = ownedSet.has(c.id);
  const isIR   = c.rarity === 'Illustration Rare';
  const rarKey = isIR ? 'ir' : 'sir';
  const rarLbl = isIR ? 'IR' : 'SIR';
  const img    = c.images?.small || c.images?.large || '';

  return `
    <div class="card ${owned ? 'owned' : ''}" data-id="${c.id}">
      <div class="card-img-wrap">
        <img src="${img}" alt="${escHtml(c.name)}" loading="lazy" onerror="this.style.opacity=0">
        <div class="card-hover-overlay">
          <span class="hover-icon">${owned ? '✓' : '+'}</span>
          <span>${owned ? 'Remove' : 'Mark owned'}</span>
        </div>
        <div class="owned-ribbon">OWNED</div>
        <button class="info-btn" data-action="info" title="Details">ℹ</button>
      </div>
      <div class="card-info">
        <div class="card-name">${escHtml(c.name)}</div>
        <div class="card-meta">
          <span class="card-set-name">${escHtml(c.set?.name || '')}</span>
          <span class="rarity-tag ${rarKey}">${rarLbl}</span>
        </div>
      </div>
    </div>`;
}

function render() {
  const filtered = getFiltered();
  $resultCount.textContent = filtered.length;
  $resultBar.classList.remove('hidden');

  if (filtered.length === 0) {
    $grid.innerHTML = '<div class="no-results">No cards match your filters.</div>';
    return;
  }

  $grid.innerHTML = filtered.map(cardHTML).join('');
}

// ── Stats ──────────────────────────────────────────────────────
function updateStats() {
  const total = allCards.length;
  const owned = allCards.filter(c => ownedSet.has(c.id)).length;
  $ownedCount.textContent  = owned;
  $totalCount.textContent  = total;
  $progressFill.style.width = total ? `${(owned / total) * 100}%` : '0%';
}

// ── Collection ─────────────────────────────────────────────────
function toggleOwned(id) {
  if (ownedSet.has(id)) {
    ownedSet.delete(id);
  } else {
    ownedSet.add(id);
  }
  localStorage.setItem(OWNED_KEY, JSON.stringify([...ownedSet]));
  updateStats();
}

function applyCardOwned(id) {
  const el = $grid.querySelector(`.card[data-id="${id}"]`);
  if (!el) return;
  const owned = ownedSet.has(id);
  el.classList.toggle('owned', owned);
  const icon = el.querySelector('.hover-icon');
  const lbl  = el.querySelector('.card-hover-overlay span:last-child');
  if (icon) icon.textContent = owned ? '✓' : '+';
  if (lbl)  lbl.textContent  = owned ? 'Remove' : 'Mark owned';

  // Remove from view if a restrictive filter is active
  if ((filters.owned === 'missing' && owned) || (filters.owned === 'owned' && !owned)) {
    el.remove();
    $resultCount.textContent = Number($resultCount.textContent) - 1;
  }
}

// ── Set filter population ──────────────────────────────────────
function populateSets() {
  const seen = new Map();
  allCards.forEach(c => {
    if (c.set?.id && !seen.has(c.set.id)) {
      seen.set(c.set.id, { name: c.set.name, date: c.set.releaseDate || '' });
    }
  });

  const sorted = [...seen.entries()].sort((a, b) => a[1].date.localeCompare(b[1].date));

  sorted.forEach(([id, { name }]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name;
    $setFilter.appendChild(opt);
  });
}

// ── Modal ──────────────────────────────────────────────────────
function openModal(id) {
  const c = allCards.find(x => x.id === id);
  if (!c) return;
  modalCardId = id;

  const isIR = c.rarity === 'Illustration Rare';
  $modalImg.src       = c.images?.large || c.images?.small || '';
  $modalImg.alt       = c.name;
  $modalName.textContent   = c.name;
  $modalSet.textContent    = c.set?.name || '—';
  $modalNumber.textContent = c.number  || '—';
  $modalArtist.textContent = c.artist  || '—';
  $modalTypes.textContent  = (c.types || []).join(', ') || '—';
  $modalRarity.textContent = isIR ? 'Illustration Rare' : 'Special Illustration Rare';
  $modalRarity.className   = `modal-rarity-badge ${isIR ? 'ir' : 'sir'}`;
  syncModalOwnBtn();

  $modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function syncModalOwnBtn() {
  const owned = ownedSet.has(modalCardId);
  $modalOwnBtn.textContent = owned ? '✓ Owned' : '+ Mark as Owned';
  $modalOwnBtn.classList.toggle('owned', owned);
}

function closeModal() {
  $modalOverlay.classList.add('hidden');
  document.body.style.overflow = '';
  modalCardId = null;
}

// ── Events ─────────────────────────────────────────────────────
$grid.addEventListener('click', e => {
  const infoBtn = e.target.closest('[data-action="info"]');
  if (infoBtn) {
    e.stopPropagation();
    const id = infoBtn.closest('.card').dataset.id;
    openModal(id);
    return;
  }

  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  toggleOwned(id);
  applyCardOwned(id);
});

$modalOwnBtn.addEventListener('click', () => {
  if (!modalCardId) return;
  toggleOwned(modalCardId);
  syncModalOwnBtn();
  applyCardOwned(modalCardId);
});

$modalClose.addEventListener('click', closeModal);
$modalOverlay.addEventListener('click', e => { if (e.target === $modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

$search.addEventListener('input', () => { filters.search = $search.value.trim(); render(); });
$setFilter.addEventListener('change', () => { filters.set = $setFilter.value; render(); });

document.getElementById('rarity-filters').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('#rarity-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filters.rarity = btn.dataset.rarity;
  render();
});

document.getElementById('owned-filters').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('#owned-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filters.owned = btn.dataset.owned;
  render();
});

document.getElementById('clear-btn').addEventListener('click', () => {
  if (!confirm('Clear your entire collection? This cannot be undone.')) return;
  ownedSet.clear();
  localStorage.removeItem(OWNED_KEY);
  updateStats();
  render();
});

// ── Boot ───────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

(async () => {
  try {
    allCards = await loadAllCards();
    populateSets();
    updateStats();
    render();

    $loading.classList.add('hidden');
    $grid.classList.remove('hidden');
  } catch (err) {
    $loadingMsg.textContent = '';
    $loading.innerHTML += `
      <p style="color:#f87171;margin-top:1rem">Failed to load cards: ${escHtml(err.message)}</p>
      <button onclick="location.reload()"
              style="margin-top:1rem;padding:.5rem 1.2rem;cursor:pointer;
                     background:var(--surface2);border:1px solid var(--border);
                     color:var(--text);border-radius:8px;font-size:.9rem">
        Retry
      </button>`;
  }
})();
