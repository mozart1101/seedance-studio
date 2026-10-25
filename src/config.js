// Edit this file to tweak the app. Nothing here is secret.
// Limits come from the kie.ai Seedance 2.0 docs; re-check docs.kie.ai if they change.
window.CONFIG = {
  API_BASE: 'https://api.kie.ai/api/v1',
  UPLOAD_BASE64_URL: 'https://kieai.redpandaai.co/api/file-base64-upload',
  UPLOAD_STREAM_URL: 'https://kieai.redpandaai.co/api/file-stream-upload',

  // To add another model (e.g. a newer Seedance), add an entry here.
  MODELS: [
    {
      id: 'bytedance/seedance-2',
      label: 'Seedance 2.0',
      resolutions: ['480p', '720p', '1080p'],
      defaultResolution: '720p',
    },
    {
      id: 'bytedance/seedance-2-fast',
      label: 'Seedance 2.0 Fast',
      resolutions: ['480p', '720p'],
      defaultResolution: '720p',
    },
  ],

  ASPECT_RATIOS: ['adaptive', '16:9', '9:16', '4:3', '3:4', '1:1', '21:9'],
  DEFAULT_ASPECT: '9:16',

  DURATION_MIN: 4,
  DURATION_MAX: 15,
  DEFAULT_DURATION: 8,

  MAX_PROMPT_CHARS: 20000,

  // Per-slot limits
  LIMITS: {
    frame: { max: 1, maxMB: 30 },
    image: { max: 9, maxMB: 30 },
    video: { max: 3, maxMB: 50, maxTotalSec: 15 },
    audio: { max: 3, maxMB: 15, maxTotalSec: 15 },
  },

  // Files up to this size use the Base64 upload; larger ones use the stream upload.
  BASE64_MAX_MB: 8,

  // Videos take minutes, so poll slowly.
  POLL_START_MS: 5000,
  POLL_MAX_MS: 15000,
  POLL_TIMEOUT_MS: 30 * 60 * 1000,

  HISTORY_LIMIT: 100,
};
