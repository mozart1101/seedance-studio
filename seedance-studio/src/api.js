// kie.ai client for Seedance video generation. Exposes window.KieApi.
// Notes:
//  - kie.ai returns HTTP 200 even for errors; the real status is in body.code.
//  - Inside Electron, requests go through window.native (main process).
//  - In Capacitor, CapacitorHttp (see capacitor.config.json) makes fetch native.
(function () {
  const C = window.CONFIG;
  const MB = 1024 * 1024;

  const FRIENDLY = {
    401: 'Invalid or missing API key.',
    402: 'Not enough credits on your kie.ai account.',
    404: 'Resource not found.',
    422: 'The request was rejected (check prompt, files or settings).',
    429: 'Rate limited. Wait a moment and try again.',
    455: 'kie.ai service is under maintenance.',
    500: 'kie.ai server error. Try again shortly.',
  };

  function parseResponse(status, text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error('Unexpected response from server (HTTP ' + status + ').');
    }
    const code = data.code !== undefined ? data.code : status;
    if (code !== 200) throw new Error(FRIENDLY[code] || data.msg || 'API error ' + code);
    return data;
  }

  async function request(url, { method = 'GET', key, json } = {}) {
    const headers = { Authorization: 'Bearer ' + key };
    let body;
    if (json) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    let status, text;
    if (window.native && window.native.http) {
      ({ status, text } = await window.native.http({ url, method, headers, body }));
    } else {
      const res = await fetch(url, { method, headers, body });
      status = res.status;
      text = await res.text();
    }
    return parseResponse(status, text);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read ' + file.name));
      r.readAsDataURL(file);
    });
  }

  function safeName(name) {
    return Date.now().toString(36) + '-' + name.replace(/[^\w.\-]+/g, '_');
  }

  async function uploadBase64(key, file, folder) {
    const base64Data = await fileToDataUrl(file);
    const data = await request(C.UPLOAD_BASE64_URL, {
      method: 'POST',
      key,
      json: { base64Data, uploadPath: folder, fileName: safeName(file.name) },
    });
    return data;
  }

  async function uploadStream(key, file, folder) {
    const fileName = safeName(file.name);
    const headers = { Authorization: 'Bearer ' + key };
    let status, text;
    if (window.native && window.native.upload) {
      const bytes = await file.arrayBuffer();
      ({ status, text } = await window.native.upload({
        url: C.UPLOAD_STREAM_URL, headers, uploadPath: folder, fileName, type: file.type, bytes,
      }));
    } else {
      const fd = new FormData();
      fd.append('file', file, fileName);
      fd.append('uploadPath', folder);
      fd.append('fileName', fileName);
      const res = await fetch(C.UPLOAD_STREAM_URL, { method: 'POST', headers, body: fd });
      status = res.status;
      text = await res.text();
    }
    return parseResponse(status, text);
  }

  // Uploads to kie.ai temp storage (free, deleted after 24h) and returns a URL.
  async function uploadFile(key, file, folder = 'seedance-studio') {
    let data;
    if (file.size <= C.BASE64_MAX_MB * MB) {
      data = await uploadBase64(key, file, folder);
    } else {
      try {
        data = await uploadStream(key, file, folder);
      } catch (e) {
        // Some WebViews can't send multipart; fall back to Base64 for moderately sized files.
        if (file.size <= 30 * MB) data = await uploadBase64(key, file, folder);
        else throw e;
      }
    }
    const url = data.data && data.data.downloadUrl;
    if (!url) throw new Error('Upload succeeded but no URL was returned.');
    return url;
  }

  // Builds the createTask input. First/last frames and multimodal references are mutually exclusive.
  function buildInput(p) {
    const input = {
      prompt: p.prompt,
      generate_audio: !!p.generateAudio,
      resolution: p.resolution,
      aspect_ratio: p.aspect,
      duration: p.duration,
    };
    const hasFrames = p.firstFrame || p.lastFrame;
    const hasRefs = (p.imageUrls || []).length || (p.videoUrls || []).length || (p.audioUrls || []).length;
    if (hasFrames && hasRefs) throw new Error('Use either start/end frames or reference files, not both.');
    if (p.lastFrame && !p.firstFrame) throw new Error('An end frame needs a start frame too.');
    if (p.firstFrame) input.first_frame_url = p.firstFrame;
    if (p.lastFrame) input.last_frame_url = p.lastFrame;
    if ((p.imageUrls || []).length) input.reference_image_urls = p.imageUrls;
    if ((p.videoUrls || []).length) input.reference_video_urls = p.videoUrls;
    if ((p.audioUrls || []).length) input.reference_audio_urls = p.audioUrls;
    return input;
  }

  async function createTask(key, params) {
    const data = await request(C.API_BASE + '/jobs/createTask', {
      method: 'POST',
      key,
      json: { model: params.model, input: buildInput(params) },
    });
    const taskId = data.data && data.data.taskId;
    if (!taskId) throw new Error('No task id returned.');
    return taskId;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Polls until success/fail. `ctl.cancelled = true` stops waiting (the remote task keeps running).
  async function waitForTask(key, taskId, { onState, ctl = {} } = {}) {
    const started = Date.now();
    let delay = C.POLL_START_MS;
    while (!ctl.cancelled) {
      if (Date.now() - started > C.POLL_TIMEOUT_MS) throw new Error('Timed out waiting for the video.');
      await sleep(delay);
      if (ctl.cancelled) break;
      delay = Math.min(Math.round(delay * 1.2), C.POLL_MAX_MS);
      const res = await request(C.API_BASE + '/jobs/recordInfo?taskId=' + encodeURIComponent(taskId), { key });
      const t = res.data || {};
      if (onState) onState(t.state, t);
      if (t.state === 'success') {
        let urls = [];
        try {
          urls = JSON.parse(t.resultJson || '{}').resultUrls || [];
        } catch (_) {}
        if (!urls.length) throw new Error('Task finished but returned no video.');
        return { urls, credits: t.creditsConsumed, costTime: t.costTime };
      }
      if (t.state === 'fail') {
        throw new Error(t.failMsg || 'Generation failed' + (t.failCode ? ' (' + t.failCode + ')' : '') + '.');
      }
    }
    throw new Error('Stopped waiting. The task may still finish and be charged.');
  }

  // Best-effort credit balance lookup.
  async function getCredits(key) {
    const data = await request(C.API_BASE + '/chat/credit', { key });
    return data.data;
  }

  window.KieApi = { uploadFile, buildInput, createTask, waitForTask, getCredits };
})();
