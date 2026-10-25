// UI logic. Depends on window.CONFIG (config.js) and window.KieApi (api.js).
(function () {
  const C = window.CONFIG;
  const API = window.KieApi;
  const L = C.LIMITS;
  const MB = 1024 * 1024;
  const $ = (id) => document.getElementById(id);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };

  const state = {
    key: store.get('ss_key', ''),
    modelId: store.get('ss_model', C.MODELS[0].id),
    resolution: store.get('ss_resolution', ''),
    aspect: store.get('ss_aspect', C.DEFAULT_ASPECT),
    duration: store.get('ss_duration', C.DEFAULT_DURATION),
    audio: store.get('ss_audio', true),
    history: store.get('ss_history', []),
    running: false,
    ctl: null,
  };
  const model = () => C.MODELS.find((m) => m.id === state.modelId) || C.MODELS[0];

  /* ---------- navigation ---------- */
  function show(view) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'history') renderHistory();
  }
  document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

  /* ---------- API key ---------- */
  function renderKeyState() {
    $('keyState').classList.toggle('ok', !!state.key);
    $('keyText').textContent = state.key ? 'API key saved' : 'No API key';
    $('key').value = state.key;
  }
  $('saveKey').addEventListener('click', () => {
    state.key = $('key').value.trim();
    store.set('ss_key', state.key);
    renderKeyState();
    $('settingsMsg').textContent = state.key ? 'Saved on this device.' : 'Key cleared.';
  });
  $('forgetKey').addEventListener('click', () => {
    state.key = '';
    store.set('ss_key', '');
    renderKeyState();
    $('settingsMsg').textContent = 'Key removed.';
  });
  $('showKey').addEventListener('click', () => {
    const k = $('key');
    k.type = k.type === 'password' ? 'text' : 'password';
    $('showKey').textContent = k.type === 'password' ? 'Show' : 'Hide';
  });
  $('credits').addEventListener('click', async () => {
    const k = $('key').value.trim() || state.key;
    if (!k) { $('settingsMsg').textContent = 'Enter your API key first.'; return; }
    $('settingsMsg').textContent = 'Checking…';
    try {
      $('settingsMsg').textContent = 'Credits remaining: ' + (await API.getCredits(k));
    } catch (e) {
      $('settingsMsg').textContent = e.message;
    }
  });

  /* ---------- options ---------- */
  function seg(container, items, current, onPick) {
    container.innerHTML = '';
    items.forEach((it) => {
      const b = el('button', current === it.value ? 'on' : '', it.label);
      b.onclick = () => onPick(it.value);
      container.appendChild(b);
    });
  }
  function renderOptions() {
    const m = model();
    if (!m.resolutions.includes(state.resolution)) state.resolution = m.defaultResolution;
    seg($('models'), C.MODELS.map((x) => ({ value: x.id, label: x.label })), state.modelId, (v) => {
      state.modelId = v; store.set('ss_model', v); renderOptions();
    });
    seg($('resolution'), m.resolutions.map((r) => ({ value: r, label: r })), state.resolution, (v) => {
      state.resolution = v; store.set('ss_resolution', v); renderOptions();
    });
    seg($('aspect'), C.ASPECT_RATIOS.map((r) => ({ value: r, label: r })), state.aspect, (v) => {
      state.aspect = v; store.set('ss_aspect', v); renderOptions();
    });
    const d = $('duration');
    d.min = C.DURATION_MIN; d.max = C.DURATION_MAX; d.step = 1;
    state.duration = Math.min(Math.max(+state.duration, C.DURATION_MIN), C.DURATION_MAX);
    d.value = state.duration;
    $('durVal').textContent = state.duration + ' s';
    $('durMin').textContent = C.DURATION_MIN + ' s';
    $('durMax').textContent = C.DURATION_MAX + ' s';
    $('audio').checked = !!state.audio;
  }
  $('duration').addEventListener('input', (e) => {
    state.duration = +e.target.value; store.set('ss_duration', state.duration);
    $('durVal').textContent = state.duration + ' s';
  });
  $('audio').addEventListener('change', (e) => { state.audio = e.target.checked; store.set('ss_audio', state.audio); });

  /* ---------- prompt ---------- */
  function updateCount() {
    const n = $('prompt').value.length;
    $('count').textContent = n + ' / ' + C.MAX_PROMPT_CHARS;
    $('count').style.color = n > C.MAX_PROMPT_CHARS ? 'var(--bad)' : '';
  }
  $('prompt').addEventListener('input', updateCount);
  function insertToken(t) {
    const p = $('prompt');
    const s = p.selectionStart ?? p.value.length;
    const e = p.selectionEnd ?? p.value.length;
    p.value = p.value.slice(0, s) + t + ' ' + p.value.slice(e);
    p.focus();
    p.selectionStart = p.selectionEnd = s + t.length + 1;
    updateCount();
  }
  function renderTokens() {
    const box = $('tokens');
    box.innerHTML = '';
    ['image', 'video', 'audio'].forEach((k) => {
      slots[k].items.forEach((_, i) => {
        const t = '@' + k + (i + 1);
        const b = el('button', 'chip', t);
        b.onclick = () => insertToken(t);
        box.appendChild(b);
      });
    });
    if (!box.children.length) box.appendChild(el('span', 'muted small', 'No reference files added.'));
  }

  /* ---------- media slots ---------- */
  const ACCEPT = {
    image: 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff',
    video: 'video/mp4,video/quicktime,.mp4,.mov',
    audio: 'audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav',
  };
  const TYPE_OK = {
    image: (f) => /^image\/(png|jpe?g|webp|gif|bmp|tiff)$/.test(f.type),
    video: (f) => /^video\/(mp4|quicktime)$/.test(f.type) || /\.(mp4|mov)$/i.test(f.name),
    audio: (f) => /^audio\/(mpeg|wav|x-wav|wave)$/.test(f.type) || /\.(mp3|wav)$/i.test(f.name),
  };
  const slots = {
    first: { name: 'first', media: 'image', limit: L.frame, items: [], label: 'Start' },
    last: { name: 'last', media: 'image', limit: L.frame, items: [], label: 'End' },
    image: { name: 'image', media: 'image', limit: L.image, items: [] },
    video: { name: 'video', media: 'video', limit: L.video, items: [] },
    audio: { name: 'audio', media: 'audio', limit: L.audio, items: [] },
  };
  const refCount = () => slots.image.items.length + slots.video.items.length + slots.audio.items.length;
  const frameCount = () => slots.first.items.length + slots.last.items.length;

  function mediaDuration(file, kind) {
    return new Promise((resolve) => {
      const m = document.createElement(kind === 'video' ? 'video' : 'audio');
      const u = URL.createObjectURL(file);
      const done = (v) => { URL.revokeObjectURL(u); resolve(v); };
      m.preload = 'metadata';
      m.onloadedmetadata = () => done(isFinite(m.duration) ? m.duration : null);
      m.onerror = () => done(null);
      m.src = u;
    });
  }

  function say(msg) { $('status').textContent = msg; }

  function addFiles(slot, fileList) {
    const locked = (slot.name === 'first' || slot.name === 'last') ? refCount() > 0 : frameCount() > 0;
    if (locked) { say('Frames and reference files can\'t be mixed. Remove the other kind first.'); return; }
    for (const f of Array.from(fileList)) {
      if (slot.items.length >= slot.limit.max) { say('Limit reached (' + slot.limit.max + ').'); break; }
      if (!TYPE_OK[slot.media](f)) { say('Unsupported file type: ' + f.name); continue; }
      if (f.size > slot.limit.maxMB * MB) { say(f.name + ' is larger than ' + slot.limit.maxMB + ' MB.'); continue; }
      const item = { id: crypto.randomUUID(), file: f, previewUrl: URL.createObjectURL(f), status: 'ready', url: null, duration: null };
      slot.items.push(item);
      if (slot.media !== 'image') {
        mediaDuration(f, slot.media).then((d) => { item.duration = d; renderAll(); });
      }
    }
    renderAll();
  }

  function removeItem(slot, item) {
    URL.revokeObjectURL(item.previewUrl);
    slot.items = slot.items.filter((x) => x.id !== item.id);
    renderAll();
  }

  function renderSlot(slot) {
    const root = $('slot-' + slot.name);
    root.innerHTML = '';
    const full = slot.items.length >= slot.limit.max;
    if (!full) {
      const drop = el('label', 'drop', slot.limit.max > 1 ? 'Drag & drop or click to add' : 'Drag & drop or click');
      drop.tabIndex = 0;
      const input = document.createElement('input');
      input.type = 'file'; input.hidden = true; input.multiple = slot.limit.max > 1; input.accept = ACCEPT[slot.media];
      input.onchange = () => { addFiles(slot, input.files); input.value = ''; };
      drop.appendChild(input);
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => addFiles(slot, e.dataTransfer.files));
      root.appendChild(drop);
    }
    if (slot.items.length) {
      const grid = el('div', 'items');
      slot.items.forEach((it, i) => {
        const d = el('div', 'item');
        let pv;
        if (slot.media === 'image') { pv = document.createElement('img'); pv.src = it.previewUrl; pv.alt = ''; }
        else if (slot.media === 'video') { pv = document.createElement('video'); pv.src = it.previewUrl; pv.muted = true; pv.preload = 'metadata'; }
        else { pv = el('div', 'aud', '♪'); }
        d.appendChild(pv);
        d.appendChild(el('span', 'tag', slot.label || '@' + slot.name + (i + 1)));
        const x = el('button', 'x', '×'); x.title = 'Remove'; x.onclick = () => removeItem(slot, it);
        d.appendChild(x);
        const meta = [it.file.name.length > 18 ? it.file.name.slice(0, 15) + '…' : it.file.name];
        if (it.duration) meta.push(it.duration.toFixed(1) + 's');
        const st = el('div', 'st ' + (it.status === 'uploaded' ? 'ok' : it.status === 'failed' ? 'bad' : ''), it.status === 'ready' ? meta.join(' · ') : it.status);
        d.appendChild(st);
        grid.appendChild(d);
      });
      root.appendChild(grid);
    }
    const cnt = $('cnt-' + slot.name);
    if (cnt) {
      let t = slot.items.length + ' / ' + slot.limit.max;
      if (slot.limit.maxTotalSec) {
        const tot = slot.items.reduce((a, b) => a + (b.duration || 0), 0);
        t += ' · ' + tot.toFixed(1) + ' / ' + slot.limit.maxTotalSec + ' s';
      }
      cnt.textContent = t;
    }
  }

  function renderAll() {
    Object.values(slots).forEach(renderSlot);
    const refsLocked = frameCount() > 0;
    const framesLocked = refCount() > 0;
    $('card-refs').classList.toggle('locked', refsLocked);
    $('card-frames').classList.toggle('locked', framesLocked);
    $('lock-refs').classList.toggle('hidden', !refsLocked);
    $('lock-frames').classList.toggle('hidden', !framesLocked);
    renderTokens();
  }

  $('clearUploads').addEventListener('click', () => {
    Object.values(slots).forEach((s) => { s.items.forEach((i) => URL.revokeObjectURL(i.previewUrl)); s.items = []; });
    renderAll();
  });

  /* ---------- results ---------- */
  function setBadge(kind, text) {
    const b = $('badge');
    if (!kind) { b.className = 'badge hidden'; return; }
    b.className = 'badge ' + kind;
    b.textContent = text;
  }

  function downloadButton(url, name) {
    const b = el('button', 'primary small-btn', 'Download MP4');
    b.onclick = async () => {
      if (window.native && window.native.saveFile) {
        try {
          b.textContent = 'Saving…';
          const r = await window.native.saveFile({ url, suggestedName: name, ext: 'mp4' });
          b.textContent = r.saved ? 'Saved ✓' : 'Download MP4';
        } catch (e) { b.textContent = 'Download MP4'; alert(e.message); }
        return;
      }
      const a = document.createElement('a');
      a.href = url; a.download = name; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    };
    return b;
  }

  function showVideo(url, info) {
    const box = $('result');
    box.innerHTML = '';
    const v = document.createElement('video');
    v.src = url; v.controls = true; v.loop = true; v.playsInline = true; v.preload = 'metadata';
    box.appendChild(v);
    const bar = el('div', 'bar');
    bar.appendChild(downloadButton(url, 'seedance-' + Date.now() + '.mp4'));
    const open = el('button', 'ghost', 'Open original');
    open.onclick = () => window.open(url, '_blank', 'noopener');
    bar.appendChild(open);
    box.appendChild(bar);
    if (info) box.appendChild(el('p', 'muted small', info));
  }

  function showError(msg) {
    const box = $('result');
    box.innerHTML = '';
    box.appendChild(el('div', 'err', msg));
  }

  /* ---------- generate ---------- */
  async function uploadSlot(slot) {
    const urls = [];
    for (const it of slot.items) {
      if (it.status !== 'uploaded') {
        it.status = 'uploading…'; renderAll();
        try {
          it.url = await API.uploadFile(state.key, it.file, 'seedance-' + slot.media);
          it.status = 'uploaded';
        } catch (e) {
          it.status = 'failed'; renderAll();
          throw new Error('Upload failed for ' + it.file.name + ': ' + e.message);
        }
        renderAll();
      }
      urls.push(it.url);
    }
    return urls;
  }

  function checkTotals() {
    for (const k of ['video', 'audio']) {
      const tot = slots[k].items.reduce((a, b) => a + (b.duration || 0), 0);
      if (tot > L[k].maxTotalSec + 0.05) {
        throw new Error('Reference ' + k + ' totals ' + tot.toFixed(1) + ' s; the limit is ' + L[k].maxTotalSec + ' s.');
      }
    }
  }

  function fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
  }

  async function generate() {
    if (state.running) return;
    const prompt = $('prompt').value.trim();
    if (!state.key) { show('settings'); $('settingsMsg').textContent = 'Add your kie.ai API key first.'; return; }
    if (!prompt) { say('Write a prompt first.'); return; }
    if (prompt.length > C.MAX_PROMPT_CHARS) { say('Prompt is too long.'); return; }

    state.running = true;
    state.ctl = { cancelled: false };
    $('go').disabled = true;
    $('go').textContent = 'Working…';
    $('cancel').classList.remove('hidden');
    setBadge('work', 'Running');
    $('result').innerHTML = '<div class="ph"><div class="spin"></div></div>';

    const started = Date.now();
    let lastState = 'submitting';
    const timer = setInterval(() => say('Status: ' + lastState + ' · ' + fmtElapsed(Date.now() - started)), 1000);

    try {
      checkTotals();
      say('Uploading files…');
      const firstFrame = (await uploadSlot(slots.first))[0] || null;
      const lastFrame = (await uploadSlot(slots.last))[0] || null;
      const imageUrls = await uploadSlot(slots.image);
      const videoUrls = await uploadSlot(slots.video);
      const audioUrls = await uploadSlot(slots.audio);

      lastState = 'submitting';
      const params = {
        model: state.modelId, prompt, firstFrame, lastFrame, imageUrls, videoUrls, audioUrls,
        generateAudio: state.audio, resolution: state.resolution, aspect: state.aspect, duration: state.duration,
      };
      const taskId = await API.createTask(state.key, params);
      const out = await API.waitForTask(state.key, taskId, { ctl: state.ctl, onState: (s) => { lastState = s; } });

      const info = model().label + ' · ' + state.duration + 's · ' + state.resolution + ' · ' + state.aspect +
        (out.credits != null ? ' · ' + out.credits + ' credits' : '');
      showVideo(out.urls[0], info);
      setBadge('done', 'Done');
      say('Finished in ' + fmtElapsed(Date.now() - started) + '.');
      addHistory({
        taskId, prompt, url: out.urls[0], model: model().label, duration: state.duration,
        resolution: state.resolution, aspect: state.aspect, audio: state.audio, credits: out.credits,
      });
    } catch (e) {
      showError(e.message);
      setBadge('fail', 'Failed');
      say('');
    } finally {
      clearInterval(timer);
      state.running = false;
      $('go').disabled = false;
      $('go').textContent = 'Generate video';
      $('cancel').classList.add('hidden');
    }
  }
  $('go').addEventListener('click', generate);
  $('cancel').addEventListener('click', () => { if (state.ctl) state.ctl.cancelled = true; });
  $('prompt').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate(); });

  /* ---------- history ---------- */
  function addHistory(item) {
    state.history.unshift({ ...item, at: Date.now() });
    state.history = state.history.slice(0, C.HISTORY_LIMIT);
    store.set('ss_history', state.history);
    $('histCount').textContent = state.history.length;
  }
  function renderHistory() {
    const g = $('histGrid');
    g.innerHTML = '';
    if (!state.history.length) { g.appendChild(el('p', 'muted', 'Nothing here yet.')); return; }
    state.history.forEach((h, idx) => {
      const d = el('div', 'h');
      const v = document.createElement('video');
      v.src = h.url + '#t=0.1'; v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.controls = true;
      d.appendChild(v);
      const meta = el('div', 'meta');
      meta.appendChild(el('p', '', h.prompt));
      meta.appendChild(el('span', '', new Date(h.at).toLocaleString() + ' · ' + h.model + ' · ' + h.duration + 's · ' + h.resolution + ' · ' + h.aspect));
      d.appendChild(meta);
      const acts = el('div', 'acts');
      const dl = downloadButton(h.url, 'seedance-' + h.at + '.mp4');
      dl.className = 'ghost'; dl.textContent = 'Download';
      const reuse = el('button', 'ghost', 'Reuse');
      reuse.onclick = () => {
        $('prompt').value = h.prompt;
        const m = C.MODELS.find((x) => x.label === h.model);
        if (m) state.modelId = m.id;
        state.resolution = h.resolution; state.aspect = h.aspect; state.duration = h.duration; state.audio = !!h.audio;
        renderOptions(); updateCount(); show('generate');
      };
      const del = el('button', 'ghost', 'Delete');
      del.onclick = () => {
        state.history.splice(idx, 1);
        store.set('ss_history', state.history);
        $('histCount').textContent = state.history.length;
        renderHistory();
      };
      acts.append(dl, reuse, del);
      d.appendChild(acts);
      g.appendChild(d);
    });
  }
  $('clearHist').addEventListener('click', () => {
    if (!confirm('Delete all history entries?')) return;
    state.history = [];
    store.set('ss_history', []);
    $('histCount').textContent = 0;
    renderHistory();
  });

  /* ---------- boot ---------- */
  renderKeyState();
  renderOptions();
  renderAll();
  updateCount();
  $('histCount').textContent = state.history.length;
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
