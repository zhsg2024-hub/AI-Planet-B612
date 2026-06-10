/* ══════════════════════════════════════════════════════════════════════════
   WorldQuest — App.js  (UI glue layer)
   Wires AgentSystem callbacks → DOM updates
   Wires user events → AgentSystem.sendMessage / analyzePhoto / completeTask
   ══════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
   AGENT MONITOR UI
   ══════════════════════════════════════════════════════════════════════════ */

const _timerIntervals = {};   // entryId → intervalId

window.toggleMonitor = function() {
  document.getElementById('agent-monitor').classList.toggle('collapsed');
};

/* Auto-expand monitor panel — called when an agent starts */
function _autoExpandMonitor() {
  document.getElementById('agent-monitor').classList.remove('collapsed');
}

/* Update the small badge on the collapsed tab (total entries since session start) */
function _updateMonitorTabBadge() {
  const badge = document.getElementById('monitor-tab-badge');
  if (!badge) return;
  const total = AgentSystem.monitor.entries.length;
  if (total > 0) { badge.textContent = total; badge.classList.remove('hidden'); }
  else            { badge.classList.add('hidden'); }
}

/* Called by AgentSystem whenever an entry is added or updated */
window.UI = window.UI || {};
const _origUI = window.UI;

/* ── Agent Canvas HUD state ─────────────────────────────────────────────── */
let _hudTimerInterval = null;

function _updateAgentCanvasHUD() {
  const running = AgentSystem.monitor.entries.filter(e => e.status === 'running');
  const hud = document.getElementById('agent-canvas-hud');
  if (!hud) return;

  if (running.length === 0) {
    // Fade out then hide
    hud.classList.add('fading');
    setTimeout(() => { hud.classList.remove('fading'); hud.classList.add('hidden'); }, 420);
    if (_hudTimerInterval) { clearInterval(_hudTimerInterval); _hudTimerInterval = null; }
    return;
  }

  hud.classList.remove('hidden', 'fading');

  // Pipeline: show all entries (done as grey, running as blue pulsing)
  const allRecent = AgentSystem.monitor.entries.slice(0, 6).reverse();
  const pipelineEl = document.getElementById('achud-pipeline');
  pipelineEl.innerHTML = '';
  allRecent.forEach((e, i) => {
    const span = document.createElement('span');
    span.className = `achud-agent${e.status !== 'running' ? ' done' : ''}`;
    span.textContent = `${e.meta.icon} ${e.meta.label}`;
    pipelineEl.appendChild(span);
    if (i < allRecent.length - 1) {
      const arr = document.createElement('span');
      arr.className = 'achud-arrow';
      arr.textContent = '›';
      pipelineEl.appendChild(arr);
    }
  });

  // Show latest running entry's input
  const latest = running[running.length - 1];
  const inputEl = document.getElementById('achud-input');
  inputEl.textContent = latest.inputText?.slice(0, 60) + (latest.inputText?.length > 60 ? '…' : '') || '';

  // Live timer from earliest running start
  const earliest = running.reduce((a, b) => a.startMs < b.startMs ? a : b);
  const timerEl = document.getElementById('achud-timer');
  if (!_hudTimerInterval) {
    _hudTimerInterval = setInterval(() => {
      const active = AgentSystem.monitor.entries.filter(e => e.status === 'running');
      if (!active.length) { clearInterval(_hudTimerInterval); _hudTimerInterval = null; return; }
      const oldest = active.reduce((a, b) => a.startMs < b.startMs ? a : b);
      timerEl.textContent = ((Date.now() - oldest.startMs) / 1000).toFixed(1) + 's';
    }, 100);
  }
}

function _initMonitorCallbacks() {
  window.UI.onMonitorEntry = (entry, action) => {
    document.querySelector('.monitor-empty')?.remove();
    _updateRunningBadge();
    _updateAgentCanvasHUD();
    _updateMonitorTabBadge();

    if (action === 'add') {
      _renderMonitorEntry(entry);
      _autoExpandMonitor();   // auto-show panel when new agent starts
    } else {
      _refreshMonitorEntry(entry);
    }
  };

  window.UI.onMonitorClear = () => {
    document.getElementById('monitor-entries').innerHTML =
      '<div class="monitor-empty">Log cleared</div>';
    Object.values(_timerIntervals).forEach(clearInterval);
  };
}

function _renderMonitorEntry(entry) {
  // Remove empty placeholder
  document.querySelector('#monitor-entries .monitor-empty')?.remove();

  const el = document.createElement('div');
  el.className = `mon-entry running`;
  el.id = `mon-${entry.id}`;

  el.innerHTML = `
    <div class="mon-entry-header" onclick="toggleMonEntry('${entry.id}')">
      <span class="mon-agent-icon">${entry.meta.icon}</span>
      <span class="mon-agent-label">${entry.meta.label}</span>
      <span class="mon-status running">running</span>
      <span class="mon-timer" id="timer-${entry.id}">0.0s</span>
      <button class="mon-stop-btn" onclick="event.stopPropagation(); AgentSystem.abortEntry('${entry.id}')" title="Stop this agent">⛔ Stop</button>
    </div>
    <div class="mon-entry-body">
      <div class="mon-io">
        <div class="mon-io-block">
          <div class="mon-io-label">📥 INPUT</div>
          <div class="mon-io-text">${_esc(entry.inputText)}</div>
        </div>
        <div class="mon-io-block" id="mon-output-${entry.id}">
          <div class="mon-io-label">📤 OUTPUT</div>
          <div class="mon-io-text" style="color:var(--txt2)">Waiting for output…</div>
        </div>
      </div>
    </div>`;

  // Auto-expand running entries
  el.classList.add('expanded');

  document.getElementById('monitor-entries').prepend(el);

  // Live timer
  _timerIntervals[entry.id] = setInterval(() => {
    const timerEl = document.getElementById(`timer-${entry.id}`);
    if (timerEl) timerEl.textContent = ((Date.now() - entry.startMs) / 1000).toFixed(1) + 's';
  }, 100);
}

function _refreshMonitorEntry(entry) {
  const el = document.getElementById(`mon-${entry.id}`);
  if (!el) return;

  // Stop timer
  clearInterval(_timerIntervals[entry.id]);
  delete _timerIntervals[entry.id];

  const duration = entry.endMs ? ((entry.endMs - entry.startMs) / 1000).toFixed(1) + 's' : '-';
  const statusLabels = { done:'done', error:'error', aborted:'aborted' };
  const statusLabel  = statusLabels[entry.status] || entry.status;

  // Update class & header
  el.className = `mon-entry ${entry.status}`;

  const statusEl = el.querySelector('.mon-status');
  if (statusEl) { statusEl.className = `mon-status ${entry.status}`; statusEl.textContent = statusLabel; }

  const timerEl = el.querySelector('.mon-timer');
  if (timerEl) timerEl.textContent = duration;

  // Remove stop button
  el.querySelector('.mon-stop-btn')?.remove();

  // Update output
  const outputEl = document.getElementById(`mon-output-${entry.id}`);
  if (outputEl) {
    const color = entry.status === 'error' ? '#ff6060' : entry.status === 'aborted' ? '#ffc800' : 'var(--txt)';
    outputEl.innerHTML = `
      <div class="mon-io-label">📤 OUTPUT</div>
      <div class="mon-io-text" style="color:${color}">${_esc(entry.outputText || '(empty)')}</div>`;
  }

  _updateRunningBadge();
}

window.toggleMonEntry = function(id) {
  document.getElementById(`mon-${id}`)?.classList.toggle('expanded');
};

function _updateRunningBadge() {
  const runningCount = AgentSystem.monitor.entries.filter(e => e.status === 'running').length;
  const badge = document.getElementById('monitor-running-badge');
  const dot   = document.querySelector('.monitor-dot');
  if (badge) {
    badge.textContent = `${runningCount} running`;
    badge.classList.toggle('hidden', runningCount === 0);
  }
  if (dot) dot.classList.toggle('running', runningCount > 0);
}

/* ══════════════════════════════════════════════════════════════════════════
   CATEGORY METADATA — single source of truth for all 20 categories.
   Every lookup (gallery / planet stats / vision prompt / 3D color) reads here.
   ══════════════════════════════════════════════════════════════════════════ */
const CATEGORIES = {
  // ── CIV (built environment / signs / tech) ─────────────────────────────
  landmark:       { emoji:'🗺️',  label:'Landmarks',   group:'civ',     color:0x5c9eff, hint:'Iconic landmarks — Merlion, MBS, Supertrees, Sands SkyPark, etc.' },
  building:       { emoji:'🏢',  label:'Buildings',   group:'civ',     color:0x90a4ae, hint:'Buildings — HDB flats, offices, malls, shophouses' },
  religion:       { emoji:'⛩️',  label:'Sacred Sites',group:'civ',     color:0xd4a574, hint:'Temples / mosques / churches / Indian temples' },
  sign:           { emoji:'🪧',  label:'Signs',       group:'civ',     color:0x80deea, hint:'Street signs, shop signs, posters, menus' },
  transportation: { emoji:'🚌',  label:'Transport',   group:'civ',     color:0xf44336, hint:'Buses, MRT, taxis, boats, cable cars, bicycles' },
  technology:     { emoji:'📱',  label:'Tech',        group:'civ',     color:0x4dd0e1, hint:'Screens, kiosks, robots, electronic devices' },

  // ── ECO (living world) ────────────────────────────────────────────────
  plant:          { emoji:'🌿',  label:'Plants',      group:'eco',     color:0x66bb6a, hint:'Trees, shrubs, palms, tropical plants' },
  flower:         { emoji:'🌸',  label:'Flowers',     group:'eco',     color:0xff80ab, hint:'Orchids, bougainvillea, frangipani — close-up blooms' },
  animal:         { emoji:'🦊',  label:'Wildlife',    group:'eco',     color:0xff8a65, hint:'Mammals / birds — cats, squirrels, herons, orangutans' },
  insect:         { emoji:'🦋',  label:'Insects',     group:'eco',     color:0xab47bc, hint:'Butterflies, dragonflies, bees, ladybugs' },
  sea_creature:   { emoji:'🐠',  label:'Sea Life',    group:'eco',     color:0x29b6f6, hint:'Fish, crabs, shells, aquarium creatures' },
  fruit:          { emoji:'🥭',  label:'Fruits',      group:'eco',     color:0xffca28, hint:'Durian, mango, coconut, pineapple, dragon fruit' },

  // ── CULTURE (food / drinks / cultural creations) ──────────────────────
  food:           { emoji:'🍜',  label:'Cuisine',     group:'culture', color:0xffb74d, hint:'Mains — Hainanese chicken rice, laksa, char kway teow, satay' },
  dessert:        { emoji:'🍡',  label:'Desserts',    group:'culture', color:0xf48fb1, hint:'Cold sweets — Ice Kacang, Chendol, cakes, ice cream' },
  drink:          { emoji:'☕',  label:'Drinks',      group:'culture', color:0x8d6e63, hint:'Kopi / Teh / Bandung / juices / bubble tea' },
  snack:          { emoji:'🍪',  label:'Snacks',      group:'culture', color:0xffcc80, hint:'Kaya toast / curry puffs / street snacks / packaged treats' },
  person:         { emoji:'👤',  label:'People',      group:'culture', color:0xef9a9a, hint:'Passersby, street performers, shop owners' },
  art:            { emoji:'🎨',  label:'Art',         group:'culture', color:0xe040fb, hint:'Paintings, sculptures, murals, street graffiti, installations' },
  fashion:        { emoji:'👗',  label:'Fashion',     group:'culture', color:0xff6e90, hint:'Traditional wear (sarong, baju kurung), window fashion' },
  souvenir:       { emoji:'🎁',  label:'Souvenirs',   group:'culture', color:0xffc107, hint:'Keychains, postcards, plushies, brand merch' },
};

const CATEGORY_KEYS = Object.keys(CATEGORIES);
const CATEGORY_FALLBACK = { emoji:'💎', label:'Mystery Find', group:'other', color:0xce93d8, hint:'Unclassified' };

function _catMeta(cat)  { return CATEGORIES[cat] || CATEGORY_FALLBACK; }
function _catLabel(cat) { return _catMeta(cat).label; }
function _catGroup(cat) { return _catMeta(cat).group; }

/* ══════════════════════════════════════════════════════════════════════════
   GALLERY  — photo collection organised by category
   ══════════════════════════════════════════════════════════════════════════ */

const GALLERY_CATS = CATEGORY_KEYS.map(key => ({
  key,
  emoji: CATEGORIES[key].emoji,
  label: CATEGORIES[key].label,
}));

/* ── Tabbed gallery: one tab per category, content grid below ──────────── */
// galleryState[cat] = { tabEl, contentEl, gridEl, count }
const galleryState = {};
let activeGphoto    = null;     // currently highlighted photo card
let _activeGalleryTab = null;   // currently visible category key

function _initGalleryTabs() {
  const tabsBar    = document.getElementById('gallery-tabs');
  const contentBox = document.getElementById('gallery-content');
  if (!tabsBar || !contentBox) return;

  // Create one tab + one (initially empty) content panel per category
  GALLERY_CATS.forEach(catDef => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'gtab empty';
    tab.dataset.cat = catDef.key;
    tab.title = catDef.label;
    tab.innerHTML = `
      <span class="gtab-icon">${catDef.emoji}</span>
      <span class="gtab-label">${catDef.label}</span>
      <span class="gtab-count">0</span>`;
    tab.addEventListener('click', () => _switchGalleryTab(catDef.key));
    tabsBar.appendChild(tab);

    const content = document.createElement('div');
    content.className = 'gcontent hidden';
    content.dataset.cat = catDef.key;

    const grid = document.createElement('div');
    grid.className = 'gphoto-grid';
    content.appendChild(grid);

    const empty = document.createElement('div');
    empty.className = 'gcontent-empty';
    empty.innerHTML = `
      <div class="gce-icon">${catDef.emoji}</div>
      <div class="gce-text">No <b>${catDef.label}</b> yet</div>
      <div class="gce-sub">Snap a photo and let the fox identify it</div>`;
    content.appendChild(empty);

    contentBox.appendChild(content);

    galleryState[catDef.key] = { tabEl: tab, contentEl: content, gridEl: grid, emptyEl: empty, count: 0 };
  });

  // No tab is active initially — first item added will trigger one
  _switchGalleryTab(GALLERY_CATS[0].key);
}

