# Seedance Studio

A video generator for **Seedance 2.0** (ByteDance's video model, "Seedream" is the image sibling) via the [kie.ai](https://kie.ai) API. Runs on **Windows** (Electron) and **Android** (Capacitor APK, or an installable web app). One codebase, plain HTML/CSS/JS, no build step.

## Features

- Models: Seedance 2.0 and Seedance 2.0 Fast (add more in `src/config.js`)
- Two input modes, which the API does not allow to be mixed:
  - **Start & end frames** (image-to-video)
  - **Reference files**: up to 9 images, 3 videos (15 s total), 3 audio clips (15 s total), used in the prompt as `@image1`, `@video1`, `@audio1` (click a token to insert it)
- Options: generate audio on/off, duration 4-15 s, resolution (480p/720p/1080p), aspect ratio (adaptive, 16:9, 9:16, 4:3, 3:4, 1:1, 21:9)
- Video player, download MP4, history with "reuse", credit check
- API key stored only on your device (local storage)
- Provider content checks are left at their defaults; the app does not expose a way to turn them off

## 1. Prerequisites (not VS Code extensions)

| Tool | Needed for | Notes |
|---|---|---|
| **VS Code** | editing | https://code.visualstudio.com |
| **Node.js 20 LTS or newer** | everything | includes `npm` |
| **Android Studio** + JDK 17 | building the Android APK only | VS Code alone cannot build an APK |

## 2. VS Code extensions

Open the folder in VS Code and accept the "install recommended extensions" prompt (it reads `.vscode/extensions.json`), or install them yourself.

**Recommended**

| Extension | ID |
|---|---|
| ESLint | `dbaeumer.vscode-eslint` |
| Prettier - Code formatter | `esbenp.prettier-vscode` |
| Live Server | `ritwickdey.liveserver` |
| HTML CSS Support | `ecmel.vscode-html-css` |
| Error Lens | `usernamehw.errorlens` |
| Path Intellisense | `christian-kohler.path-intellisense` |
| PowerShell | `ms-vscode.powershell` |
| Markdown All in One | `yzhang.markdown-all-in-one` |

**Optional (Android)**

| Extension | ID | Why |
|---|---|---|
| Ionic | `ionic.ionic` | Capacitor helpers |
| Extension Pack for Java | `vscjava.vscode-java-pack` | only if you edit native Android code |
| Gradle for Java | `vscjava.vscode-gradle` | only if you edit native Android code |

None are strictly required. Electron debugging uses VS Code's built-in JavaScript debugger.

## 3. Setup and run

```bash
npm install
npm start            # Windows desktop app (or press F5 in VS Code)
```

Open **Settings**, paste your kie.ai API key, press Save.

Browser preview: `npm run web` (http://localhost:5173) or Live Server on `src/index.html`. Browsers may block direct calls to the kie.ai API (CORS); use Electron or the Capacitor app for real use.

## 4. Build

**Windows installer / portable exe**

```bash
npm run dist:win     # output in dist/
```

**Android APK**

```bash
npm run cap:add      # once
npm run android      # syncs files, opens Android Studio
```

In Android Studio: **Build -> Build APK(s)**. After editing `src/`, run `npm run cap:sync` again.

## 5. Project layout

```
src/index.html        UI markup
src/styles.css        theme and layout
src/config.js         models, resolutions, limits (edit here)
src/api.js            kie.ai client: upload, createTask, poll, credits
src/app.js            UI logic, upload slots, history
electron/main.js      desktop shell + network/upload/download bridge
electron/preload.js   exposes window.native to the UI
capacitor.config.json Android wrapper settings (native HTTP)
.vscode/              recommended extensions, debug + task configs
```

## 6. How it talks to kie.ai

1. Files are uploaded to kie.ai temp storage (free, deleted after 24 h): Base64 upload up to 8 MB, multipart stream upload above that.
2. `POST https://api.kie.ai/api/v1/jobs/createTask` with `{ model, input }`, where input has `prompt`, `generate_audio`, `resolution`, `aspect_ratio`, `duration`, and either `first_frame_url`/`last_frame_url` or `reference_image_urls`/`reference_video_urls`/`reference_audio_urls`.
3. `GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...` every 5-15 s until `state` is `success` or `fail`. Result links are kept about 14 days.

kie.ai returns HTTP 200 even for errors, so `api.js` checks the `code` field in the body.

## Troubleshooting

- **"Invalid or missing API key"**: re-paste the key in Settings.
- **"Not enough credits"**: top up at kie.ai. Video runs cost far more than images.
- **Stop waiting**: only stops the app from polling; the task may still finish and be charged.
- **Large video upload fails on Android**: some WebViews can't send multipart. The app falls back to Base64 (up to 30 MB); trim or compress the clip if it still fails.
- **Download opens a browser tab on Android**: long-press the video and choose download.
- **Resolution / duration errors**: limits change; check `docs.kie.ai` and edit `src/config.js`.
