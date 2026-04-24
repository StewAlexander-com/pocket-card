'use strict';

// ─── Storage: localStorage only, isolated keys, never leaves this device ─────
// Primary + shadow backup so a transient write failure or JSON corruption can't
// wipe the user's log. Writes go: validate → write backup → write primary.
const KEY        = 'pocketcard.log.v1';
const BACKUP_KEY = 'pocketcard.log.v1.backup';

// Tag for imported-below-device merges. Same character a human could paste
// if they wanted to copy the look of the in-app divider.
const MERGE_DIVIDER = '\n\n— — — — —\n\n';

// Request persistent storage so the browser won't evict our data under pressure.
// Works in Chromium/Firefox; Safari ignores. Safe no-op if unsupported.
(function requestPersistent(){
  if (navigator.storage && typeof navigator.storage.persist === 'function'){
    try { navigator.storage.persist().catch(()=>{}); } catch(e){}
  }
})();

// Parse a stored blob. Returns { ok, data, reason } so callers can distinguish
// "empty" from "corrupt" (never silently drop data on corruption).
function parseBlob(raw){
  if (raw === null || raw === undefined) return { ok:true, data:{} };     // truly empty
  if (typeof raw !== 'string' || raw.length === 0) return { ok:true, data:{} };
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return { ok:true, data:obj };
    return { ok:false, data:null, reason:'not-object' };
  } catch (e) {
    return { ok:false, data:null, reason:'parse-error' };
  }
}

// Read primary; if corrupt, try backup before giving up. NEVER return {} on corruption
// (that would hide the problem from subsequent writers and cause silent data loss).
function readAll(){
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch(e){ return { data:{}, corrupt:false }; }
  const p = parseBlob(raw);
  if (p.ok) return { data:p.data, corrupt:false };

  // Primary is corrupt — try the shadow.
  let rawB = null;
  try { rawB = localStorage.getItem(BACKUP_KEY); } catch(e){}
  const pb = parseBlob(rawB);
  if (pb.ok) return { data:pb.data, corrupt:true, recovered:true };

  // Both corrupt. Surface as corrupt=true so writeAll won't happily overwrite.
  return { data:{}, corrupt:true, recovered:false };
}

// Write: validate first, then write backup (last known good), then primary.
// If anything about `obj` is malformed, refuse — never clobber good data with junk.
function writeAll(obj){
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  // Shallow validate entry shapes
  for (const k of Object.keys(obj)){
    const v = obj[k];
    if (!v || typeof v !== 'object' || typeof v.text !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
  }
  let json;
  try { json = JSON.stringify(obj); } catch(e){ return false; }
  try {
    // Backup previous primary BEFORE overwriting it, so there's always a known-good
    // snapshot one step behind. If primary is already corrupt we just skip this.
    const prior = localStorage.getItem(KEY);
    if (prior !== null) {
      const p = parseBlob(prior);
      if (p.ok) localStorage.setItem(BACKUP_KEY, prior);
    }
    localStorage.setItem(KEY, json);
    return true;
  } catch(e){ return false; }
}

// Convenience: return just the data map, preserving the "corrupt" signal via a flag
// we can read in debug console if needed.
function getAll(){
  const r = readAll();
  window.__pocketLogCorrupt = r.corrupt;
  window.__pocketLogRecovered = r.recovered === true;
  return r.data;
}

// ─── Date helpers (local time) ───────────────────────────────────────────────
function pad2(n){ return n < 10 ? '0' + n : '' + n; }
function todayISO(d){
  d = d || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function formatLong(iso){
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return dt.toLocaleDateString(undefined, {
    weekday:'long', month:'long', day:'numeric', year:'numeric'
  });
}
function weekdayName(d){ return d.toLocaleDateString(undefined, { weekday:'long' }); }
function monthYear(d){ return d.toLocaleDateString(undefined, { month:'long', year:'numeric' }); }

// ─── Dramatic date header ────────────────────────────────────────────────────
(function renderHero(){
  const now = new Date();
  document.getElementById('hWeekday').textContent = weekdayName(now);
  document.getElementById('hDay').textContent = now.getDate();
  document.getElementById('hMonthYear').textContent = monthYear(now);
})();

// ─── Today's editor: load + autosave (IMMUTABILITY: emptying never deletes) ──
const todayKey = todayISO();
const textarea = document.getElementById('todayText');
const charCount = document.getElementById('charCount');
const savedIndicator = document.getElementById('savedIndicator');

function loadToday(){
  const all = getAll();
  textarea.value = (all[todayKey] && typeof all[todayKey].text === 'string') ? all[todayKey].text : '';
  updateCharCount();
}
function updateCharCount(){
  charCount.textContent = textarea.value.length + ' / 2000';
}

let saveTimer = null;
function queueSave(){
  updateCharCount();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const all = getAll();
    // IMMUTABILITY GUARD: do not write if the underlying blob is corrupt and
    // we couldn't recover from backup. Writing would destroy recoverable data.
    if (window.__pocketLogCorrupt && !window.__pocketLogRecovered) {
      showToast('Log data looks corrupted. Paused autosave to protect your entries. Try reloading the page.', 'warn');
      return;
    }
    const txt = textarea.value;
    // IMMUTABILITY: once a user has written anything today, emptying the box
    // does NOT delete or overwrite the record. Only the explicit delete button
    // (on the history entry) can remove it. An empty textarea is a no-op.
    if (txt.trim().length === 0) {
      return; // never persist empty content; never overwrite an existing entry with empty
    }
    // If existing text is identical, skip the write (avoid pointless churn).
    if (all[todayKey] && all[todayKey].text === txt) {
      return;
    }
    all[todayKey] = { text: txt, updated: Date.now() };
    if (writeAll(all)) {
      renderHistory();
      flashSaved();
    } else {
      showToast('Could not save. Storage may be full or blocked.', 'warn');
    }
  }, 350);
}
function flashSaved(){
  savedIndicator.classList.add('show');
  clearTimeout(flashSaved._t);
  flashSaved._t = setTimeout(() => savedIndicator.classList.remove('show'), 1200);
}