function _switchGalleryTab(cat) {
  if (!galleryState[cat]) return;
  // Deactivate previous
  if (_activeGalleryTab && galleryState[_activeGalleryTab]) {
    galleryState[_activeGalleryTab].tabEl.classList.remove('active');
    galleryState[_activeGalleryTab].contentEl.classList.add('hidden');
  }
  // Activate new
  _activeGalleryTab = cat;
  const state = galleryState[cat];
  state.tabEl.classList.remove('new-flash');
  state.tabEl.classList.add('active');
  state.contentEl.classList.remove('hidden');
  // Scroll active tab into view in the horizontal tab bar
  state.tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

function galleryAddItem(item) {
  const cat    = item.category || 'landmark';
  const catDef = GALLERY_CATS.find(c => c.key === cat) || GALLERY_CATS[0];
  const state  = galleryState[cat];
  if (!state) return;       // unknown category — ignore (safety)

  // Tab activates visually now that it has content
  state.count++;
  state.tabEl.classList.remove('empty');
  state.tabEl.querySelector('.gtab-count').textContent = state.count;
  state.emptyEl.classList.add('hidden');

  // Build the photo card (vertical layout: thumb on top, name below)
  const card = document.createElement('div');
  card.className = 'gphoto';
  card.dataset.name = item.name;

  const thumb = item.photoSrc
    ? `<img class="gphoto-thumb" src="${item.photoSrc}" alt="${item.name}">`
    : `<div class="gphoto-thumb-placeholder">${catDef.emoji}</div>`;

  card.innerHTML = `
    <div class="gphoto-thumb-wrap">
      ${thumb}
      <button class="gphoto-del" title="Delete" onclick="event.stopPropagation(); _showDeleteConfirm(this.closest('.gphoto'), '${_esc(item.name)}')">🗑</button>
    </div>
    <div class="gphoto-info">
      <div class="gphoto-name">${item.name}</div>
      <div class="gphoto-loc">📍 ${item.location || ''}</div>
    </div>`;

  card.addEventListener('click',      () => _onGphotoClick(card, item));
  card.addEventListener('mouseenter', () => _onGphotoMouseEnter(card, item));
  card.addEventListener('mouseleave', () => _onGphotoMouseLeave(card, item));

  // Insert as FIRST card so newest is always at top of grid
  const firstCard = state.gridEl.querySelector('.gphoto');
  if (firstCard) {
    state.gridEl.insertBefore(card, firstCard);
  } else {
    state.gridEl.appendChild(card);
  }

  // If user isn't already viewing this tab, flash it to signal "new content"
  if (_activeGalleryTab !== cat) {
    state.tabEl.classList.add('new-flash');
    // Auto-switch on first item ever in this category (so user sees the reveal)
    if (state.count === 1) _switchGalleryTab(cat);
  }
}

/* ── Gallery card HOVER → highlight related 3D model on planet ────────── */
let _galleryHoveredName = null;

function _onGphotoMouseEnter(card, item) {
  _galleryHoveredName = item.name;
  SingaporeMap.highlightDiscoveredItem(item.name, true);
}

function _onGphotoMouseLeave(card, item) {
  if (_galleryHoveredName === item.name) _galleryHoveredName = null;
  // If a detail modal is currently open, fall back to highlighting that item.
  // Otherwise clear all highlights.
  if (_detailItemName && _detailItemName !== item.name) {
    SingaporeMap.highlightDiscoveredItem(_detailItemName, true);
  } else if (!_detailItemName) {
    SingaporeMap.highlightDiscoveredItem(item.name, false);
  }
}

/* ── Gallery card CLICK → open full info card (modal slides in from right) ── */
function _onGphotoClick(card, item) {
  // Deselect previous selection card visually
  if (activeGphoto && activeGphoto !== card) {
    activeGphoto.classList.remove('highlighted');
  }
  activeGphoto = card;
  card.classList.add('highlighted');

  // Keep the 3D highlight pinned to the clicked item (already on from hover)
  SingaporeMap.highlightDiscoveredItem(item.name, true);

  // Open the detailed item card (modal anchored to right; planet stays visible)
  window.openItemDetail(item.name);
}

/* ── Open full item detail modal ──────────────────────────────────────── */
let _detailItemName = null;

window.openItemDetail = function(itemName) {
  const ctx = AgentSystem.getCtx();
  const item = ctx.discovered.find(d => d.name === itemName);
  if (!item) return;
  _detailItemName = itemName;

  // Category
  const catEmoji = _categoryEmoji(item.category);
  const catName  = _catLabel(item.category);
  document.getElementById('idm-cat-emoji').textContent = catEmoji;
  document.getElementById('idm-cat-name').textContent  = catName;

  // Photo
  const img         = document.getElementById('idm-photo');
  const placeholder = document.getElementById('idm-photo-placeholder');
  if (item.photoSrc) {
    img.src = item.photoSrc;
    img.style.display = 'block';
    placeholder.classList.add('hidden');
  } else {
    img.style.display = 'none';
    placeholder.classList.remove('hidden');
    placeholder.textContent = catEmoji;
  }

  // Title & meta
  document.getElementById('idm-name').textContent     = item.name;
  document.getElementById('idm-name-en').textContent  = item.nameEn || '';
  document.getElementById('idm-location').textContent = `📍 ${item.location || 'Singapore'}`;
  const date = item.ts ? new Date(item.ts) : null;
  document.getElementById('idm-when').textContent = date
    ? `${date.getMonth() + 1}/${date.getDate()}  ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`
    : '';

  // User's note
  const noteWrap = document.getElementById('idm-user-note');
  const noteText = document.getElementById('idm-note-text');
  const noteTags = document.getElementById('idm-note-tags');
  const ctxStore = item.context || {};
  const hasNote  = item.mood && item.mood.trim().length > 0;
  const hasTags  = !!(ctxStore.time || ctxStore.weather || ctxStore.company);
  if (hasNote || hasTags) {
    noteWrap.classList.remove('hidden');
    noteText.textContent = hasNote ? item.mood : '(no text, but these tags were saved)';
    noteTags.innerHTML = '';
    const addTag = (emoji, val) => {
      if (!val) return;
      const s = document.createElement('span');
      s.className = 'idm-note-tag';
      s.textContent = `${emoji} ${val}`;
      noteTags.appendChild(s);
    };
    addTag('⏰', ctxStore.time);
    addTag('🌤️', ctxStore.weather);
    addTag('👥', ctxStore.company);
  } else {
    noteWrap.classList.add('hidden');
  }

  // Category details (reuse same logic, but render into idm-details)
  const detailsContainer = document.getElementById('idm-details');
  const savedDetailsContainer = document.getElementById('pm-details');
  // Temp-swap the target id so _renderDetails writes to idm-details
  detailsContainer.id = 'pm-details';
  if (savedDetailsContainer) savedDetailsContainer.id = 'pm-details-orig';
  _renderDetails(item.category, item.details || {});
  detailsContainer.id = 'idm-details';
  if (document.getElementById('pm-details-orig')) document.getElementById('pm-details-orig').id = 'pm-details';

  // Fox's insight (story)
  document.getElementById('idm-story-text').textContent = item.story || '';

  // Delete button — same as gallery card delete
  const delBtn = document.getElementById('idm-btn-del');
  delBtn.onclick = () => {
    if (!confirm(`Remove "${item.name}" from your planet?`)) return;
    window._deleteItem(item.name);
    window.closeItemDetail();
  };

  document.getElementById('item-detail-modal').classList.remove('hidden');
};

window.closeItemDetail = function() {
  document.getElementById('item-detail-modal').classList.add('hidden');
  // Clear map highlight
  if (_detailItemName) {
    SingaporeMap.highlightDiscoveredItem(_detailItemName, false);
    _detailItemName = null;
  }
  if (activeGphoto) {
    activeGphoto.classList.remove('highlighted');
    activeGphoto = null;
  }
};

/* ── Floating hover preview for discovered 3D models ──────────────────── */
let _dhcCurrentName = null;
let _dhcLastClient  = { x: 0, y: 0 };

function _showDhc(itemName, clientX, clientY) {
  const ctx = AgentSystem.getCtx();
  const item = ctx.discovered.find(d => d.name === itemName);
  if (!item) return;
  if (_dhcCurrentName !== itemName) {
    _dhcCurrentName = itemName;

    const catEmoji = _categoryEmoji(item.category);
    const catName  = _catLabel(item.category);

    const img = document.getElementById('dhc-photo');
    const fallback = document.getElementById('dhc-photo-fallback');
    if (item.photoSrc) {
      img.src = item.photoSrc;
      img.style.display = 'block';
      fallback.classList.add('hidden');
    } else {
      img.style.display = 'none';
      fallback.classList.remove('hidden');
      fallback.textContent = catEmoji;
    }

    document.getElementById('dhc-cat').textContent     = `${catEmoji} ${catName}`;
    document.getElementById('dhc-name').textContent    = item.name;
    document.getElementById('dhc-name-en').textContent = item.nameEn || '';

    const date = item.ts ? new Date(item.ts) : null;
    const dateStr = date
      ? `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`
      : '';
    document.getElementById('dhc-meta').textContent = [
      item.location ? `📍 ${item.location}` : '',
      dateStr ? `· ${dateStr}` : '',
    ].filter(Boolean).join(' ');

    // Insight: first ~100 chars of story
    const insight = (item.story || '').slice(0, 110);
    document.getElementById('dhc-insight').textContent = insight
      ? (insight + (item.story.length > 110 ? '…' : ''))
      : '';
  }
  _positionDhc(clientX, clientY);
  const card = document.getElementById('discovered-hover-card');
  card.classList.remove('hidden');
  // next frame → trigger transition
  requestAnimationFrame(() => card.classList.add('show'));
}

function _hideDhc() {
  _dhcCurrentName = null;
  const card = document.getElementById('discovered-hover-card');
  card.classList.remove('show');
  setTimeout(() => {
    if (!_dhcCurrentName) card.classList.add('hidden');
  }, 140);
}

function _positionDhc(clientX, clientY) {
  _dhcLastClient = { x: clientX, y: clientY };
  const card = document.getElementById('discovered-hover-card');
  // Make visible-but-offscreen first to measure if size changed
  if (card.classList.contains('hidden')) return;

  const PAD = 14;
  const W = card.offsetWidth || 280;
  const H = card.offsetHeight || 100;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Default: bottom-right of cursor; flip if it would overflow
  let x = clientX + PAD;
  let y = clientY + PAD;
  if (x + W > vw - 8) x = clientX - W - PAD;
  if (y + H > vh - 8) y = clientY - H - PAD;
  if (x < 8) x = 8;
  if (y < 8) y = 8;

  card.style.left = x + 'px';
  card.style.top  = y + 'px';
}

/* Show inline delete confirmation on a gallery card */
window._showDeleteConfirm = function(card, itemName) {
  // Remove any existing confirm
  card.querySelector('.gphoto-confirm')?.remove();

  const confirm = document.createElement('div');
  confirm.className = 'gphoto-confirm';
  confirm.innerHTML = `
    <p>🗑 Delete?</p>
    <div class="gphoto-confirm-btns">
      <button class="gphoto-confirm-yes" onclick="event.stopPropagation(); window._deleteItem('${_esc(itemName)}')">Delete</button>
      <button class="gphoto-confirm-no"  onclick="event.stopPropagation(); this.closest('.gphoto-confirm').remove()">Cancel</button>
    </div>`;
  card.appendChild(confirm);
};

/* Delete: gallery card + collection icon + 3D model + stored data */
window._deleteItem = function(itemName) {
  // 1. Remove gallery card
  const card = document.querySelector(`.gphoto[data-name="${CSS.escape(itemName)}"]`);
  if (card) {
    card.style.transition = 'all .25s';
    card.style.opacity    = '0';
    card.style.transform  = 'scale(.8)';
    setTimeout(() => card.remove(), 250);
  }

  // 2. Remove 3D model from map
  SingaporeMap.removeDiscoveredItem(itemName);

  // 4. Remove from agent context + persist
  AgentSystem.removeDiscovered(itemName);

  // Reset gallery active state
  if (activeGphoto?.dataset.name === itemName) {
    activeGphoto = null;
    SingaporeMap.highlightDiscoveredItem(itemName, false);
  }

  // Update count
  window.UI.onItemCountUpdate(AgentSystem.getCtx().discovered.length);

  // Re-count each category tab and refresh its empty / active state
  Object.keys(galleryState).forEach(cat => {
    const state = galleryState[cat];
    const realCount = state.gridEl.querySelectorAll('.gphoto').length;
    state.count = realCount;
    state.tabEl.querySelector('.gtab-count').textContent = realCount;
    if (realCount === 0) {
      state.tabEl.classList.add('empty');
      state.emptyEl.classList.remove('hidden');
    } else {
      state.tabEl.classList.remove('empty');
      state.emptyEl.classList.add('hidden');
    }
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   PLANET STATS  — multi-dimensional growth + level + milestones
   ══════════════════════════════════════════════════════════════════════════ */

// Derived from CATEGORIES → keeps single source of truth
const PLANET_CATEGORIES = {
  civ:     CATEGORY_KEYS.filter(k => CATEGORIES[k].group === 'civ'),
  eco:     CATEGORY_KEYS.filter(k => CATEGORIES[k].group === 'eco'),
  culture: CATEGORY_KEYS.filter(k => CATEGORIES[k].group === 'culture'),
};

/* Convert discovered list into category stats */
function _calcPlanetStats() {
  const ctx = AgentSystem.getCtx();
  const counts = { civ: 0, eco: 0, culture: 0, other: 0 };
  ctx.discovered.forEach(item => {
    if      (PLANET_CATEGORIES.civ.includes(item.category))     counts.civ++;
    else if (PLANET_CATEGORIES.eco.includes(item.category))     counts.eco++;
    else if (PLANET_CATEGORIES.culture.includes(item.category)) counts.culture++;
    else                                                         counts.other++;
  });
  const total      = counts.civ + counts.eco + counts.culture + counts.other;
  const energy     = ctx.score;
  // Level threshold: cumulative — Lv N requires N*(N+1)/2 * 3 = 3, 9, 18, 30 ...
  const level      = _levelFromTotal(total);
  const nextNeeded = _totalForLevel(level + 1);
  const prevNeeded = _totalForLevel(level);
  const progress   = nextNeeded > prevNeeded
    ? Math.min(1, (total - prevNeeded) / (nextNeeded - prevNeeded))
    : 1;
  return { ...counts, total, energy, level, progress, nextNeeded, prevNeeded };
}
function _totalForLevel(n) { return n <= 1 ? 0 : ((n - 1) * n / 2) * 3; }
function _levelFromTotal(total) {
  let n = 1;
  while (_totalForLevel(n + 1) <= total) n++;
  return n;
}

/* Track previous values to detect changes for animation */
let _prevStats = null;

function _refreshPlanetUI() {
  const s = _calcPlanetStats();

  // Stat chips
  _setChipVal('stat-civ',    s.civ);
  _setChipVal('stat-eco',    s.eco);
  _setChipVal('stat-energy', s.energy);

  // Bond chip
  _refreshBondUI();

  // Planet pill
  document.getElementById('planet-level').textContent = s.level;
  document.getElementById('planet-level-fill').style.width = (s.progress * 100) + '%';
  _refreshPlanetTime();

  // Dashboard (if open)
  document.getElementById('pd-level').textContent      = s.level;
  document.getElementById('pd-stat-civ').textContent   = s.civ;
  document.getElementById('pd-stat-eco').textContent   = s.eco;
  document.getElementById('pd-stat-culture').textContent = s.culture;
  document.getElementById('pd-stat-energy').textContent = s.energy;
  document.getElementById('pd-progress-text').textContent =
    s.level >= 99 ? 'MAX' : `${s.total - s.prevNeeded} / ${s.nextNeeded - s.prevNeeded}`;
  document.getElementById('pd-progress-fill').style.width = (s.progress * 100) + '%';

  // Detect changes → bump stats + check milestones
  if (_prevStats) {
    if (s.civ     > _prevStats.civ)     _bumpChip('stat-civ');
    if (s.eco     > _prevStats.eco)     _bumpChip('stat-eco');
    if (s.energy  > _prevStats.energy)  _bumpChip('stat-energy');
    if (s.level   > _prevStats.level)   _triggerLevelUp(s);
    _checkMilestones(s, _prevStats);
  }
  _prevStats = s;

  // Update planet name display
  document.getElementById('planet-name').textContent = AgentSystem.getPlanetName();
}

function _setChipVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* ── Fox bond — HUD chip + dashboard block ─────────────────────── */
function _refreshBondUI() {
  const b = AgentSystem.getBond();
  const valEl  = document.getElementById('bond-value');
  const iconEl = document.getElementById('bond-icon');
  if (valEl)  valEl.textContent  = b.value;
  if (iconEl) iconEl.textContent = b.current.icon;

  // Dashboard block (may not exist if dashboard never opened — fine)
  const dIcon = document.getElementById('pd-bond-icon');
  if (dIcon) {
    dIcon.textContent = b.current.icon;
    document.getElementById('pd-bond-name').textContent  = b.current.name;
    document.getElementById('pd-bond-desc').textContent  = b.current.desc;
    document.getElementById('pd-bond-value').textContent = b.value;
    document.getElementById('pd-bond-fill').style.width  = (b.progress * 100) + '%';
    const nextEl = document.getElementById('pd-bond-next');
    if (nextEl) {
      nextEl.textContent = b.next
        ? `+${b.next.min - b.value} → ${b.next.name}`
        : 'Bond is full · You\'ve tamed each other';
    }
  }
}

/** Show a small "+N bond" floating toast near the bond chip */
function _showBondToast(amount, reason) {
  const toast = document.getElementById('bond-toast');
  const chip  = document.querySelector('.stat-chip.bond');
  if (!toast || !chip) return;
  const rect = chip.getBoundingClientRect();
  toast.textContent = `+${amount} ❤️ ${reason || 'Bond'}`;
  toast.style.top  = (rect.bottom + 4) + 'px';
  toast.style.left = (rect.left + rect.width / 2 - 60) + 'px';
  toast.classList.remove('hidden');
  void toast.offsetWidth;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 350);
  }, 1800);
}

/* ── Planet time display ─ shown in pill ─────────────────────── */
function _refreshPlanetTime() {
  const t = AgentSystem.planetTime();
  const el = document.getElementById('planet-time');
  if (el) el.textContent = `D${t.day} · ${t.emoji} ${t.period}`;
}

/* ── Fox current status — pill + dashboard banner + on-canvas card ───── */
function _renderFoxStatus(activity) {
  const pill = document.getElementById('planet-fox-status');
  const banner = document.getElementById('pd-fox-now');
  const bannerText = document.getElementById('pd-fox-now-action');

  if (activity) {
    const short = `${activity.emoji} ${activity.label.slice(0, 10)}`;
    pill.textContent = short;
    pill.classList.remove('hidden');
    if (banner) {
      banner.classList.remove('hidden');
      bannerText.textContent = `${activity.emoji} ${activity.label}「${activity.itemName}」…`;
    }
  } else {
    pill.classList.add('hidden');
    pill.textContent = '';
    if (banner) banner.classList.add('hidden');
  }

  _refreshFoxStatusCard();   // always update the canvas card too
}

/* ── On-canvas fox status card — always visible ──────────────────────── */
// Bias toward resting/dozing states — fox is a quiet companion, mostly sleeps & daydreams
const FOX_AMBIENT_STATES = {
  late_night: ['💤 fast asleep in the burrow', '💤 sleeping soundly', '🌌 curled up dreaming', '😴 nose twitching softly', '💤 sleeping deeply'],
  predawn:    ['😴 still lazing in the burrow', '💤 not awake yet', '💭 dreaming of the Little Prince', '🥱 slowly rolling over', '😴 drifting back to sleep'],
  morning:    ['😌 daydreaming at the burrow entrance', '🌅 watching the sunrise', '🥱 rubbing its eyes', '😴 wanting to sleep a little longer', '🌅 basking in the morning sun'],
  noon:       ['🌞 sprawled on the grass', '😴 napping in the shade', '💭 watching the clouds drift', '🦊 lying around lazily', '😌 listening to the breeze'],
  afternoon:  ['😴 mid-afternoon nap', '🍂 watching leaves fall', '💭 lost in thought', '🦊 curled on warm sand', '😌 listening to cicadas'],
  dusk:       ['🌇 watching the evening glow', '🦊 waiting for you at the burrow', '😌 staring into space', '🌆 watching the sky change color', '🌹 glancing at its rose'],
  evening:    ['🌟 watching the stars', '🌙 listening to the wind', '😌 sitting quietly', '☄️ waiting for a shooting star', '💭 missing you'],
  midnight:   ['😴 about to sleep', '🌌 staring at the Milky Way', '💤 getting drowsy', '🦊 crawling into bed', '💤 already asleep'],
};

function _foxPeriodKey(hour) {
  if (hour < 3)  return 'late_night';
  if (hour < 5)  return 'predawn';
  if (hour < 8)  return 'morning';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'noon';
  if (hour < 17) return 'afternoon';
  if (hour < 20) return 'dusk';
  if (hour < 23) return 'evening';
  return 'midnight';
}

function _ambientFoxLine(planetTime, discovered) {
  const periodKey = _foxPeriodKey(planetTime.hourOfDay);
  const pool = FOX_AMBIENT_STATES[periodKey] || FOX_AMBIENT_STATES.morning;

  // Only 12% chance to reference a discovered item — mostly silent contemplation
  if (discovered.length > 0 && Math.random() < 0.12) {
    const item = discovered[Math.floor(Math.random() * discovered.length)];
    const phrases = [
      `💭 thinking about the "${item.name}" you brought back`,
      `🦊 gazing at the "${item.name}"`,
    ];
    return phrases[Math.floor(Math.random() * phrases.length)];
  }

  // Stable for ~minute windows so it doesn't flicker
  const minSeed = Math.floor(Date.now() / 60_000);
  return pool[minSeed % pool.length];
}

function _refreshFoxStatusCard() {
  const card     = document.getElementById('fox-status-card');
  const textEl   = document.getElementById('fox-status-text');
  const timeEl   = document.getElementById('fox-status-time');
  if (!card) return;

  const t        = AgentSystem.planetTime();
  const activity = AgentSystem.getCurrentFoxActivity();
  const ctxData  = AgentSystem.getCtx();

  timeEl.textContent = `D${t.day} · ${t.emoji} ${t.period}`;

  if (activity) {
    textEl.textContent = `${activity.emoji} ${activity.label}…`;
    card.classList.add('active');
  } else {
    textEl.textContent = _ambientFoxLine(t, ctxData.discovered);
    card.classList.remove('active');
  }

  // Re-render the expanded timeline if open
  if (card.classList.contains('expanded')) {
    _renderFoxTimeline();
  }
}

/* ── Toggle the 6-hour timeline panel inside the fox status card ── */
window.toggleFoxTimeline = function() {
  const card = document.getElementById('fox-status-card');
  const panel = document.getElementById('fox-status-timeline');
  if (!card || !panel) return;
  const willOpen = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !willOpen);
  card.classList.toggle('expanded', willOpen);
  if (willOpen) _renderFoxTimeline();
};

