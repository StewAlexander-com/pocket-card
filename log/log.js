'use strict';

  // ─── Storage: localStorage only, isolated key, never leaves this device ────
  const KEY = 'pocketcard.log.v1';

  function readAll(){
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
      return {};
    } catch (e) { return {}; }
  }
  function writeAll(obj){
    try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; }
    catch (e) { return false; }
  }

  // ─── Date helpers (local time) ─────────────────────────────────────────────
  function pad2(n){ return n < 10 ? '0' + n : '' + n; }
  function todayISO(d){
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function formatLong(iso){
    // iso is YYYY-MM-DD; parse as local date
    const [y,m,d] = iso.split('-').map(Number);
    const dt = new Date(y, m-1, d);
    return dt.toLocaleDateString(undefined, {
      weekday:'long', month:'long', day:'numeric', year:'numeric'
    });
  }
  function weekdayName(d){
    return d.toLocaleDateString(undefined, { weekday:'long' });
  }
  function monthYear(d){
    return d.toLocaleDateString(undefined, { month:'long', year:'numeric' });
  }

  // ─── Render dramatic date header ───────────────────────────────────────────
  (function renderHero(){
    const now = new Date();
    document.getElementById('hWeekday').textContent = weekdayName(now);
    document.getElementById('hDay').textContent = now.getDate();
    document.getElementById('hMonthYear').textContent = monthYear(now);
  })();

  // ─── Today's editor: load + autosave on input (debounced) ──────────────────
  const todayKey = todayISO();
  const textarea = document.getElementById('todayText');
  const charCount = document.getElementById('charCount');
  const savedIndicator = document.getElementById('savedIndicator');

  function loadToday(){
    const all = readAll();
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
      const all = readAll();
      const txt = textarea.value;
      if (txt.trim().length === 0){
        // Empty entry → remove key entirely to keep history clean
        if (all[todayKey]) { delete all[todayKey]; writeAll(all); }
      } else {
        all[todayKey] = { text: txt, updated: Date.now() };
        writeAll(all);
      }
      renderHistory();
      flashSaved();
    }, 350);
  }
  function flashSaved(){
    savedIndicator.classList.add('show');
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(() => savedIndicator.classList.remove('show'), 1200);
  }

  textarea.addEventListener('input', queueSave);

  // ─── History render: all prior days (read-only), newest first ──────────────
  const historyList = document.getElementById('historyList');
  function renderHistory(){
    const all = readAll();
    // Exclude today; sort keys desc
    const keys = Object.keys(all).filter(k => k !== todayKey && /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().reverse();
    // Clear (safely)
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
      date.textContent = formatLong(k); // safe: textContent, not innerHTML

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
      body.textContent = rec.text; // safe: textContent

      entry.appendChild(head);
      entry.appendChild(body);
      historyList.appendChild(entry);
    });
  }

  function deleteEntry(k){
    const all = readAll();
    if (!all[k]) return;
    const label = formatLong(k);
    if (!window.confirm('Delete the entry from ' + label + '? This cannot be undone.')) return;
    delete all[k];
    writeAll(all);
    renderHistory();
  }

  // ─── Export .txt ───────────────────────────────────────────────────────────
  document.getElementById('exportBtn').addEventListener('click', () => {
    const all = readAll();
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
    const blob = new Blob([lines.join('\n')], { type:'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pocket-card-log-' + todayKey + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  // ─── Erase all (confirm panel) ─────────────────────────────────────────────
  const eraseBtn = document.getElementById('eraseBtn');
  const eraseConfirm = document.getElementById('eraseConfirm');
  const eraseCancel = document.getElementById('eraseCancel');
  const eraseConfirmBtn = document.getElementById('eraseConfirmBtn');

  eraseBtn.addEventListener('click', () => { eraseConfirm.classList.add('open'); });
  eraseCancel.addEventListener('click', () => { eraseConfirm.classList.remove('open'); });
  eraseConfirmBtn.addEventListener('click', () => {
    try { localStorage.removeItem(KEY); } catch(e){}
    eraseConfirm.classList.remove('open');
    textarea.value = '';
    updateCharCount();
    renderHistory();
    flashSaved();
  });

  // ─── Storm video bg (lighter-weight: same Rain View pattern) ───────────────
  (function storm(){
    const UA = navigator.userAgent || '';
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
    // Crossfade bridge
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

  // ─── Initial render + PWA standalone class ─────────────────────────────────
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true){
    document.body.classList.add('is-standalone');
  }
  loadToday();
  renderHistory();

  // ─── Service worker (shared registration) ──────────────────────────────────
  if ('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('../sw.js').catch(()=>{});
    });
  }

  // ─── Tab-sync: reflect changes from other tabs of the same PWA ─────────────
  window.addEventListener('storage', (e) => {
    if (e.key === KEY){
      loadToday();
      renderHistory();
    }
  });