textarea.addEventListener('input', queueSave);

// ─── History: read-only list, newest first, per-entry delete ─────────────────
const historyList = document.getElementById('historyList');
function renderHistory(){
  const all = getAll();
  const keys = Object.keys(all)
    .filter(k => k !== todayKey && /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort().reverse();
  while (historyList.firstChild) historyList.removeChild(historyList.firstChild);

  if (keys.length === 0){
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Your earlier entries will land here.';
    historyList.appendChild(empty);
    return;
  }

  keys.forEach(k => {
    const rec = all[k];
    if (!rec || typeof rec.text !== 'string') return;

    const entry = document.createElement('article');
    entry.className = 'entry';

    const head = document.createElement('div');
    head.className = 'ehead';

    const date = document.createElement('span');
    date.className = 'edate';
    date.textContent = formatLong(k);

    const del = document.createElement('button');
    del.className = 'edel';
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete entry from ' + formatLong(k));
    del.title = 'Delete this entry';
    del.textContent = '×';
    del.addEventListener('click', () => deleteEntry(k));

    head.appendChild(date);
    head.appendChild(del);

    const body = document.createElement('div');
    body.className = 'ebody';
    body.textContent = rec.text;

    entry.appendChild(head);
    entry.appendChild(body);
    historyList.appendChild(entry);
  });
}

function deleteEntry(k){
  const all = getAll();
  if (!all[k]) return;
  const label = formatLong(k);
  if (!window.confirm('Delete the entry from ' + label + '? This cannot be undone.')) return;
  delete all[k];
  writeAll(all);
  renderHistory();
}

// ─── Export .txt ─────────────────────────────────────────────────────────────
function buildExportText(all){
  const keys = Object.keys(all).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().reverse();
  const lines = [];
  lines.push('Pocket Card — Log');
  lines.push('Exported ' + new Date().toLocaleString());
  lines.push('On-device, private. ' + keys.length + ' entr' + (keys.length === 1 ? 'y' : 'ies') + '.');
  lines.push('');
  lines.push('──────────────────────────');
  lines.push('');
  keys.forEach(k => {
    const rec = all[k];
    if (!rec || typeof rec.text !== 'string') return;
    lines.push(formatLong(k));
    lines.push('');
    lines.push(rec.text);
    lines.push('');
    lines.push('──────────────────────────');
    lines.push('');
  });
  return lines.join('\n');
}

document.getElementById('exportBtn').addEventListener('click', () => {
  const all = getAll();
  const blob = new Blob([buildExportText(all)], { type:'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pocket-card-log-' + todayKey + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

// ─── Import .txt — accepts Pocket Card export format ─────────────────────────
// The export uses a long-dash divider (──────────────────────────) between
// sections, each section's first non-empty line is a localized long date, then
// a blank line, then the body (may span multiple lines).
// We try multiple date parse strategies to handle any locale. On same-day
// conflict, the imported text is appended BELOW the device text with a divider.
const DIVIDER_RE = /^─{5,}\s*$/;      // at least 5 long-dashes = divider
const fileInput  = document.getElementById('importFile');
const importBtn  = document.getElementById('importBtn');

importBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // allow re-importing same filename
  if (!file) return;
  // Light safety guard: refuse anything obviously not a small text file.
  if (file.size > 5 * 1024 * 1024) {
    showToast('File is too large (over 5 MB). Import expects a Pocket Card .txt export.', 'warn');
    return;
  }
  let text;
  try { text = await file.text(); }
  catch (err) { showToast('Could not read that file.', 'warn'); return; }

  const parsed = parseImportText(text);
  if (!parsed.entries.length) {
    showToast('No valid entries found. Import expects a Pocket Card .txt export.', 'warn');
    return;
  }

  const existing = getAll();
  // If underlying data is corrupt and unrecovered, bail before overwriting.
  if (window.__pocketLogCorrupt && !window.__pocketLogRecovered) {
    showToast('Log data is corrupted. Reload the page before importing to avoid overwriting recoverable entries.', 'warn');
    return;
  }

  let added = 0, merged = 0, skippedToday = 0;
  const now = Date.now();
  parsed.entries.forEach(({ iso, text }) => {
    if (iso === todayKey) {
      // Don't touch the live-editing entry from an import. Append to existing
      // device entry if present; otherwise stage it into the textarea so the
      // user can review and keep (autosave will commit on next keystroke).
      if (existing[iso]) {
        existing[iso] = { text: existing[iso].text + MERGE_DIVIDER + text, updated: now };
        merged++;
      } else {
        // Pre-fill today's textarea without committing yet — give the user a
        // chance to see what's there before autosave. We DO commit below via
        // writeAll so nothing is lost if the user walks away.
        existing[iso] = { text: text, updated: now };
        added++;
      }
      return;
    }
    if (existing[iso]) {
      // Append imported text below device text with a clear divider.
      existing[iso] = { text: existing[iso].text + MERGE_DIVIDER + text, updated: now };
      merged++;
    } else {
      existing[iso] = { text: text, updated: now };
      added++;
    }
  });

  if (writeAll(existing)) {
    // Reflect new state in UI
    loadToday();
    renderHistory();
    flashSaved();
    const parts = [];
    if (added)  parts.push(added + ' added');
    if (merged) parts.push(merged + ' merged');
    if (parsed.skipped) parts.push(parsed.skipped + ' skipped');
    showToast('Imported: ' + parts.join(' · '), 'ok');
  } else {
    showToast('Could not save imported entries. Storage may be full.', 'warn');
  }
});

function parseImportText(raw){
  const out = { entries: [], skipped: 0 };
  if (typeof raw !== 'string') return out;
  // Normalize line endings and split by dividers. Header section (first one,
  // before the first divider) is metadata we ignore.
  const normalized = raw.replace(/\r\n?/g, '\n');
  const sections = [];
  let buf = [];
  normalized.split('\n').forEach(line => {
    if (DIVIDER_RE.test(line)) {
      sections.push(buf.join('\n'));
      buf = [];
    } else {
      buf.push(line);
    }
  });
  if (buf.length) sections.push(buf.join('\n'));

  // First section is always the header ("Pocket Card — Log / Exported ... / On-device...").
  // Skip it if it doesn't start with a parseable date.
  sections.forEach((section) => {
    const lines = section.split('\n');
    // Find first non-empty line → candidate date line
    let idx = 0;
    while (idx < lines.length && lines[idx].trim() === '') idx++;
    if (idx >= lines.length) return;
    const dateLine = lines[idx].trim();
    const iso = parseLocalizedDateToISO(dateLine);
    if (!iso) { out.skipped++; return; }
    // Body = everything after the date line's trailing blank
    const bodyLines = lines.slice(idx + 1);
    // Trim leading/trailing blank lines from body
    while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift();
    while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
    const body = bodyLines.join('\n');
    if (!body) { out.skipped++; return; }
    out.entries.push({ iso: iso, text: body });
  });

  return out;
}

// Parse a localized long date ("Friday, April 24, 2026" / "2026-04-24" / etc.)
// into YYYY-MM-DD. Returns null if unparseable or implausible (outside 1900-2200).
function parseLocalizedDateToISO(s){
  if (!s) return null;
  // Fast path: already ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3];
    return isPlausibleYMD(y,m,d) ? toISO(y,m,d) : null;
  }
  // Try Date.parse — handles "Friday, April 24, 2026", "April 24, 2026",
  // "24 April 2026" in most locales the browser supports.
  const t = Date.parse(s);
  if (!isNaN(t)) {
    const dt = new Date(t);
    const y = dt.getFullYear(), m = dt.getMonth()+1, d = dt.getDate();
    if (isPlausibleYMD(y,m,d)) return toISO(y,m,d);
  }
  // Last-ditch: strip weekday prefix "Friday, " then retry
  const stripped = s.replace(/^[^,]+,\s*/, '');
  if (stripped !== s) {
    const t2 = Date.parse(stripped);
    if (!isNaN(t2)) {
      const dt = new Date(t2);
      const y = dt.getFullYear(), m = dt.getMonth()+1, d = dt.getDate();
      if (isPlausibleYMD(y,m,d)) return toISO(y,m,d);
    }
  }
  return null;
}
function isPlausibleYMD(y,m,d){
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}
function toISO(y,m,d){ return y + '-' + pad2(m) + '-' + pad2(d); }

// ─── Toast (for import & storage errors) ─────────────────────────────────────
let toastEl = null, toastTimer = null;
function showToast(msg, tone){
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.dataset.tone = tone || 'ok';
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4200);
}

// ─── Erase all (with confirm) ────────────────────────────────────────────────
const eraseBtn = document.getElementById('eraseBtn');
const eraseConfirm = document.getElementById('eraseConfirm');
const eraseCancel = document.getElementById('eraseCancel');
const eraseConfirmBtn = document.getElementById('eraseConfirmBtn');

eraseBtn.addEventListener('click', () => { eraseConfirm.classList.add('open'); });
eraseCancel.addEventListener('click', () => { eraseConfirm.classList.remove('open'); });
eraseConfirmBtn.addEventListener('click', () => {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(BACKUP_KEY);
  } catch(e){}
  eraseConfirm.classList.remove('open');
  textarea.value = '';
  updateCharCount();
  renderHistory();
  flashSaved();
});