/* ── Render the past-6-hour timeline strip ──────────────────────── */
function _renderFoxTimeline() {
  const strip = document.getElementById('fst-strip');
  const footer = document.getElementById('fst-footer');
  if (!strip) return;

  const slots = AgentSystem.getFoxTimeline(6);   // 24 planet hours
  const ctxData = AgentSystem.getCtx();
  strip.innerHTML = '';

  let activeCount = 0;
  slots.forEach(slot => {
    const planetH = slot.planetHour;
    const div = document.createElement('div');
    div.className = 'fst-slot';

    if (slot.activity) {
      // Real LLM activity moment
      activeCount++;
      div.classList.add('active');
      div.textContent = slot.activity.action.emoji || '🦊';
      div.dataset.tooltip = `🕐 ${planetH}h · ${slot.activity.action.label} — "${slot.activity.itemName || ''}"`;
    } else {
      // Ambient state — mostly dozing/daydreaming
      const ambient = _ambientForHour(planetH, slot.slotStart, ctxData.discovered);
      div.classList.add('rest');
      if (planetH < 5 || planetH >= 22) div.classList.add('night');
      div.textContent = ambient.emoji;
      div.dataset.tooltip = `🕐 ${planetH}h · ${ambient.text}`;
    }
    strip.appendChild(div);
  });

  const restCount = slots.length - activeCount;
  if (footer) {
    footer.textContent = `${slots.length}h total · active ${activeCount} · rest ${restCount} · click outside to collapse`;
  }
}

/* Lookup ambient emoji+text for a given planet hour (deterministic per slot) */
function _ambientForHour(planetH, ts, discovered) {
  const periodKey = _foxPeriodKey(planetH);
  const pool = FOX_AMBIENT_STATES[periodKey] || FOX_AMBIENT_STATES.morning;
  // Stable seed per slot
  const seed = Math.floor(ts / (15 * 60 * 1000));
  const text = pool[Math.abs(seed) % pool.length];
  // Extract leading emoji (first non-space token before the rest)
  const m = text.match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}\u2600-\u27BF]+)\s*(.*)/u);
  return {
    emoji: m ? m[1] : '💤',
    text:  m ? m[2] : text,
  };
}

/* ── Render fox diary list inside planet dashboard ───────────── */
function _renderFoxDiary() {
  const list = document.getElementById('pd-diary-list');
  const countEl = document.getElementById('pd-diary-count');
  if (!list) return;

  const entries = AgentSystem.getFoxDiary();
  countEl.textContent = `${entries.length} entries`;
  list.innerHTML = '';

  entries.forEach(e => {
    const div = document.createElement('div');
    div.className = 'pd-diary-entry';
    const moodIcon = {
      happy:'😊', wistful:'😌', curious:'🧐',
      sleepy:'😴', surprised:'✨', tired:'😪'
    }[e.mood] || '🦊';

    const thumb = e.itemPhoto
      ? `<img class="pd-diary-thumb" src="${e.itemPhoto}" alt="${_esc(e.itemName)}">`
      : `<div class="pd-diary-thumb-placeholder">${_categoryEmoji(e.itemCategory)}</div>`;

    div.innerHTML = `
      ${thumb}
      <div class="pd-diary-content">
        <div class="pd-diary-row1">
          <span class="pd-diary-mood-emoji">${moodIcon}</span>
          <span class="pd-diary-entry-title">${_esc(e.shortTitle || e.action.label)}</span>
          <span class="pd-diary-when">D${e.planetDay} · ${e.emoji} ${e.period}</span>
        </div>
        <div class="pd-diary-action">${e.action.emoji} ${_esc(e.action.label)} · about "${_esc(e.itemName)}"</div>
        <div class="pd-diary-text">${_nl2br(_esc(e.narrative))}</div>
        ${e.broughtBack ? `<div class="pd-diary-bring">🎁 Brought back: ${_esc(e.broughtBack)}</div>` : ''}
      </div>`;
    list.appendChild(div);
  });
}

function _bumpChip(id) {
  const el = document.getElementById(id)?.closest('.stat-chip');
  if (!el) return;
  el.classList.remove('bumped');
  void el.offsetWidth;
  el.classList.add('bumped');
}

/* ── Milestones ──────────────────────────────────────────────────────── */
const MILESTONES = [
  { id:'first_eco',     trigger: s => s.eco >= 1,     icon:'🌱', title:'Ecology Awakens', desc:'Your planet welcomes its first plant or animal',  reward:'+50 energy' },
  { id:'first_civ',     trigger: s => s.civ >= 1,     icon:'🏛️', title:'Civilization Sprouts', desc:'The first building or landmark stands on your planet', reward:'+50 energy' },
  { id:'first_culture', trigger: s => s.culture >= 1, icon:'🍜', title:'Culture Stirs',   desc:'The first cuisine or resident appears',           reward:'+50 energy' },
  { id:'five_total',    trigger: s => s.total >= 5,   icon:'✨', title:'Taking Shape',    desc:'5 things collected — the map is coming alive',     reward:'+100 energy' },
  { id:'ten_total',     trigger: s => s.total >= 10,  icon:'🌍', title:'Flourishing',     desc:'The planet enters an active phase: civ + eco coexist', reward:'+200 energy' },
  { id:'twenty_total',  trigger: s => s.total >= 20,  icon:'🌌', title:'Prosperous',      desc:'Your planet is now a tiny complete world',         reward:'+500 energy' },
  { id:'all_categories',trigger: s => s.civ>=1 && s.eco>=1 && s.culture>=1, icon:'🎇', title:'Trinity', desc:'Civ, Eco and Culture all unlocked', reward:'+300 energy' },
];

function _checkMilestones(s, prev) {
  MILESTONES.forEach(m => {
    if (!m.trigger(s)) return;
    if (m.trigger(prev || {civ:0,eco:0,culture:0,total:0,energy:0,level:0})) return;
    // Newly unlocked
    if (AgentSystem.unlockMilestone(m.id)) {
      _showEvolutionToast(m);
    }
  });
}

function _showEvolutionToast({ icon, title, desc, reward, isLevelUp, level }) {
  const toast = document.getElementById('evolution-toast');
  toast.innerHTML = `
    <div class="evo-rays"></div>
    <div class="evo-emoji">${icon}</div>
    <div class="evo-title">${title}</div>
    <div class="evo-subtitle">${desc}</div>
    ${reward ? `<div class="evo-reward">${reward}</div>` : ''}`;
  toast.classList.remove('hidden');
  void toast.offsetWidth;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 500);
  }, isLevelUp ? 4500 : 3500);
}

function _triggerLevelUp(s) {
  _showEvolutionToast({
    icon: '🚀',
    title: `Planet leveled up to Lv.${s.level}!`,
    desc: 'Your planet enters a new stage of growth',
    reward: 'All codex species recorded',
    isLevelUp: true,
    level: s.level,
  });
}

/* ── Dashboard open/close ────────────────────────────────────────────── */
window.openPlanetDashboard = function() {
  const ctx = AgentSystem.getCtx();
  const nameInput = document.getElementById('pd-name-input');
  nameInput.value = AgentSystem.getPlanetName();
  nameInput.oninput = () => AgentSystem.setPlanetName(nameInput.value);
  nameInput.onblur  = () => {
    document.getElementById('planet-name').textContent = AgentSystem.getPlanetName();
  };

  // Render milestones
  const list = document.getElementById('pd-milestone-list');
  const unlockedIds = AgentSystem.getMilestones();
  const stats = _calcPlanetStats();
  list.innerHTML = MILESTONES.map(m => {
    const unlocked = unlockedIds.includes(m.id);
    const eligible = m.trigger(stats);
    return `
      <div class="pd-milestone ${unlocked ? 'done' : (eligible ? '' : 'locked')}">
        <div class="pd-milestone-icon">${m.icon}</div>
        <div class="pd-milestone-text">
          <div class="pd-milestone-title">${m.title}</div>
          <div class="pd-milestone-desc">${m.desc} · ${m.reward}</div>
        </div>
        ${unlocked ? '<div class="pd-milestone-check">✓</div>' : ''}
      </div>`;
  }).join('');

  _refreshPlanetUI();
  _renderFoxDiary();
  _renderFoxStatus(AgentSystem.getCurrentFoxActivity());
  document.getElementById('planet-dashboard').classList.remove('hidden');
};
window.closePlanetDashboard = function() {
  document.getElementById('planet-dashboard').classList.add('hidden');
};

/* ─── Default achievements (shown locked on load) ───────────────────────── */
const DEFAULT_ACHIEVEMENTS = [
  { id:'first_step',  icon:'👣', name:'First Encounter', desc:'Completed the fox\'s very first wish' },
  { id:'first_scan',  icon:'🌹', name:'First Rose',      desc:'Brought back the first new thing to your planet' },
  { id:'explorer',    icon:'🗺️', name:'Far Wanderer',    desc:'Completed 3 wishes' },
  { id:'collector',   icon:'💎', name:'Curator',         desc:'5 new things sit on your planet' },
  { id:'citywalk',    icon:'🚶', name:'Stroller',        desc:'Walked through 3 different corners' },
  { id:'sg_expert',   icon:'🦊', name:'Friend of the Fox',desc:'The fox remembers every one of your stories' },
];

/* ══════════════════════════════════════════════════════════════════════════
   UI NAMESPACE  — all DOM mutations live here
   ══════════════════════════════════════════════════════════════════════════ */
window.UI = {

  /* ─── Agent reply ─────────────────────────────────────────────────────── */
  onAgentReply(text) {
    _hideTyping();
    _addMsg('assistant', text);
  },

  /* ─── Fox starts/stops an activity → update pill + dashboard banner ──── */
  onFoxStatusChange(activity) {
    _renderFoxStatus(activity);
  },

  /* ─── Bond change → refresh chips + show floating reward ─────────────── */
  onBondChange(bond, reason, amount) {
    _refreshBondUI();
    if (amount > 0) _showBondToast(amount, reason);
  },

  /* ─── Fox diary card (Tabikaeru-style log) ───────────────────────────── */
  onFoxDiary({ item, action, narrative, mood, energyEarned, broughtBack, shortTitle, timeContext }) {
    const moodIcon = {
      happy:'😊', wistful:'😌', curious:'🧐',
      sleepy:'😴', surprised:'✨', tired:'😪'
    }[mood] || '🦊';

    const el = document.createElement('div');
    el.className = `msg assistant fox-diary-msg`;
    el.innerHTML = `
      <div class="msg-avatar fox-diary-avatar">🦊</div>
      <div class="fox-diary-card">
        <div class="fox-diary-header">
          <span class="fox-diary-badge">🦊 Fox's Diary</span>
          <span class="fox-diary-mood">${moodIcon}</span>
        </div>
        <div class="fox-diary-title">${_esc(shortTitle)}</div>
        <div class="fox-diary-meta">
          <span class="fox-diary-time">⏰ ${_esc(timeContext)}</span>
          <span class="fox-diary-action">${action.emoji} ${_esc(action.label)}</span>
        </div>
        <div class="fox-diary-subject">about "${_esc(item.name)}"</div>
        <div class="fox-diary-body">${_nl2br(_esc(narrative))}</div>
        ${broughtBack ? `<div class="fox-diary-bring">🎁 Brought back: ${_esc(broughtBack)}</div>` : ''}
        <div class="fox-diary-footer">
          <span class="fox-diary-reward">⚡ +${energyEarned} planet energy</span>
        </div>
      </div>`;
    _appendToChat(el);
  },

  /* ─── Story card ──────────────────────────────────────────────────────── */
  onStory({ title, titleEn, story, mood }) {
    _hideTyping();
    const el = document.createElement('div');
    el.className = 'story-card';
    el.innerHTML = `
      <div class="story-hd">
        <span>📖</span>
        <span class="story-hd-title">${title}${titleEn ? ` · ${titleEn}` : ''}</span>
      </div>
      ${mood ? `<div class="story-mood">${_esc(mood)}</div>` : ''}
      <div class="story-body">${_nl2br(story)}</div>
      <span class="story-tag">🌍 Added to the planet codex</span>`;
    _appendToChat(el);
  },

  /* ─── Sponsor task injection ──────────────────────────────────────────── */
  onSponsor(task) {
    // Chat card
    const el = document.createElement('div');
    el.className = 'sponsor-card';
    el.innerHTML = `
      <span class="sponsor-badge">🎁 Sponsored Quest</span>
      <p class="sponsor-desc">${task.desc}</p>
      <span class="sponsor-pts">+${task.points} pts</span>`;
    _appendToChat(el);

    // Bottom toast
    const toast = document.getElementById('sponsor-toast');
    document.getElementById('toast-content').textContent = task.desc;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 400);
    }, 4500);
  },

  /* ─── Task added ──────────────────────────────────────────────────────── */
  onTaskAdded(task) {
    _taskAddToHUD(task);
    _taskUpdateProgress();
  },

  /* ─── Task completed ──────────────────────────────────────────────────── */
  onTaskDone(task) {
    _taskMarkDone(task.id);
    if (!_isRestoring) {
      _showTaskDoneToast(task);
      _addMsg('sys', `🦊 You helped the fox finish a wish: ${task.title}  (+${task.points} energy · +5 bond)`);
    }
    _taskUpdateProgress();
  },

  /* ─── Achievement ─────────────────────────────────────────────────────── */
  onAchievement(ach) {
    // Panel: mark unlocked
    const locked = document.getElementById(`ach-${ach.id}`);
    if (locked) {
      locked.classList.remove('locked');
      locked.classList.add('unlocked', 'new');
      setTimeout(() => locked.classList.remove('new'), 2000);
    } else {
      // Add dynamically if wasn't pre-rendered
      const el = _makeAchEl(ach, false);
      el.classList.add('new');
      document.getElementById('achievements-container').prepend(el);
      setTimeout(() => el.classList.remove('new'), 2000);
    }

    // Popup with sparkle particles
    document.getElementById('ach-icon').textContent = ach.icon || '🏆';
    document.getElementById('ach-name').textContent  = ach.name;
    const popup = document.getElementById('achievement-popup');

    // Clear old sparkles
    popup.querySelectorAll('.ach-sparkle').forEach(s => s.remove());

    // Spawn 10 sparkles in a circle around the popup
    const sparkleChars = ['✨', '⭐', '💫', '🌟', '✦'];
    for (let i = 0; i < 10; i++) {
      const s = document.createElement('span');
      s.className = 'ach-sparkle';
      s.textContent = sparkleChars[Math.floor(Math.random() * sparkleChars.length)];
      const ang = (i / 10) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 80 + Math.random() * 40;
      s.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
      s.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
      s.style.animationDelay = (i * 40) + 'ms';
      popup.appendChild(s);
      setTimeout(() => s.remove(), 1500 + i * 40);
    }

    popup.classList.remove('hidden');
    void popup.offsetWidth;
    popup.classList.add('show');
    setTimeout(() => {
      popup.classList.remove('show');
      setTimeout(() => popup.classList.add('hidden'), 600);
    }, 4500);
  },

  /* ─── Item discovered ─────────────────────────────────────────────────── */
  onItemDiscovered(item) {
    galleryAddItem(item);
  },

  /* ─── Score / item count ─ delegates to planet stats ─────────────────── */
  onScoreUpdate()       { _refreshPlanetUI(); },
  onItemCountUpdate()   { _refreshPlanetUI(); },

  /* ─── User's own discovered 3D model — HOVER preview tooltip ──────────── */
  onDiscoveredItemHover(itemName, clientX, clientY) {
    _showDhc(itemName, clientX, clientY);
  },
  onDiscoveredItemHoverMove(clientX, clientY) {
    _positionDhc(clientX, clientY);
  },
  onDiscoveredItemHoverLeave() {
    _hideDhc();
  },

  /* ─── A discovered 3D model was placed / moved — persist (theta, phi) ── */
  onItemPlaced(itemName, theta, phi) {
    AgentSystem.setItemPosition?.(itemName, theta, phi);
  },

  /* ─── Landmark clicked on map ─────────────────────────────────────────── */
  onLandmarkClick(data) {
    const card = document.getElementById('landmark-card');
    document.getElementById('landmark-card-icon').textContent   = data.emoji || '📍';
    document.getElementById('landmark-card-name').textContent   = data.name;
    document.getElementById('landmark-card-name-en').textContent= data.nameEn || '';
    document.getElementById('landmark-card-story').textContent  = data.story || 'Loading story…';
    card.classList.remove('hidden');
    SingaporeMap.highlightLandmark(data.id);

    // If no story cached, fetch from story agent
    if (!data.story || data.story.includes('Loading')) {
      AgentSystem.landmarkStory(data.id, data.name);
    }
  },

  /* ─── Error ───────────────────────────────────────────────────────────── */
  onError(msg) {
    _hideTyping();
    _addMsg('sys', `⚠️ Something went wrong: ${msg}`);
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   CHAT HELPERS
   ══════════════════════════════════════════════════════════════════════════ */

/* Show the onboarding hint only when the user is brand new */
function _maybeShowOnboardingHint() {
  const ctx = AgentSystem.getCtx();
  const isNewbie = ctx.discovered.length === 0 && (ctx.foxBond || 0) === 0;
  if (!isNewbie) return;

  const hint = document.getElementById('onboarding-hint');
  if (!hint) return;

  // Show after a short delay (let welcome card render first)
  setTimeout(() => hint.classList.remove('hidden'), 1500);

  // Auto-dismiss when user clicks the FAB or after 12s
  const fab = document.getElementById('map-camera-fab');
  const dismiss = () => {
    hint.classList.add('fading');
    setTimeout(() => hint.classList.add('hidden'), 600);
  };
  fab?.addEventListener('click', dismiss, { once: true });
  setTimeout(dismiss, 12_000);
}

/* ── Fox journal modal — opened by the central FAB ──────────────────── */
window.openJournal = function() {
  const m = document.getElementById('journal-modal');
  if (!m) return;
  m.classList.remove('hidden');
  // Scroll chat-messages to bottom (latest entries visible)
  requestAnimationFrame(() => {
    const c = document.getElementById('chat-messages');
    if (c) c.scrollTop = c.scrollHeight;
  });
};

window.closeJournal = function() {
  const m = document.getElementById('journal-modal');
  if (!m) return;
  m.classList.add('hidden');
};

/* Close journal whenever the user starts the photo-capture flow, so the
   photo modal isn't competing with the journal for screen space. */
function _autoCloseJournalOnUpload() {
  const upload = document.getElementById('photo-upload');
  if (!upload) return;
  upload.addEventListener('change', () => window.closeJournal());
}

/* Welcome card — compact intro with collapsible full story */
function _renderWelcomeCard() {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.innerHTML = `
    <div class="msg-avatar">🦊</div>
    <div class="welcome-card">
      <div class="welcome-greeting">
        Hi there ~<br>
        <span class="welcome-greeting-lead">I'm the only fox on this little planet.</span><br>
        Will you be my <span class="welcome-keyword">"Little Prince"</span> and bring back what you find along the way?
      </div>
      <button class="welcome-cta" onclick="document.getElementById('photo-upload').click()">
        <span>📷</span>
        <span>Capture your first moment, meet me</span>
      </button>
      <button class="welcome-expand" id="welcome-expand">Read the full story ▾</button>
      <div class="welcome-long hidden" id="welcome-long">
        <p>Once there was only me — one fox, alone on an empty little planet.</p>
        <p>Then one day a traveler called the Little Prince passed by and brought back wonders from far away: a flower I'd never seen, a strange building, a flavor I'd never tasted.</p>
        <p>Each new thing that lands on the planet, the world fills up with a little more joy, and so do I. ✨</p>
      </div>
    </div>`;

  el.querySelector('#welcome-expand').addEventListener('click', () => {
    const long = el.querySelector('#welcome-long');
    const btn  = el.querySelector('#welcome-expand');
    const open = long.classList.toggle('hidden') === false;
    btn.textContent = open ? 'Show less ▴' : 'Read the full story ▾';
  });

  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function _addMsg(role, text) {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  const avatar = role === 'user' ? '👤' : role === 'assistant' ? '🦊' : '⚡';
  el.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-bubble">${_nl2br(_esc(text))}</div>`;
  _appendToChat(el);
}

function _appendToChat(el) {
  const c = document.getElementById('chat-messages');
  c.appendChild(el);
  c.scrollTop = c.scrollHeight;
}

function _showTyping() {
  if (document.getElementById('typing')) return;
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.id = 'typing';
  el.innerHTML = `<div class="msg-avatar">🦊</div><div class="typing-dots"><span></span><span></span><span></span></div>`;
  _appendToChat(el);
}

function _hideTyping() {
  document.getElementById('typing')?.remove();
}

function _nl2br(s) { return (s||'').replace(/\n/g, '<br>'); }
function _esc(s)   { return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _categoryEmoji(cat) {
  return _catMeta(cat).emoji;
}

/* ─── Species-name normalization for fuzzy dedupe ─────────────────────── */
// "Kaya Toast", "kaya-toast", "Singaporean Kaya Toast" → all collapse to the
// same key, so the user's repeat ("again") sightings are recognized.
function _normalizeSpeciesName(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[\s（）()【】\[\]·,，。.\-_/\\:：、!?！？\u3000]+/g, '')
    .replace(/singapore|singaporean|sgapore|local|traditional|classic|authentic|the |a /g, '');
}

/** Find an existing discovered item that's clearly the same "species" */
function _findExistingMatch(identified, ctx) {
  const cat  = identified?.category;
  const n    = _normalizeSpeciesName(identified?.name);
  const ne   = _normalizeSpeciesName(identified?.nameEn);
  if (!n && !ne) return null;
  return ctx.discovered.find(d => {
    const dn  = _normalizeSpeciesName(d.name);
    const dne = _normalizeSpeciesName(d.nameEn);
    if (n  && dn  && (dn === n  || dn.includes(n)  || n.includes(dn)))  return true;
    if (ne && dne && (dne === ne || dne.includes(ne) || ne.includes(dne))) return true;
    // Same category + cross-language match (name vs other's nameEn or vice versa)
    if (cat && d.category === cat) {
      if (n  && dne && (dne === n  || dne.includes(n)  || n.includes(dne))) return true;
      if (ne && dn  && (dn  === ne || dn.includes(ne)  || ne.includes(dn)))  return true;
    }
    return false;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   ACHIEVEMENT PANEL INIT
   ══════════════════════════════════════════════════════════════════════════ */

function _makeAchEl(ach, locked = true) {
  const el = document.createElement('div');
  el.className = `ach-item ${locked ? 'locked' : 'unlocked'}`;
  el.id = `ach-${ach.id}`;
  el.title = ach.desc;
  el.innerHTML = `<div class="ach-emoji">${ach.icon}</div><div class="ach-label">${ach.name}</div>`;
  return el;
}

function _initAchievements() {
  const c = document.getElementById('achievements-container');
  DEFAULT_ACHIEVEMENTS.forEach(a => c.appendChild(_makeAchEl(a, true)));
}

/* ══════════════════════════════════════════════════════════════════════════
   DEMO AUTO-RUN
   Simulates the hackathon user story automatically
   ══════════════════════════════════════════════════════════════════════════ */

window.runDemo = async () => {
  const btn = document.getElementById('demo-btn');
  btn.style.pointerEvents = 'none';
  btn.innerHTML = '<span>⏳</span><span>Running demo…</span>';

  const delay = ms => new Promise(r => setTimeout(r, ms));

  // 1. User message
  _simulateUserMsg('I\'m heading to Singapore for two days — let\'s start building my planet! Booked Marina Bay Sands; want the rooftop view at night, and to hunt the Starbucks-Merlion collab plush. Easy itinerary please — I love citywalks and dislike influencer restaurants.');
  await delay(3000);

  // 2. Hunger hook → trigger Sponsor Agent
  await delay(1500);
  _simulateUserMsg('Craving something sweet this afternoon — any recommendations?');
  await delay(4000);

  btn.style.pointerEvents = 'auto';
  btn.innerHTML = '<span>✓</span><span>Demo</span>';
};

function _simulateUserMsg(text) {
  _addMsg('user', text);
  _showTyping();
  AgentSystem.sendMessage(text);
}

/* ══════════════════════════════════════════════════════════════════════════
   TASK SYSTEM  — HUD + full panel
   ══════════════════════════════════════════════════════════════════════════ */

// All tasks stored locally for the panel
const _allTasks = [];
let _taskPanelCat = 'all';

function _taskCat(task) {
  if (task.sponsored || task.isSpecial || task.special) return 'special';
  // Starter / easy generic tasks go to side list so main is reserved for player's actual intent
  if (task.isStarter) return 'side';
  if (['explore', 'photo', 'landmark'].includes(task.category)) return 'main';
  return 'side';
}

function _taskCatIcon(cat) {
  return { main:'⭐', side:'🌟', special:'🎁' }[cat] || '📌';
}

/* ── Tabbed HUD: 3 tabs (main/side/special), active tab scrolls ────────── */
let _activeThudTab = 'main';

function _initThudTabs() {
  document.querySelectorAll('#thud-tabs .thud-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();   // don't bubble up and toggle the panel
      _switchThudTab(btn.dataset.cat);
    });
  });
  // Stop the "Open notebook" button from also toggling the panel
  document.querySelector('#task-hud .thud-open-btn')?.addEventListener('click', e => e.stopPropagation());
}

/* Click header chevron → collapse/expand the whole task HUD body */
window.toggleTaskHud = function() {
  document.getElementById('task-hud')?.classList.toggle('collapsed');
};

function _switchThudTab(cat) {
  if (!['main','side','special'].includes(cat)) return;
  _activeThudTab = cat;
  document.querySelectorAll('#thud-tabs .thud-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === cat);
    b.classList.remove('new-flash');   // clear pulse on visit
  });
  document.querySelectorAll('#thud-content .thud-items').forEach(g => {
    g.classList.toggle('hidden', g.dataset.cat !== cat);
  });
}

/* Add task to HUD tab grid and internal array */
function _taskAddToHUD(task) {
  if (_allTasks.find(t => t.id === task.id)) return;  // skip duplicates
  _allTasks.push(task);

  const cat = _taskCat(task);
  const container = document.querySelector(`#thud-content .thud-items[data-cat="${cat}"]`);
  if (!container) return;

  // Drop empty placeholder once we have real content
  container.querySelector('.thud-empty')?.remove();

  const isNew = !!task.isNew;
  const el = document.createElement('div');
  el.className = `thud-item${task.done ? ' done' : ''}${isNew ? ' has-new' : ''}`;
  el.id = `thud-${task.id}`;
  el.title = task.desc || task.title;
  el.onclick = () => openTaskPanel();
  el.innerHTML = `
    <div class="thud-dot"></div>
    <div class="thud-item-title">${task.isStarter ? '<span class="thud-starter-dot">🟢</span>' : ''}${task.title}</div>
    ${isNew ? '<span class="thud-item-newbadge">NEW</span>' : ''}
    <div class="thud-item-pts">+${task.points}</div>`;

  // Newest task on top — insert before the first existing item
  const firstItem = container.querySelector('.thud-item');
  if (firstItem) container.insertBefore(el, firstItem);
  else container.appendChild(el);

  if (isNew) _queueNewTaskToast(task);
  document.getElementById('thud-score-badge')?.classList.remove('hidden');

  // Refresh tab counts + flash if a non-active tab got the addition
  _refreshThudTabCounts();
  if (cat !== _activeThudTab) {
    const tabBtn = document.querySelector(`#thud-tabs .thud-tab[data-cat="${cat}"]`);
    tabBtn?.classList.add('new-flash');
  }
}

function _refreshThudTabCounts() {
  ['main','side','special'].forEach(c => {
    const items   = document.querySelectorAll(`#thud-content .thud-items[data-cat="${c}"] .thud-item`).length;
    const tabBtn  = document.querySelector(`#thud-tabs .thud-tab[data-cat="${c}"]`);
    const countEl = tabBtn?.querySelector('.thud-tab-count');
    if (countEl) countEl.textContent = items;
    tabBtn?.classList.toggle('empty', items === 0);
  });
}

/* Show prominent toast when a task is completed */
let _taskDoneHideTimer = null;
function _showTaskDoneToast(task) {
  const toast = document.getElementById('task-done-toast');
  if (!toast) return;

  const cat = _taskCat(task);
  const icon = task.isStarter ? '🌱' :
               cat === 'special' ? '🎁' :
               cat === 'main'    ? '✨' : '🌟';
  const label = cat === 'special' ? 'Got a little surprise' :
                task.isStarter    ? 'Finished an easy step' :
                cat === 'main'    ? 'Made the fox\'s wish come true' : 'Saw another sight';

  toast.innerHTML = `
    <div class="tdt-row">
      <div class="tdt-icon">${icon}</div>
      <div class="tdt-body">
        <div class="tdt-label">🦊 ${label}</div>
        <div class="tdt-title">${_esc(task.title)}</div>
      </div>
      <div class="tdt-points">❤️ +5</div>
    </div>`;

  // Sprinkle sparkle particles around the toast
  const sparkleChars = ['✨', '⭐', '💫', '🌟'];
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('span');
    s.className = 'tdt-sparkle';
    s.textContent = sparkleChars[Math.floor(Math.random() * sparkleChars.length)];
    const ang = (i / 6) * Math.PI * 2;
    s.style.setProperty('--dx', `${Math.cos(ang) * 50}px`);
    s.style.setProperty('--dy', `${Math.sin(ang) * 30}px`);
    s.style.left = '50%';
    s.style.top  = '50%';
    s.style.animationDelay = (i * 60) + 'ms';
    toast.appendChild(s);
    setTimeout(() => s.remove(), 1300);
  }

  toast.classList.remove('hidden');
  void toast.offsetWidth;
  toast.classList.add('show');

  if (_taskDoneHideTimer) clearTimeout(_taskDoneHideTimer);
  _taskDoneHideTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 400);
  }, 3200);
}