// ─── Storm video bg (Rain View pattern) ──────────────────────────────────────
(function storm(){
  const IS_MOBILE = window.innerWidth <= 640 || ('ontouchstart' in window && window.innerWidth <= 1024);
  const VIDEO_SRC = IS_MOBILE ? '../assets/storm-mobile.mp4' : '../assets/storm-desktop.mp4';
  const vidA = document.getElementById('vidA');
  const vidB = document.getElementById('vidB');
  vidA.src = VIDEO_SRC; vidA.muted = true; vidA.playsInline = true;
  vidB.src = VIDEO_SRC; vidB.muted = true; vidB.playsInline = true;
  function tryPlay(v){ const p = v.play(); if (p && p.catch) p.catch(()=>{}); }
  tryPlay(vidA);
  let retries = 0;
  vidA.addEventListener('error', () => {
    if (retries++ < 3) setTimeout(() => { vidA.load(); tryPlay(vidA); }, 400);
  });
  let t = null;
  function sched(){
    const dur = vidA.duration;
    if (!dur || isNaN(dur) || dur < 2) return;
    const timeLeft = dur - vidA.currentTime;
    const fadeIn = 1.2;
    const delay = Math.max(0, (timeLeft - fadeIn) * 1000);
    t = setTimeout(() => {
      vidB.currentTime = Math.max(0, dur * 0.35);
      tryPlay(vidB);
      vidB.classList.add('visible');
      setTimeout(() => {
        vidB.classList.remove('visible');
        setTimeout(() => { if (!vidB.classList.contains('visible')) vidB.pause(); }, fadeIn*1000);
        sched();
      }, fadeIn*1000 + 400);
    }, delay);
  }
  if (vidA.readyState >= 1 && vidA.duration) sched();
  else vidA.addEventListener('loadedmetadata', sched, { once:true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tryPlay(vidA); });
})();

// ─── Initial render + PWA standalone class ───────────────────────────────────
if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true){
  document.body.classList.add('is-standalone');
}
// Surface a one-time notice if we just recovered from a corrupt primary.
loadToday();
renderHistory();
if (window.__pocketLogRecovered) {
  showToast('Recovered your entries from the backup snapshot.', 'ok');
}

// ─── Service worker (shared registration) ────────────────────────────────────
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('../sw.js').catch(()=>{});
  });
}

// ─── Tab-sync: reflect changes from other tabs of the same PWA ───────────────
window.addEventListener('storage', (e) => {
  if (e.key === KEY || e.key === BACKUP_KEY){
    loadToday();
    renderHistory();
  }
});