/* Mark done in both HUD and full panel */
function _taskMarkDone(id) {
  const task = _allTasks.find(t => t.id === id);
  if (task) task.done = true;

  document.getElementById(`thud-${id}`)?.classList.add('done');
  document.getElementById(`tp-task-${id}`)?.classList.add('done');
}

/* Update progress bar + badge */
function _taskUpdateProgress() {
  const total = _allTasks.length;
  const done  = _allTasks.filter(t => t.done).length;

  const badge = document.getElementById('thud-score-badge');
  if (badge) badge.textContent = `${done}/${total}`;

  document.getElementById('tp-progress-text').textContent = `${done} / ${total} done`;
  const pct = total ? (done / total * 100) : 0;
  document.getElementById('tp-progress-fill').style.width = pct + '%';
}

/* Open full task panel — fills entire map canvas */
window.openTaskPanel = function() {
  _renderTaskPanel(_taskPanelCat);
  document.getElementById('task-panel').classList.remove('hidden');
  document.getElementById('task-hud').style.display  = 'none';
  document.getElementById('map-camera-fab').style.display = 'none';
  document.getElementById('map-hint').style.display  = 'none';

  // Hide the toast if it's currently showing (user already saw the news)
  const toast = document.getElementById('new-task-toast');
  if (toast) {
    toast.classList.remove('show');
    toast.classList.add('hidden');
    if (_toastHideTimer) { clearTimeout(_toastHideTimer); _toastHideTimer = null; }
  }
};

/* ── New-task toast queue (batches tasks added in a 700ms window) ───────── */
let _newTaskQueue   = [];
let _toastShowTimer = null;
let _toastHideTimer = null;

function _queueNewTaskToast(task) {
  _newTaskQueue.push(task);
  if (_toastShowTimer) clearTimeout(_toastShowTimer);
  _toastShowTimer = setTimeout(_renderNewTaskToast, 700);
}

function _renderNewTaskToast() {
  const tasks = _newTaskQueue.splice(0);
  if (!tasks.length) return;

  const toast = document.getElementById('new-task-toast');
  if (!toast) return;

  const isSponsor = tasks.some(t => t.sponsored);
  const headerIcon = isSponsor ? '🎁' : '✨';
  const headerText = isSponsor ? 'NEW SPONSORED QUEST' : 'NEW QUEST';
  const title = tasks.length === 1
    ? tasks[0].title
    : `${tasks.length} new quests added`;

  const list = tasks.length > 1
    ? `<div class="ntt-list">${tasks.slice(0, 4).map(t =>
        `<div class="ntt-task-line"><span class="ntt-task-icon">${_taskCatIcon(_taskCat(t))}</span><span>${t.title}</span></div>`
      ).join('')}${tasks.length > 4 ? `<div class="ntt-task-line"><span class="ntt-task-icon">…</span><span>and ${tasks.length - 4} more</span></div>` : ''}</div>`
    : `<div class="ntt-list">${tasks[0].desc || ''}</div>`;

  toast.innerHTML = `
    <div class="ntt-header"><span class="ntt-burst">${headerIcon}</span><span>${headerText}</span></div>
    <div class="ntt-title">${title}</div>
    ${list}
    <div class="ntt-cta">Click to open the quest log →</div>`;

  toast.onclick = () => window.openTaskPanel();
  toast.classList.remove('hidden');
  // force reflow then add show class for transition
  void toast.offsetWidth;
  toast.classList.add('show');

  // Auto-dismiss after 6s (longer for sponsor or batched)
  const dwell = isSponsor || tasks.length > 1 ? 8000 : 6000;
  if (_toastHideTimer) clearTimeout(_toastHideTimer);
  _toastHideTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 400);
  }, dwell);
}

/* Close full task panel */
window.closeTaskPanel = function() {
  document.getElementById('task-panel').classList.add('hidden');
  document.getElementById('task-hud').style.display  = '';
  document.getElementById('map-camera-fab').style.display = '';
  document.getElementById('map-hint').style.display  = '';
};

/* Switch tab */
window.switchTaskTab = function(cat) {
  _taskPanelCat = cat;
  document.querySelectorAll('.tp-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
  _renderTaskPanel(cat);
};

/* Render tasks into the full panel list */
function _renderTaskPanel(filterCat) {
  const list = document.getElementById('tp-list');
  list.innerHTML = '';
  _taskUpdateProgress();

  const tasks = filterCat === 'all'
    ? _allTasks
    : _allTasks.filter(t => _taskCat(t) === filterCat);

  if (!tasks.length) {
    list.innerHTML = `<div style="text-align:center;padding:30px;color:var(--txt2);font-size:13px;">
      💡 No notes yet<br><small>Chat with the fox or bring back some discoveries — notes will appear</small></div>`;
    return;
  }

  // Render with NEW badges for unseen tasks
  tasks.forEach(task => {
    const cat   = _taskCat(task);
    const isNew = !!task.isNew;
    const el = document.createElement('div');
    el.className = `tp-task ${cat}${task.done ? ' done' : ''}${isNew ? ' has-new' : ''}`;
    el.id = `tp-task-${task.id}`;
    const depthHTML = task.depthAngle
      ? `<div class="tp-task-depth"><span class="tp-task-depth-icon">💡</span><span>${_esc(task.depthAngle)}</span></div>`
      : '';
    const timeHintHTML = task.timeHint ? `<span class="tp-task-tag tp-task-time">${_esc(task.timeHint)}</span>` : '';
    const durHTML      = task.duration ? `<span class="tp-task-tag tp-task-dur">⏱ ${_esc(task.duration)}</span>` : '';

    el.innerHTML = `
      <div class="tp-task-icon">${_taskCatIcon(cat)}</div>
      <div class="tp-task-body">
        <div class="tp-task-title">${task.title}${task.isStarter ? '<span class="tp-starter-badge">🟢 Starter</span>' : ''}${isNew ? '<span class="tp-task-newbadge">NEW</span>' : ''}</div>
        <div class="tp-task-desc">${task.desc || ''}</div>
        ${depthHTML}
        <div class="tp-task-meta">
          <span class="tp-task-loc">📍 ${task.location || ''}</span>
          ${timeHintHTML}
          ${durHTML}
          <span class="tp-task-pts">+${task.points} pts</span>
        </div>
      </div>
      <button class="tp-task-check"
        onclick="AgentSystem.completeTask('${task.id}')"
        ${task.done ? 'disabled' : ''} title="Mark complete">✓</button>
      <button class="tp-task-del"
        onclick="window._deleteTask('${task.id}')"
        title="Delete quest">✕</button>`;
    list.appendChild(el);
  });

  // After rendering, mark all tasks as seen (delay so user can spot NEW badges first)
  setTimeout(() => {
    AgentSystem.markAllTasksSeen();
    _allTasks.forEach(t => { t.isNew = false; });
    // Fade out NEW badges in HUD
    document.querySelectorAll('.thud-item-newbadge').forEach(b => {
      b.style.transition = 'opacity .4s'; b.style.opacity = '0';
      setTimeout(() => b.remove(), 400);
    });
    document.querySelectorAll('.thud-item.has-new').forEach(it => it.classList.remove('has-new'));
  }, 1500);
}

/* Delete a task (only uncompleted) */
window._deleteTask = function(taskId) {
  const ctx = AgentSystem.getCtx();
  const task = ctx.tasks.find(t => t.id === taskId);
  if (!task || task.done) return;   // cannot delete completed tasks

  // Remove from context
  const idx = ctx.tasks.indexOf(task);
  if (idx !== -1) ctx.tasks.splice(idx, 1);

  // Remove from HUD
  document.getElementById(`thud-${taskId}`)?.remove();

  // Refresh tab counts (a task was just removed)
  _refreshThudTabCounts();

  // Remove from full panel list
  const tpEl = document.getElementById(`tp-task-${taskId}`);
  if (tpEl) { tpEl.style.opacity = '0'; tpEl.style.transform = 'scale(.9)'; setTimeout(() => tpEl.remove(), 200); }

  // Remove from _allTasks
  const ai = _allTasks.findIndex(t => t.id === taskId);
  if (ai !== -1) _allTasks.splice(ai, 1);

  // Persist
  localStorage.setItem('wq_state_v1', JSON.stringify({
    tasks: ctx.tasks, discovered: ctx.discovered,
    achievements: ctx.achievements, score: ctx.score,
  }));

  _taskUpdateProgress();
};

/* Toggle HUD collapse */
window.toggleTaskHUD = function() {
  document.getElementById('task-hud').classList.toggle('collapsed');
};

/* Toggle Gallery panel */
window.toggleGallery = function() {
  document.getElementById('gallery-panel').classList.toggle('collapsed');
};

/* ═══════════════════════════════════════════════════════════════════════
   SHARE TODAY'S DISCOVERIES → generates a 1080×1350 portrait share image
   from the user's today-only finds. Pure Canvas (no libs).
   ═══════════════════════════════════════════════════════════════════════ */
let _shareBlob = null;          // last generated blob (for download/copy)
let _shareObjUrl = null;        // last object URL (revoked on close)

window.shareTodayDiscoveries = async function() {
  const ctx = AgentSystem.getCtx();
  // Filter to today's items (Singapore local day boundary based on user machine)
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startMs = startOfToday.getTime();
  const todayItems = (ctx.discovered || [])
    .filter(d => (d.ts || 0) >= startMs)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));

  document.getElementById('share-modal').classList.remove('hidden');
  document.getElementById('sm-loading').classList.remove('hidden');
  document.getElementById('sm-preview-wrap').classList.add('hidden');
  document.getElementById('sm-empty').classList.add('hidden');
  document.getElementById('sm-footer').classList.add('hidden');

  if (todayItems.length === 0) {
    document.getElementById('sm-loading').classList.add('hidden');
    document.getElementById('sm-empty').classList.remove('hidden');
    return;
  }

  try {
    const blob = await _buildShareImage(todayItems, ctx.planetName || 'My Planet');
    _shareBlob = blob;
    if (_shareObjUrl) URL.revokeObjectURL(_shareObjUrl);
    _shareObjUrl = URL.createObjectURL(blob);

    document.getElementById('sm-preview-img').src = _shareObjUrl;
    document.getElementById('sm-loading').classList.add('hidden');
    document.getElementById('sm-preview-wrap').classList.remove('hidden');
    document.getElementById('sm-footer').classList.remove('hidden');
  } catch (e) {
    console.error('[share] generate failed', e);
    document.getElementById('sm-loading').classList.add('hidden');
    document.getElementById('sm-empty').classList.remove('hidden');
    document.querySelector('#sm-empty .sm-empty-title').textContent = 'Failed to generate 😢';
    document.querySelector('#sm-empty .sm-empty-sub').textContent   = (e?.message || 'Unknown error');
  }
};

window.closeShareModal = function() {
  document.getElementById('share-modal').classList.add('hidden');
  if (_shareObjUrl) { URL.revokeObjectURL(_shareObjUrl); _shareObjUrl = null; }
  _shareBlob = null;
};

window.downloadShareImage = function() {
  if (!_shareBlob) return;
  const a = document.createElement('a');
  const ts = new Date();
  const stamp = `${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}`;
  a.download = `WorldQuest_${stamp}.png`;
  a.href = _shareObjUrl;
  a.click();
};

window.copyShareImage = async function() {
  if (!_shareBlob) return;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': _shareBlob })
    ]);
    _addMsg('sys', '📋 Share image copied — paste it into WeChat / Twitter / Slack.');
  } catch (e) {
    console.warn('[share] copy failed (browser may not support)', e);
    _addMsg('sys', '⚠️ Your browser cannot copy images to the clipboard — please click "Download" instead.');
  }
};

/* ── Image loader helper (Promise wrapper) ──────────────────────────── */
function _loadImg(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* ── Stable, short planet ID derived from planet birth time + name ──── */
function _planetId() {
  const ctx = AgentSystem.getCtx();
  const seed = String(ctx.planetStartMs || 0) + (ctx.planetName || '');
  // Simple deterministic 32-bit hash
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const code = (Math.abs(h)).toString(36).toUpperCase().padStart(5, '0').slice(-5);
  return `PL-${code}`;
}

/* ── Real-world day count since the planet was born (1-indexed) ─────── */
function _planetDayReal() {
  const ctx = AgentSystem.getCtx();
  const start = ctx.planetStartMs || Date.now();
  const startDay = new Date(start); startDay.setHours(0, 0, 0, 0);
  const today    = new Date();      today.setHours(0, 0, 0, 0);
  const diff = Math.max(0, Math.floor((today - startDay) / 86400000));
  return diff + 1;
}

/* ── Build the 1080×1350 share image as a Blob ──────────────────────── */
async function _buildShareImage(items, planetName) {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');

  // ── 1. Cosmic gradient background ───────────────────────────────────
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0,   '#0a0e1f');
  bg.addColorStop(0.45,'#101736');
  bg.addColorStop(1,   '#1a1142');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  // Star sprinkle
  c.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = Math.random() * 1.5 + 0.4;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }

  // Accent glow blobs
  const glow1 = c.createRadialGradient(W * 0.85, 120, 0, W * 0.85, 120, 300);
  glow1.addColorStop(0, 'rgba(0,212,255,0.35)');
  glow1.addColorStop(1, 'rgba(0,212,255,0)');
  c.fillStyle = glow1;
  c.fillRect(0, 0, W, 500);

  const glow2 = c.createRadialGradient(W * 0.15, H - 180, 0, W * 0.15, H - 180, 320);
  glow2.addColorStop(0, 'rgba(255,140,200,0.28)');
  glow2.addColorStop(1, 'rgba(255,140,200,0)');
  c.fillStyle = glow2;
  c.fillRect(0, H - 500, W, 500);

  // ── Stats for header + planet info card + footer ────────────────────
  const ctx = AgentSystem.getCtx();
  const stats   = _calcPlanetStats();
  const pid     = _planetId();
  const dayN    = _planetDayReal();
  const bondVal = ctx.foxBond ?? 0;

  // ── 2. Header block: planet name (left) + planet ID badge (right) ──
  const now  = new Date();
  const ds   = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')}`;
  const dow  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()];

  // Planet ID pill in top-right
  c.font = '600 22px Inter, -apple-system, sans-serif';
  const pidText = `${pid}  ·  Lv.${stats.level}`;
  const pidW = c.measureText(pidText).width + 36;
  const pidH = 42;
  const pidX = W - 60 - pidW;
  const pidY = 56;
  _roundRect(c, pidX, pidY, pidW, pidH, pidH / 2);
  c.fillStyle = 'rgba(0,212,255,0.14)';
  c.fill();
  c.strokeStyle = 'rgba(0,212,255,0.55)';
  c.lineWidth = 1.5;
  c.stroke();
  c.fillStyle = '#9bd1ff';
  c.textAlign = 'left';
  c.fillText(pidText, pidX + 18, pidY + 28);

  // Planet name (left)
  c.fillStyle = '#9bd1ff';
  c.font = '500 28px Inter, -apple-system, sans-serif';
  c.textAlign = 'left';
  c.fillText('🌍 ' + planetName, 60, 90);

  c.fillStyle = '#ffffff';
  c.font = '700 64px Inter, -apple-system, sans-serif';
  c.fillText("Today's Finds", 60, 175);

  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.font = '400 24px Inter, -apple-system, sans-serif';
  c.fillText(`${ds}  ·  ${dow}  ·  ${items.length} items`, 60, 220);

  // Decorative line
  c.strokeStyle = 'rgba(0,212,255,0.35)';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(60, 250); c.lineTo(220, 250); c.stroke();

  // ── 3. Photo grid (height reserved for info card + footer below) ──
  const INFO_CARD_H = 180;     // planet info block height (incl. label)
  const FOOTER_H    = 130;
  const RESERVED    = INFO_CARD_H + FOOTER_H + 40;   // bottom area
  const cols = items.length <= 1 ? 1 : items.length <= 4 ? 2 : 3;
  const gap  = 20;
  const padX = 60;
  const gridW = W - padX * 2;
  const cellW = (gridW - gap * (cols - 1)) / cols;
  const photoH = cellW * 0.88;
  const captionH = 78;
  const cellH = photoH + captionH;

  const gridTop = 290;
  const maxRows = Math.floor((H - gridTop - RESERVED) / (cellH + gap)) || 1;
  const maxCells = cols * maxRows;
  const showItems  = items.slice(0, maxCells);
  const extraCount = items.length - showItems.length;

  const imgs = await Promise.all(showItems.map(it => _loadImg(it.photoSrc)));

  showItems.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padX + col * (cellW + gap);
    const y = gridTop + row * (cellH + gap);

    _roundRect(c, x, y, cellW, cellH, 18);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fill();
    c.strokeStyle = 'rgba(0,212,255,0.25)';
    c.lineWidth = 1.5;
    c.stroke();

    c.save();
    _roundRect(c, x + 8, y + 8, cellW - 16, photoH - 8, 12);
    c.clip();
    const img = imgs[i];
    if (img) {
      const ir = img.width / img.height;
      const cr = (cellW - 16) / (photoH - 8);
      let dw, dh, dx, dy;
      if (ir > cr) { dh = photoH - 8; dw = dh * ir; dx = x + 8 - (dw - (cellW - 16)) / 2; dy = y + 8; }
      else         { dw = cellW - 16; dh = dw / ir; dx = x + 8; dy = y + 8 - (dh - (photoH - 8)) / 2; }
      c.drawImage(img, dx, dy, dw, dh);
    } else {
      c.fillStyle = 'rgba(0,0,0,0.4)';
      c.fillRect(x + 8, y + 8, cellW - 16, photoH - 8);
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.font = '64px serif';
      c.textAlign = 'center';
      c.fillText(_categoryEmoji(it.category), x + cellW / 2, y + photoH / 2 + 22);
    }
    c.restore();

    const ty = y + photoH + 26;
    const catEmoji = _categoryEmoji(it.category);
    const catName  = _catLabel(it.category);
    c.fillStyle = '#9bd1ff';
    c.textAlign = 'left';
    c.font = '600 16px Inter, -apple-system, sans-serif';
    c.fillText(`${catEmoji} ${catName}`, x + 18, ty);

    c.fillStyle = '#ffffff';
    c.font = '700 22px Inter, -apple-system, sans-serif';
    const name = _truncForCanvas(c, it.name || 'Mystery Find', cellW - 36);
    c.fillText(name, x + 18, ty + 30);
  });

  if (extraCount > 0) {
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.font = '500 18px Inter, -apple-system, sans-serif';
    c.textAlign = 'center';
    c.fillText(`… ${extraCount} more not shown`, W / 2, gridTop + maxRows * (cellH + gap) + 14);
  }

  // ── 4. Planet Info Card (5 stat tiles in a row) ─────────────────────
  const infoY = H - FOOTER_H - INFO_CARD_H + 10;
  const cardX = 60, cardW = W - 120;
  _roundRect(c, cardX, infoY, cardW, INFO_CARD_H - 20, 18);
  c.fillStyle = 'rgba(255,255,255,0.04)';
  c.fill();
  c.strokeStyle = 'rgba(0,212,255,0.28)';
  c.lineWidth = 1.5;
  c.stroke();

  // Card label
  c.fillStyle = '#9bd1ff';
  c.font = '600 18px Inter, -apple-system, sans-serif';
  c.textAlign = 'left';
  c.fillText('🌍  Planet Profile', cardX + 24, infoY + 32);

  // Sub-line: planet ID + day
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.font = '400 13px Inter, -apple-system, sans-serif';
  c.textAlign = 'right';
  c.fillText(`${pid}  ·  Day ${dayN}`, cardX + cardW - 24, infoY + 32);

  // Five stat tiles
  const tiles = [
    { v: `Lv.${stats.level}`,     l: 'Level',     color: '#ffd166' },
    { v: stats.total,             l: 'Collected', color: '#9bd1ff' },
    { v: bondVal,                 l: '❤️ Bond',   color: '#ff8a8a' },
    { v: stats.energy,            l: '⚡ Energy', color: '#a0ffd1' },
    { v: `Day ${dayN}`,           l: 'Planet Age',color: '#d1a8ff' },
  ];
  const tilePad = 18;
  const tileGap = 10;
  const tilesY = infoY + 56;
  const tilesH = 92;
  const tileW = (cardW - tilePad * 2 - tileGap * (tiles.length - 1)) / tiles.length;

  tiles.forEach((t, i) => {
    const tx = cardX + tilePad + i * (tileW + tileGap);
    _roundRect(c, tx, tilesY, tileW, tilesH, 12);
    c.fillStyle = 'rgba(0,212,255,0.05)';
    c.fill();

    c.fillStyle = t.color;
    c.font = '700 30px Inter, -apple-system, sans-serif';
    c.textAlign = 'center';
    c.fillText(String(t.v), tx + tileW / 2, tilesY + 44);

    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.font = '500 13px Inter, -apple-system, sans-serif';
    c.fillText(t.l, tx + tileW / 2, tilesY + 72);
  });

  // ── 5. Footer (today + watermark) ───────────────────────────────────
  const footerY = H - 80;
  c.fillStyle = 'rgba(255,255,255,0.08)';
  c.fillRect(60, footerY - 18, W - 120, 1);

  c.fillStyle = '#9bd1ff';
  c.font = '600 22px Inter, -apple-system, sans-serif';
  c.textAlign = 'left';
  c.fillText(`+${items.length} today · 🏛️${stats.civ}  🌿${stats.eco}  🍜${stats.culture}`, 60, footerY + 14);

  c.fillStyle = '#ffffff';
  c.textAlign = 'right';
  c.font = '700 24px Inter, -apple-system, sans-serif';
  c.fillText('WorldQuest', W - 60, footerY + 4);
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.font = '400 14px Inter, -apple-system, sans-serif';
  c.fillText('Tending a tiny planet with the fox', W - 60, footerY + 30);

  // ── 6. Output ───────────────────────────────────────────────────────
  return await new Promise((res) => canvas.toBlob(b => res(b), 'image/png', 0.92));
}

function _roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

function _truncForCanvas(c, text, maxPx) {
  if (c.measureText(text).width <= maxPx) return text;
  let lo = 1, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.measureText(text.slice(0, mid) + '…').width <= maxPx) lo = mid + 1;
    else hi = mid;
  }
  return text.slice(0, Math.max(1, lo - 1)) + '…';
}

/* Submit regenerate prompt from task panel */
window.submitRegenTask = async function() {
  const input  = document.getElementById('tp-regen-input');
  const btn    = document.getElementById('tp-regen-btn');
  const status = document.getElementById('tp-regen-status');
  const text   = input.value.trim();
  if (!text) return;

  // Show loading state
  input.disabled = true;
  btn.disabled   = true;
  status.classList.remove('hidden');
  status.innerHTML = `<div class="regen-spinner"></div><span>AI is drafting quests…</span>`;

  // Send to agent system (PlannerAgent will pick it up + add tasks)
  await AgentSystem.sendMessage(text);

  // Reset
  input.value    = '';
  input.disabled = false;
  btn.disabled   = false;
    status.innerHTML = '✅ Quests updated!';
  setTimeout(() => {
    status.classList.add('hidden');
    // Refresh the panel list
    _renderTaskPanel(_taskPanelCat);
  }, 1500);
};

/* ══════════════════════════════════════════════════════════════════════════
   IMAGE COMPRESSION  — shrink photo to thumbnail before storing
   ══════════════════════════════════════════════════════════════════════════ */

function _compressImage(dataSrc, maxDim = 480, quality = 0.78) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const ratio  = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(null);
    img.src = dataSrc;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   STATE RESTORATION  — rebuild UI + map from localStorage on page load
   ══════════════════════════════════════════════════════════════════════════ */

let _isRestoring = false;   // suppresses side-effects (chat messages) during restore

function _restoreState() {
  const saved = AgentSystem.getSavedState();
  if (!saved) return;

  _isRestoring = true;

  try {
    // Score + item count
    if (saved.score)              window.UI.onScoreUpdate(saved.score);
    if (saved.discovered?.length) window.UI.onItemCountUpdate(saved.discovered.length);

    // Tasks — use ctx (current truth) instead of saved snapshot, so any
    // auto-injected sponsor tasks (e.g. SuperAI 2026) also show on load.
    const liveTasks = AgentSystem.getCtx().tasks;
    if (liveTasks?.length) {
      liveTasks.forEach(t => {
        _taskAddToHUD(t);
        if (t.done) _taskMarkDone(t.id);
      });
      _taskUpdateProgress();
    }

    // Achievements (silent — no popup)
    saved.achievements?.forEach(a => {
      const el = document.getElementById(`ach-${a.id}`);
      if (el) {
        el.classList.remove('locked');
        el.classList.add('unlocked');
      } else {
        document.getElementById('achievements-container').prepend(_makeAchEl(a, false));
      }
    });

    // Discovered items — map + gallery (suppress particle burst during restore)
    saved.discovered?.forEach(item => {
      SingaporeMap.addDiscoveredItem({
        name:       item.name,
        category:   item.category,
        locationId: item.locationId,
        color:      null,
        type:       null,
        // Spherical position from the last session (falls back to non-overlap spiral if missing)
        theta:      item.theta,
        phi:        item.phi,
        _restoring: true,
      });
      galleryAddItem(item);
    });

    const taskCount     = saved.tasks?.length ?? 0;
    const discoverCount = saved.discovered?.length ?? 0;
    if (taskCount || discoverCount) {
      _addMsg('sys', `🦊 The fox remembers you · ${discoverCount} brought back · ${taskCount} wishes waiting`);
    }

  } finally {
    _isRestoring = false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   PHOTO MOOD MODAL  — 2-phase: input → AI result → confirm / correct
   ══════════════════════════════════════════════════════════════════════════ */

let _pendingPhotoSrc    = null;
let _visionAbortController = null;
let _pendingPhotoBase64 = null;
let _pendingMood        = '';
let _pendingContext     = {};     // structured: { time, weather, company, note }
let _pendingResult      = null;

/* ── Open moment-share modal (text-first, photo optional) ────────────── */
window.openMomentShare = function(dataSrc) {
  _pendingPhotoSrc    = dataSrc || null;
  _pendingPhotoBase64 = dataSrc ? dataSrc.split(',')[1] : null;
  _pendingResult      = null;
  _pendingContext     = {};

  document.getElementById('pm-mood').value      = '';
  document.getElementById('pm-submit').disabled = false;
  document.getElementById('pm-header-text').textContent = 'Capture this moment';

  // Reset chips
  document.querySelectorAll('.pm-choice').forEach(c => c.classList.remove('selected'));

  // Auto-detect time of day
  const h = new Date().getHours();
  const autoTime = h < 6 ? 'morning' : h < 12 ? 'morning' : h < 17 ? 'day' : h < 19 ? 'evening' : 'night';
  const timeBtn = document.querySelector(`.pm-chip-row[data-group="time"] .pm-choice[data-value="${autoTime}"]`);
  if (timeBtn) {
    timeBtn.classList.add('selected');
    _pendingContext.time = autoTime;
  }

  _wireChoiceChips();
  _refreshPhotoSection();
  _refreshSubmitButton();

  _showPhase(1);
  document.getElementById('photo-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('pm-mood').focus(), 250);
};

/** Legacy alias — called when a file picker delivers an image directly */
function _openPhotoModal(dataSrc) {
  window.openMomentShare(dataSrc);
}

/** Show/hide photo hero image vs placeholder depending on whether a photo is set */
function _refreshPhotoSection() {
  const hero        = document.getElementById('pm-photo-thumb');
  const placeholder = document.getElementById('pm-photo-add-btn');
  const img         = document.getElementById('pm-preview');
  if (_pendingPhotoSrc) {
    img.src = _pendingPhotoSrc;
    hero.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    hero.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }
}

/** Submit button label adapts to "AI Identify" vs "Share to planet" */
function _refreshSubmitButton() {
  const icon  = document.getElementById('pm-submit-icon');
  const label = document.getElementById('pm-submit-label');
  if (_pendingPhotoSrc) {
    icon.textContent  = '🔬';
    label.textContent = 'AI Identify';
  } else {
    icon.textContent  = '✨';
    label.textContent = 'Share to planet';
  }
}

window.removeAttachedPhoto = function() {
  _pendingPhotoSrc    = null;
  _pendingPhotoBase64 = null;
  _refreshPhotoSection();
  _refreshSubmitButton();
};

/* Wire up chip selection (single-select per group) */
function _wireChoiceChips() {
  document.querySelectorAll('.pm-chip-row').forEach(row => {
    const group = row.dataset.group;
    row.querySelectorAll('.pm-choice').forEach(btn => {
      btn.onclick = () => {
        const wasSelected = btn.classList.contains('selected');
        // Single-select within group
        row.querySelectorAll('.pm-choice').forEach(b => b.classList.remove('selected'));
        if (!wasSelected) {
          btn.classList.add('selected');
          _pendingContext[group] = btn.dataset.value;
        } else {
          delete _pendingContext[group];
        }
      };
    });
  });
}

function _closePhotoModal() {
  document.getElementById('photo-modal').classList.add('hidden');
  _pendingPhotoSrc = _pendingPhotoBase64 = _pendingResult = null;
}

window.backToPhase1 = function() {
  _showPhase(1);
  document.getElementById('pm-header-text').textContent = 'Capture this moment';
};

function _showPhase(n) {
  document.getElementById('pm-phase1').classList.toggle('hidden', n !== 1);
  document.getElementById('pm-phase2').classList.toggle('hidden', n !== 2);
}

/* ── Submit Phase 1 → run Vision AI ──────────────────────────────────── */
async function _submitPhotoModal() {
  _pendingMood = document.getElementById('pm-mood').value.trim();
  if (!_pendingMood && !_pendingPhotoBase64) {
    document.getElementById('pm-mood').focus();
    return;
  }
  _pendingContext.note = _pendingMood;
  _pendingContext.timestamp = new Date().toISOString();

  // Save full structured context to 40-msg memory for ContextAgent
  const summary = _summarizeContext(_pendingContext);
  if (summary) AgentSystem.rememberInput(`📝 ${summary}`);

  document.getElementById('pm-submit').disabled = true;

  // ── Branch A: photo present → Vision Agent (existing flow) ─────────
  if (_pendingPhotoBase64) {
    _showPhase(2);
    document.getElementById('pm-header-text').textContent = 'Identifying…';
    document.getElementById('pm-loading').classList.remove('hidden');
    document.getElementById('pm-result-body').classList.add('hidden');
    document.getElementById('pm-confirm').classList.add('hidden');
    await _runVision(_pendingPhotoBase64, null);
    return;
  }

  // ── Branch B: text-only → close modal + send as user message ───────
  _closePhotoModal();

  // Build a readable message combining context + note
  const tagParts = [];
  if (_pendingContext.time)    tagParts.push(`⏰ ${_pendingContext.time}`);
  if (_pendingContext.weather) tagParts.push(`🌤️ ${_pendingContext.weather}`);
  if (_pendingContext.company) tagParts.push(`👥 ${_pendingContext.company}`);
  const tagLine = tagParts.join(' · ');
  const userMessage = tagLine
    ? `${_pendingMood}\n\n${tagLine}`
    : _pendingMood;

  _addMsg('user', userMessage);
  _showTyping();
  AgentSystem.sendMessage(userMessage);
}

/* Build a human-readable summary of structured context */
function _summarizeContext(c) {
  const parts = [];
  if (c.time)    parts.push(`time=${c.time}`);
  if (c.weather) parts.push(`weather=${c.weather}`);
  if (c.company) parts.push(`company=${c.company}`);
  if (c.note)    parts.push(`note="${c.note}"`);
  return parts.join('，');
}

/* ── Cancel an in-flight vision request ──────────────────────────────── */
let _visionCancelled = false;        // set true by user click → in-flight result is discarded

window.cancelVision = function(source) {
  console.warn('[Vision] cancelVision() called from:', source || 'user-click');
  _visionCancelled = true;

  // Try to abort the fetch (best-effort — may not interrupt r.json())
  if (_visionAbortController) {
    try { _visionAbortController.abort('user-cancel'); } catch (_) {}
    _visionAbortController = null;
  }

  // Immediately reset UI — don't wait for fetch to actually reject
  _stopVisionElapsedTimer();
  document.getElementById('pm-fail')?.classList.add('hidden');
  document.getElementById('pm-loading')?.classList.add('hidden');
  if (window.backToPhase1) window.backToPhase1();
  const sub = document.getElementById('pm-submit');
  if (sub) sub.disabled = false;
  _addMsg('sys', '⛔ Scan cancelled.');
};

/* ── Elapsed timer + "this is taking a while" hint ──────────────────── */
let _visionElapsedInterval = null;
function _startVisionElapsedTimer() {
  const startMs   = Date.now();
  const elapsedEl = document.getElementById('pm-loading-elapsed');
  const textEl    = document.getElementById('pm-loading-text');
  if (_visionElapsedInterval) clearInterval(_visionElapsedInterval);
  _visionElapsedInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startMs) / 1000);
    if (elapsedEl) elapsedEl.textContent = `${s}s`;
    if (textEl && s > 20)  textEl.textContent = 'Still identifying… network or photo size may be slow';
    if (textEl && s > 45)  textEl.textContent = 'Almost done, hang on…';
  }, 1000);
}
function _stopVisionElapsedTimer() {
  if (_visionElapsedInterval) clearInterval(_visionElapsedInterval);
  _visionElapsedInterval = null;
}

/* ── Core vision call ─────────────────────────────────────────────────── */
async function _runVision(base64, correctionHint) {
  _visionCancelled = false;          // reset every fresh run
  document.getElementById('pm-loading').classList.remove('hidden');
  document.getElementById('pm-loading-text').textContent = 'Planet AI is scanning…';
  document.getElementById('pm-loading-elapsed').textContent = '0s';
  document.getElementById('pm-result-body').classList.add('hidden');
  document.getElementById('pm-confirm').classList.add('hidden');
  document.getElementById('pm-fail')?.classList.add('hidden');
  if (document.getElementById('pm-rerecognize-btn')) {
    document.getElementById('pm-rerecognize-btn').disabled = true;
  }
  _startVisionElapsedTimer();

  try {
    const ctxSummary = _summarizeContext(_pendingContext || {});
    const userCtxBlock = ctxSummary ? `\n\nUser-provided shooting context (you MUST factor this into recognition):\n${ctxSummary}` : '';
    const correction   = correctionHint ? `\n\nUser correction hint: "${correctionHint}". Treat this as the strongest signal.` : '';

    // Pass the user's recent discoveries so the AI can reuse an existing name
    // when the new photo is clearly the same dish/landmark they've recorded
    // before (avoids creating duplicate species).
    const sysCtx = AgentSystem.getCtx();
    const recentDisc = (sysCtx.discovered || []).slice(-20);
    const recentBlock = recentDisc.length
      ? `\n\n[★ Already in the user's planet codex — last 20 entries ★]\n${recentDisc.map(d => `- ${d.name}${d.nameEn ? ' / ' + d.nameEn : ''} (${d.category})`).join('\n')}\n\nProcess: scan the list above first. If this photo clearly depicts the same item/dish/landmark as one of the entries, you MUST output the EXACT same name, nameEn and category — character-for-character — so the front-end recognizes it as "already collected". Only invent a fresh name if it really is something new.`
      : '';

    const prompt = `You are the WorldQuest Singapore-culture identification AI. Identify this photo using THREE sources:
1) The visible content of the photo
2) The user's shooting context${userCtxBlock}${correction}
3) The user's existing codex (for dedupe)${recentBlock}

[Hard rules · do not fabricate]
- Output only facts you can derive from the photo + user notes.
- Do not invent people, dialogue, or events not shown.
- Do not make up historical details, dates or events.
- If a field has no basis, write "unknown" rather than guess.

[★ User notes are the strongest signal ★]
- If the user note names an item (e.g. "laksa" / "Hainanese chicken rice" / "Merlion" / "MBS"), you MUST adopt it as identified.name.
- If the user calls it food, it's food; if they call it a building, it's a building. Don't override.
- Example: note contains "laksa" → name must be "Laksa", category must be food.
- Example: note contains "Hainanese chicken rice" → name "Hainanese Chicken Rice", category food.

[★ Food recognition · highest priority ★]
- A dish in a plate/bowl, or a drink in a cup → category MUST be food / dessert / drink / snack, NOT landmark / building / souvenir.
- Common Singapore foods: Laksa, Hainanese Chicken Rice, Chili Crab, Bak Kut Teh, Char Kway Teow, Hokkien Mee, Satay, Nasi Lemak, Roti Prata, Kaya Toast, Teh Tarik, Kopi, Ice Kacang, Chendol, Curry Puff.
- Red broth + rice noodles + prawns / fishcake / tofu puffs / egg → almost certainly Laksa.
- White rice + poached white chicken + cucumber slices + chili dip → Hainanese Chicken Rice.
- Brown-sauced crab → Chili Crab.
- Glossy green rice + peanuts + anchovies + cucumber + egg → Nasi Lemak.

[Architecture / landmark recognition]
- Be proactive about identifying SG landmarks by visual silhouette:
  - Three towers crowned by a boat-shaped roof = Marina Bay Sands
  - Multi-layer terraced vertical greenery = Parkroyal Collection Pickering (or CapitaSpring)
  - 18 metallic tree structures = Gardens by the Bay Supertree Grove
  - Lotus-shaped glass building = ArtScience Museum
  - Giant pinwheel Ferris wheel = Singapore Flyer
  - Colonial white façade + clocktower = Fullerton Hotel / Victoria Theatre
  - Round-domed stadium = Singapore Sports Hub
- When confident, give the exact name + detailed geo info (address / district / nearest MRT).
- Only fall back to "Unknown building" with confidence < 0.4 if truly unsure.

Categories — pick ONE from the 20 below, grouped into three tribes:

[CIV · built environment]
- landmark: famous landmarks (Merlion, MBS, Supertrees, Cloud Forest, etc.)
- building: ordinary buildings (HDB flats, offices, malls, shophouses)
- religion: places of worship (temples / mosques / churches / Indian temples)
- sign: signage, posters, street signs, menus
- transportation: bus, MRT, taxi, boat, cable car, bicycle, scooter
- technology: screens, kiosks, robots, electronic devices, smart-home gear

[ECO · living world]
- plant: trees, shrubs, palms, tropical plants (NOT a single-flower close-up)
- flower: close-up of a single bloom (orchid, bougainvillea, frangipani…)
- animal: mammals / birds (cats, dogs, squirrels, herons, orangutans)
- insect: insects (butterflies, dragonflies, bees, ladybugs)
- sea_creature: aquatic life (fish, crabs, shellfish, aquarium animals)
- fruit: raw fruits (durian, mango, coconut, pineapple, dragon fruit) — fruit AS-IS, not cooked dishes

[CULTURE · food / expression]
- food: mains served on a plate / bowl (Hainanese chicken rice, laksa, char kway teow, satay, curry…)
- dessert: cold sweets (Ice Kacang, Chendol, ice cream, cake)
- drink: liquids in a cup (Kopi, Teh, Bandung, juice, bubble tea)
- snack: small bites (Kaya toast, curry puffs, packaged snacks, biscuits)
- person: a person
- art: art (paintings, murals, graffiti, sculptures, installations, exhibits)
- fashion: clothing/outfits (boutique window, traditional sarong/baju kurung, street style)
- souvenir: keepsakes (keychains, postcards, collab plushies, brand merch, limited badges)

[Decision rules · in order of priority]
1. Edible item in a plate/bowl → food / dessert / snack (pick by main / sweet / nibble).
2. Liquid in a cup → drink.
3. Whole raw fruit → fruit; cooked into a dish → food.
4. Single-flower close-up → flower; a tree or shrub clump → plant.
5. Living thing in water → sea_creature; terrestrial mammal / bird → animal; small winged bug → insect.
6. Screen / device / robot → technology.
7. Stupa / cross / crescent / temple features → religion.
8. Apparel display / mannequin / traditional outfit → fashion.
9. Painting / sculpture / mural / installation → art.
10. Bus / metro / boat / taxi → transportation.
11. Plushie / keychain / postcard / brand merch → souvenir.
12. Plain building with no religious / government / landmark signature → building.

★ LANGUAGE: write ALL output strings in ENGLISH. Use the local name where appropriate (e.g. "Kaya Toast", "Marina Bay Sands"). Do NOT output Chinese.

Return STRICT JSON (important: no markdown fences, no text outside the JSON; newlines inside string values MUST be escaped as \\n; the whole thing must parse via JSON.parse directly):
{
  "identified": {
    "name": "English / local name based on photo + notes; use 'Unknown X' if unsure",
    "nameEn": "English name (often same as 'name')",
    "category": "landmark|building|religion|sign|transportation|technology|plant|flower|animal|insect|sea_creature|fruit|food|dessert|drink|snack|person|art|fashion|souvenir",
    "location": "Singapore place name; 'unknown' if neither photo nor note reveals it",
    "locationId": "one of marina_bay_sands|merlion_park|gardens_by_the_bay|chinatown|little_india|orchard_road|clarke_quay|sentosa|bugis_street|hawker_centre  (default: merlion_park)",
    "confidence": 0.0~1.0
  },
  "story": "★ ≤150 words, MUST be deep background knowledge the user cannot see from the photo ★\\n\\nYou are the little fox (Little-Prince style) sharing context with the Little Prince who just brought back this discovery. First person voice: 'I heard / I once read…'.\\n\\nMUST include (at least 3 of):\\n- Historical background / origin (year, policy, person)\\n- Cultural or policy reasoning ('why does this exist')\\n- Concrete data (numbers, efficiency, policy figures)\\n- Comparisons / rankings / 'best in district'\\n- Names of comparable peers\\n\\nMUST NOT:\\n× Describe the photo itself\\n× Repeat the user's note or feelings\\n× Objective narration like 'this building displays…' / 'the photo shows…'\\n× Customer-service tone\\n× Pile up vague adjectives\\n\\nGood example (vertical-greenery building):\\n'I read that Singapore launched its Garden City policy in 1967 and upgraded it to City in a Garden in 2009. The BCA Green Mark program plus the LUSH scheme lets developers trade vertical greenery for floor-area ratio. Facade greenery cuts wall temperature by 5–7°C and air-con energy use by 15–30%. Peers: Parkroyal Pickering, CapitaSpring, Oasia Hotel Downtown.'",
  "details": {
    /* fill the fields relevant to category; omit the others; 'unknown' when there's no basis */
    /* — animal — */
    "habitat":         "habitat, e.g. 'tropical urban greenery / rivers'",
    "activeSeason":    "active season, e.g. 'year-round' / 'migrating Nov-Mar'",
    "diet":            "diet, e.g. 'omnivore / herbivore / carnivore'",
    /* — plant — */
    "growEnvironment": "habitat, e.g. 'humid tropics / indoor ornamental'",
    "bloomSeason":     "bloom / peak season, e.g. 'evergreen' / 'blooms Mar–May'",
    "plantType":       "type, e.g. 'tree / shrub / herb / vine'",
    /* — food — */
    "ingredients":     "main ingredients, comma-separated, e.g. 'coconut milk, sugar, mung bean, pandan'",
    "sugarLevel":      "sweetness: low|medium|high|sugar-free|unknown",
    "calorieEstimate": "approx calories, e.g. '~150 kcal/serving'",
    "culturalNote":    "cultural context / customs, e.g. 'Peranakan dessert classic, afternoon-tea staple'",
    /* — building / landmark — */
    "builtYear":       "year built (use 'unknown' if not known)",
    "architect":       "architect / designer",
    "style":           "architectural style",
    "address":         "street address, e.g. '7 Hong Kong Street'",
    "district":        "district / area, e.g. 'CBD / Tanjong Pagar / Chinatown / Marina South'",
    "nearbyLandmark":  "nearby landmark reference, e.g. '~5 min walk from Raffles Place MRT'",
    "mrtStation":      "nearest MRT station",
    /* — transportation — */
    "operator":        "operator, e.g. 'SBS Transit'",
    "routeInfo":       "line / number info if visible",
    "mrtStation":      "nearest MRT",
    /* — sign — */
    "signPurpose":     "purpose, e.g. 'warning / directional / advertising / menu'",
    "signLanguage":    "language(s), e.g. 'bilingual English+Chinese'",
    /* — art — */
    "artForm":         "form, e.g. 'mural / sculpture / oil painting / installation / watercolor / digital art'",
    "artist":          "artist, 'unknown' if not known",
    "artYear":         "creation year / era",
    "artTheme":        "theme / meaning (based on visible info)",
    /* — souvenir — */
    "souvenirBrand":   "brand / IP if visible (e.g. 'Starbucks × Merlion collab' / 'SQ limited badge')",
    "souvenirType":    "type, e.g. 'keychain / plush / postcard / magnet / handcraft / limited drop'",
    "souvenirMaterial": "material, e.g. 'metal / felt / wood / ceramic' (if discernible)",
    "souvenirPrice":   "approx price range, e.g. '~SGD 15-25' (if there's a tag)"
  },
  "model3d": { "type": "building|tree|crystal|animal|food|star|transportation", "color": "#hex (dominant color in the photo)" },
  "achievement": { "unlock": true|false, "id": "snake_case_id", "icon": "emoji", "name": "Achievement name in English", "desc": "Achievement description (fact-based, English)" }
}`;

    // 60s timeout — if Qwen Vision takes longer, abort and surface error.
    // Use a LOCAL controller (not module-global) so a stale setTimeout from a
    // previous call can never abort the current one by mistake.
    const ctrl = new AbortController();
    _visionAbortController = ctrl;
    ctrl.signal.addEventListener('abort', () => {
      console.warn('[Vision] AbortSignal fired. reason=', ctrl.signal.reason);
    });
    const timeoutId = setTimeout(() => {
      console.warn('[Vision] 60s client timeout hit');
      ctrl.abort('client-timeout-60s');
    }, 60_000);

    console.log('[Vision] → POST /api/vision  bytes≈', base64.length);
    let r, d, raw;
    try {
      r = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, prompt }),
        signal: ctrl.signal,
      });
      console.log('[Vision] ← HTTP', r.status);
    } finally {
      clearTimeout(timeoutId);
    }
    if (_visionCancelled) return;                  // user clicked cancel mid-flight
    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      console.error('[Vision] HTTP', r.status, errBody.slice(0, 300));
      throw new Error(`Vision API ${r.status}`);
    }
    d   = await r.json();
    if (_visionCancelled) return;                  // discard late JSON if user already cancelled
    raw = d.choices?.[0]?.message?.content ?? '';

    _pendingResult = _parseVisionJSON(raw);
    if (!_pendingResult || !_pendingResult.identified) {
      console.error('[Vision] JSON parse failed. Raw output ↓\n', raw);
      throw new Error('JSON parse failed');
    }

  } catch (err) {
    if (_visionCancelled) return;                  // suppress AbortError noise from user cancel
    console.error('[Vision]', err);
    _stopVisionElapsedTimer();
    if (err.name === 'AbortError') {
      // Timeout (not user-initiated) → bounce to phase 1
      _visionAbortController = null;
      window.backToPhase1();
      document.getElementById('pm-submit').disabled = false;
      _addMsg('sys', '⛔ Identification timed out. Try a different photo, or add a keyword and rescan.');
      return;
    }
    _renderVisionError(err);
    _stopVisionElapsedTimer();
    _visionAbortController = null;
    return;
  } finally {
    _stopVisionElapsedTimer();
    _visionAbortController = null;
  }

  if (_visionCancelled) return;                    // last-mile safety before rendering result
  _renderResult(_pendingResult);
}

/* ── Robust JSON extractor for Vision output ─────────────────────────── */
function _parseVisionJSON(raw) {
  if (!raw) return null;

  // Strip common markdown fences like ```json ... ```
  let txt = String(raw).trim()
    .replace(/^```(?:json|JSON)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // Grab the outermost {...} block (greedy)
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let body = m[0];

  // Try direct parse first
  try { return JSON.parse(body); } catch (_) {}

  // Repair pass 1: escape literal newlines/tabs that appear *inside* JSON string values
  // (Qwen sometimes emits real \n inside the story field, which breaks JSON.parse.)
  const repaired = body.replace(/"((?:\\.|[^"\\])*)"/g, (full, inner) => {
    const safe = inner
      .replace(/\r/g, '')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
    return `"${safe}"`;
  });
  try { return JSON.parse(repaired); } catch (_) {}

  // Repair pass 2: remove trailing commas before } or ]
  const noTrail = repaired.replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(noTrail); } catch (_) {}

  return null;
}

/* ── Show a clear failure UI (instead of misleading fake "landmark") ── */
function _renderVisionError(err) {
  const reason = (err && err.message) ? err.message : 'unknown';
  document.getElementById('pm-loading').classList.add('hidden');
  document.getElementById('pm-result-body').classList.add('hidden');
  document.getElementById('pm-confirm').classList.add('hidden');
  const failEl = document.getElementById('pm-fail');
  if (failEl) {
    failEl.classList.remove('hidden');
    document.getElementById('pm-fail-reason').textContent = `Error: ${reason}`;
    // Reset manual category picker visibility on every entry
    document.getElementById('pm-cat-picker')?.classList.add('hidden');
  }
  document.getElementById('pm-header-text').textContent = 'Identification ran into trouble';
}

/* ── Retry: re-run vision with the same photo (optional new hint) ────── */
window.retryVision = async function() {
  const hintEl = document.getElementById('pm-correction-input');
  const hint   = hintEl ? hintEl.value.trim() : '';
  document.getElementById('pm-fail')?.classList.add('hidden');
  await _runVision(_pendingPhotoBase64, hint || null);
};

/* ── Manual category picker (rescue path when AI fails) ──────────────── */
window.togglePmCatPicker = function() {
  document.getElementById('pm-cat-picker')?.classList.toggle('hidden');
};

window.manualCategorize = function(cat) {
  const note = (_pendingMood || '').trim();
  // Use first line of user note as a reasonable name; fall back to "Unknown <label>"
  const meta = _catMeta(cat);
  const defaultName = `Unknown ${meta.label}`;
  const firstLine = note.split('\n')[0].slice(0, 24).trim();
  const name = firstLine || defaultName;

  _pendingResult = {
    identified: {
      name,
      nameEn: '',
      category: cat,
      location: 'Singapore',
      locationId: cat === 'food' ? 'hawker_centre' : 'merlion_park',
      confidence: 0.3,
    },
    story: "(Manually categorized — the AI couldn't recognize it; saving to your planet anyway.)",
    details: {},
    model3d: { type: cat === 'food' ? 'food' : 'crystal', color: '#9bd1ff' },
    achievement: { unlock: false },
  };

  document.getElementById('pm-fail')?.classList.add('hidden');
  _renderResult(_pendingResult);
}

/* ── Render result in Phase 2 ─────────────────────────────────────────── */
function _renderResult(result) {
  const { identified, story, details } = result;
  const catEmoji = _categoryEmoji(identified.category);
  const catName  = _catLabel(identified.category);

  document.getElementById('pm-result-thumb').src        = _pendingPhotoSrc;
  document.getElementById('pm-result-cat').textContent  = `${catEmoji} ${catName}`;
  document.getElementById('pm-result-name').textContent = identified.name;
  document.getElementById('pm-result-name-en').textContent = identified.nameEn || '';
  document.getElementById('pm-result-loc').textContent  = `📍 ${identified.location || 'Singapore'}`;
  document.getElementById('pm-result-story').textContent = story || '';
  document.getElementById('pm-correction-input').value  = '';

  // Re-attach cat name + emoji (textContent wiped the badges, re-append)
  const catEl = document.getElementById('pm-result-cat');
  catEl.textContent = `${catEmoji} ${catName}`;
  catEl.appendChild(document.getElementById('pm-species-new'));
  catEl.appendChild(document.getElementById('pm-species-old'));

  // Species check: fuzzy match across name + nameEn + category so user's
  // Repeat sightings ("eating it again") are correctly recognized.
  const ctx = AgentSystem.getCtx();
  const existing = _findExistingMatch(identified, ctx);
  document.getElementById('pm-species-new').classList.toggle('hidden', !!existing);
  document.getElementById('pm-species-old').classList.toggle('hidden', !existing);
  if (existing) {
    const date = new Date(existing.ts || Date.now());
    const sameDay = (date.toDateString() === new Date().toDateString());
    const dateStr = sameDay
      ? `today ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`
      : date.toLocaleDateString('en-US', { month:'2-digit', day:'2-digit' });
    document.getElementById('pm-species-old').textContent = `📚 In codex · ${dateStr}`;
  }

  // Show user's own note (if any) so the typing effort isn't lost from view
  _renderUserNote();

  // Render category-specific details
  _renderDetails(identified.category, details || {});

  document.getElementById('pm-loading').classList.add('hidden');
  document.getElementById('pm-fail')?.classList.add('hidden');
  document.getElementById('pm-result-body').classList.remove('hidden');
  document.getElementById('pm-confirm').classList.remove('hidden');
  document.getElementById('pm-header-text').textContent = 'Identification Result';
  if (document.getElementById('pm-rerecognize-btn')) {
    document.getElementById('pm-rerecognize-btn').disabled = false;
  }
}

/* ── Show user's own note + context tags in Phase 2 ──────────────────── */
function _renderUserNote() {
  const wrap     = document.getElementById('pm-user-note');
  const textEl   = document.getElementById('pm-user-note-text');
  const tagsEl   = document.getElementById('pm-user-note-tags');

  const hasNote  = _pendingMood && _pendingMood.trim().length > 0;
  const ctx      = _pendingContext || {};
  const hasTags  = !!(ctx.time || ctx.weather || ctx.company);

  if (!hasNote && !hasTags) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');

  textEl.textContent = hasNote ? _pendingMood : '(no text — but you picked these tags)';

  // Render context tags
  tagsEl.innerHTML = '';
  const addTag = (emoji, val) => {
    if (!val) return;
    const s = document.createElement('span');
    s.className = 'pm-user-note-tag';
    s.textContent = `${emoji} ${val}`;
    tagsEl.appendChild(s);
  };
  addTag('⏰', ctx.time);
  addTag('🌤️', ctx.weather);
  addTag('👥', ctx.company);
}

/* ── Render category-specific structured detail cards ─────────────────── */
function _renderDetails(category, d) {
  const container = document.getElementById('pm-details');
  container.innerHTML = '';

  const cards = [];
  const isValid = v => v && v !== 'unknown' && v !== '信息不足' && v.toString().trim().length > 0;

  // Category-specific field lists
  const layouts = {
    animal:   [['🏞️ Habitat', d.habitat], ['📅 Active season', d.activeSeason], ['🥗 Diet', d.diet]],
    plant:    [['🌱 Grows in', d.growEnvironment], ['🌸 Bloom season', d.bloomSeason], ['🌿 Plant type', d.plantType]],
    food:     [
      ['🥥 Main ingredients', d.ingredients, true],
      ['🍬 Sweetness',        d.sugarLevel, false, 'sugar'],
      ['🔥 Calories',         d.calorieEstimate],
      ['🎭 Cultural notes',   d.culturalNote, true],
    ],
    building: [
      ['📍 Address',          d.address, true],
      ['🌆 District',         d.district],
      ['🚇 Nearest MRT',      d.mrtStation],
      ['🧭 Nearby reference', d.nearbyLandmark, true],
      ['🏛️ Built',            d.builtYear],
      ['📐 Style',            d.style],
      ['👨‍🎨 Architect',       d.architect, true],
    ],
    landmark: [
      ['📍 Address',          d.address, true],
      ['🌆 District',         d.district],
      ['🚇 Nearest MRT',      d.mrtStation],
      ['🧭 Nearby reference', d.nearbyLandmark, true],
      ['🏛️ Built',            d.builtYear],
      ['📐 Style',            d.style],
      ['👨‍🎨 Architect',       d.architect, true],
    ],
    transportation: [
      ['🚍 Operator',         d.operator],
      ['🛣️ Route',            d.routeInfo, true],
      ['🚇 Nearest MRT',      d.mrtStation],
    ],
    sign: [['📋 Purpose', d.signPurpose], ['🌐 Language', d.signLanguage]],
    art:  [
      ['🎨 Form',    d.artForm],
      ['📅 Era',     d.artYear],
      ['👨‍🎨 Artist', d.artist],
      ['💭 Theme',   d.artTheme, true],
    ],
    souvenir: [
      ['🏷️ Brand / IP', d.souvenirBrand],
      ['🎁 Type',       d.souvenirType],
      ['🧶 Material',   d.souvenirMaterial],
      ['💰 Price',      d.souvenirPrice],
    ],
    person:   [],
  };

  const fields = layouts[category] || [];

  fields.forEach(([label, value, full, mode]) => {
    if (!isValid(value)) return;
    let valueHTML = _esc(String(value));

    // Special: sugar level as visual dots
    if (mode === 'sugar') {
      const levels = { 'sugar-free':0, 'none':0, 'low':1, 'medium':2, 'mid':2, 'high':3, '无糖':0, '低':1, '中':2, '高':3 };
      const n = levels[value] ?? null;
      if (n !== null) {
        let dots = '';
        for (let i = 0; i < 4; i++) dots += `<span class="pm-sugar-dot${i < n ? ' on' : ''}"></span>`;
        valueHTML = `${_esc(value)}<span class="pm-sugar-bar">${dots}</span>`;
      }
    }

    cards.push(`
      <div class="pm-detail-card${full ? ' full' : ''}">
        <div class="pm-detail-label">${label}</div>
        <div class="pm-detail-value">${valueHTML}</div>
      </div>`);
  });

  container.innerHTML = cards.join('');
}

/* ── Re-recognize with correction ────────────────────────────────────── */
window.reRecognize = async function() {
  const hint = document.getElementById('pm-correction-input').value.trim();
  if (!hint) { document.getElementById('pm-correction-input').focus(); return; }
  await _runVision(_pendingPhotoBase64, hint);
};

/* ── Confirm: add to map / chat / gallery / collection ───────────────── */
window.confirmAdd = async function() {
  if (!_pendingResult) return;
  document.getElementById('pm-confirm').disabled = true;

  const { identified, story, details, model3d, achievement } = _pendingResult;
  const mood = _pendingMood;

  // Show in chat
  const src = _pendingPhotoSrc;
  const chatEl = document.createElement('div');
  chatEl.className = 'msg user';
  chatEl.innerHTML = `
    <div class="msg-bubble" style="padding:6px;max-width:220px;">
      <img src="${src}" style="max-width:100%;border-radius:8px;display:block;" alt="">
      ${mood ? `<div style="font-size:12px;margin-top:6px;color:var(--txt);">${_esc(mood)}</div>` : ''}
    </div>
    <div class="msg-avatar">👤</div>`;
  _appendToChat(chatEl);

  // Story card in chat
  window.UI.onStory({ title: identified.name, titleEn: identified.nameEn, story, mood });

  // Add to map
  SingaporeMap.addDiscoveredItem({ name: identified.name, category: identified.category,
    locationId: identified.locationId, color: model3d?.color, type: model3d?.type });

  // Compress + store (include structured context + details for future retrieval)
  const thumb = await _compressImage(src);
  const item  = {
    ...identified,
    story,
    details: details || {},
    mood,
    context: { ..._pendingContext },
    ts: Date.now(),
    photoSrc: thumb || src,
  };
  const ctx   = AgentSystem.getCtx();
  ctx.discovered.push(item);
  ctx.score += 50;
  window.UI.onItemDiscovered(item);
  window.UI.onScoreUpdate(ctx.score);
  window.UI.onItemCountUpdate(ctx.discovered.length);
  // Persist directly
  localStorage.setItem('wq_state_v1', JSON.stringify({
    tasks: ctx.tasks, discovered: ctx.discovered,
    achievements: ctx.achievements, score: ctx.score,
  }));

  // Achievement
  if (achievement?.unlock) window.UI.onAchievement(achievement);

  // Auto-complete tasks at this location
  ctx.tasks.forEach(t => {
    if (!t.done && t.locationId === identified.locationId) AgentSystem.completeTask(t.id);
  });

  // Save full scene snapshot to memory so ContextAgent can reference it
  const scene = _summarizeContext(_pendingContext || {});
  AgentSystem.rememberInput(
    `Visited ${identified.location}, discovered ${identified.name}` +
    (scene ? ` (context: ${scene})` : '')
  );

  _closePhotoModal();

  // Run contextual task recommendation in background (non-blocking)
  _showTyping();
  AgentSystem.contextualCheck(identified, item.context).then(() => _hideTyping());

  // 🦊 Fox might react to the new item (50% chance, runs after a small delay)
  setTimeout(() => AgentSystem.foxReactTo(item), 6000 + Math.random() * 6000);
};

// Quick-tag helper
window.appendMoodTag = function(tag) {
  const ta = document.getElementById('pm-mood');
  ta.value = ta.value ? ta.value + ' ' + tag : tag;
  ta.focus();
};

/* ══════════════════════════════════════════════════════════════════════════
   EVENT WIRING
   ══════════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  // Init map
  SingaporeMap.init('three-canvas');

  // Init achievement panel
  _initAchievements();

  // (HUD tab visibility is now driven by _switchThudTab; nothing to hide here)

  // Build empty gallery tabs FIRST so restore can populate them
  _initGalleryTabs();

  // Wire up the task-HUD tab switcher
  _initThudTabs();

  // Restore saved state (discovered items, tasks, achievements)
  _restoreState();

  // Initial planet stats render (will set _prevStats baseline so no spurious bump on load)
  _refreshPlanetUI();

  // 🦊 Fox Life background ticker
  //   - Fox is mostly resting; activities are rare but precious
  //   - First check after 3 minutes; then every 2 minutes (low probability per tick)
  //   - Scheduled events (wakeup/lunch/dusk/goodnight) always fire on their planet-time window
  setTimeout(() => {
    AgentSystem.foxTick();
    setInterval(() => AgentSystem.foxTick(), 120_000);
  }, 3 * 60_000);

  // Refresh planet time + fox status card every 25s
  setInterval(() => {
    _refreshPlanetTime();
    _refreshFoxStatusCard();
  }, 25_000);
  // Initial display
  _refreshPlanetTime();
  _renderFoxStatus(AgentSystem.getCurrentFoxActivity());
  _refreshFoxStatusCard();
  _renderFoxTimeline();   // populate the expanded-by-default timeline

  // Init agent monitor callbacks
  _initMonitorCallbacks();

  // Monitor panel action buttons
  document.getElementById('monitor-abort-all').addEventListener('click', () => {
    AgentSystem.abortAll();
  });
  document.getElementById('monitor-clear-btn').addEventListener('click', () => {
    AgentSystem.monitor.clear();
    _updateMonitorTabBadge();
  });

  // (Chat input removed — the single user input is the "Capture this moment" FAB which
  //  opens the photo modal. The chat panel is now a read-only fox journal.)

  // Global photo input → compress then open moment modal
  document.getElementById('photo-upload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const compact = await _compressImage(ev.target.result, 1024, 0.85);
      window.openMomentShare(compact || ev.target.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  // In-modal photo input → compress + attach
  document.getElementById('photo-upload-modal').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const compact = await _compressImage(ev.target.result, 1024, 0.85);
      _pendingPhotoSrc    = compact || ev.target.result;
      _pendingPhotoBase64 = _pendingPhotoSrc.split(',')[1];
      _refreshPhotoSection();
      _refreshSubmitButton();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  // Remove attached photo
  document.getElementById('pm-photo-remove').addEventListener('click', window.removeAttachedPhoto);

  // Modal wiring
  document.getElementById('pm-close').addEventListener('click', _closePhotoModal);
  document.getElementById('pm-cancel').addEventListener('click', _closePhotoModal);
  document.getElementById('pm-overlay').addEventListener('click', _closePhotoModal);
  document.getElementById('pm-submit').addEventListener('click', _submitPhotoModal);

  // Landmark card close
  document.getElementById('landmark-close').addEventListener('click', () => {
    document.getElementById('landmark-card').classList.add('hidden');
    SingaporeMap.highlightLandmark(null);
  });

  // Welcome card (slight delay for dramatic effect)
  setTimeout(() => _renderWelcomeCard(), 600);

  // First-launch onboarding hint pointing to the camera FAB
  _maybeShowOnboardingHint();

  // Populate the 20-category manual fallback picker
  _renderCatPicker();

  // Auto-close journal modal when the photo picker is triggered
  _autoCloseJournalOnUpload();
});

/* ── Build the manual category picker grid from CATEGORIES ───────────── */
function _renderCatPicker() {
  const grid = document.getElementById('pm-cat-picker-grid');
  if (!grid) return;
  grid.innerHTML = CATEGORY_KEYS.map(key => {
    const m = CATEGORIES[key];
    return `<button class="pm-cat-pick-btn" onclick="window.manualCategorize('${key}')">${m.emoji} ${m.label}</button>`;
  }).join('');
}
