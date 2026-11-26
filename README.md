# 🌿 Bitácora Tracker

Desktop app (Windows and macOS) to track **SETENA environmental logbooks (bitácoras)** in Costa Rica.
It imports the SETENA PDF, works out every due date, and sends **native system notifications** even
when the window is closed to the tray. The app's screens are in Spanish; the code is in English.

**Stack:** Tauri 2 (Rust) + React 19 + TypeScript + Vite. No server: data lives in a local file.

---

## What it does

| | |
|---|---|
| **Projects** | Each project = code `D1-XXXX-YYYY` **+** project name, **opening date**, status (*Nueva*, *Abierta*, *Solicitud de Cierre*, *Terminada*), progress label, **location** and notes. |
| **Deliveries** | Computed from the opening date, each one adjustable by hand: **Informe Regencial** every month (same day as the opening) and **Regencia** every 6 months (reminders from 1 month before). Each delivery has 4 steps with the date each was done — 🚗 visit · 📷 photos · ✉️ letter · ⬆ uploaded to SETENA — and a space to **write the letter** (a template will fill it later). New and Open: always. Closing request (already finished), Finished or archived: none. |
| **Priority by date** | The list is sorted by the most urgent pending delivery (overdue first). |
| **Agenda y rutas** tab | Everything pending by date, and **trips** that group projects less than X km apart (configurable), with the route in Google Maps. |
| **Photos** | Date and GPS are read from the photos (EXIF): they set the visit date, tick the month's visit + photos, fill in the project location, and warn if the photos were taken far from the project. |
| **Photos from the phone** | «Fotos desde el celular» shows a QR. With the phone on the same Wi‑Fi, a page opens to pick the project, take or choose photos and write a note; they arrive in the app as a new entry (with date and GPS). |
| **Project log** | Entries with date, type, text and **photos / PDFs**, saved in `Documents/Bitácora Tracker/proyectos/<code>/`. Each one stays «Por subir a SETENA» until marked as uploaded. |
| **Closing projects** | Finished projects are archived with 📦: they leave the list and the reminders, keep all their history, and can be restored. |
| **Tabs** | **Activas · Agenda y rutas · Mes actual · Mes próximo · Regencias · Archivadas** (keys 1–6). |
| **Search** | Code (with or without dashes or zeros), project, status, progress and notes, ignoring case and accents; also searches archived projects. |
| **Notifications** | Native on Windows / macOS. Closing the window leaves it in the **tray**; reminders keep arriving. Starts with the system (hidden). |
| **PDF import** | In 3 steps: file → summary → **one by one**. Each project is saved when confirmed. Can be **paused** and resumed another day. |
| **Automatic updates** | The installed app checks GitHub Releases on start and every 6 hours and updates itself (see below). |
| **Help** | **?** button bottom right: step-by-step tour or «¿Qué hace cada cosa?» mode. |
| **Export** | CSV for Excel (UTF‑8, `;` or `,` separator) and `.json` backup/restore. **Undo** with `Ctrl+Z`. |

Shortcuts: `N` new · `I` import · `R` summary · `1`–`6` tabs · `/` or `Ctrl+F` search · `,` settings · `Ctrl+Z` undo.

---

## Automatic updates (no reinstalling)

From v1.6 the installed app updates itself from the GitHub Releases: on start and every 6 hours it looks for a new
version, asks, then installs it and reopens (the data is untouched). Also in Settings → 🔄 Actualizaciones.

1. **Once:** double-click **`setup-updates.bat`**. It creates the signing key in `%USERPROFILE%\.tauri\`
   (**keep a copy!**), puts the public key in the app and saves the private one as the GitHub secret
   `TAURI_SIGNING_PRIVATE_KEY`.
2. **Every fix:** double-click **`publish-update.bat`** → type what you changed. It bumps the version, commits, tags
   and pushes; GitHub builds Windows and Mac (~15 min) and publishes the Release with `latest.json`.
3. The first version with updates has to be installed by hand once (from the Release). After that, never again.

> The GitHub repository must be **public** so the app can download the Releases without signing in.

## Building the installers by hand

- **GitHub Actions (Windows + macOS):** run **`prepare-github.bat`** once (copies `ci/installers.yml` to
  `.github/workflows/`), push, then **Actions → Installers → Run workflow**, or push a `v1.6.1` tag.
- **Windows PC:** needs [Node.js LTS](https://nodejs.org), [Rust](https://rustup.rs) and *Visual Studio Build Tools*
  with "Desktop development with C++". Double-click **`build-windows.bat`**; the `.exe` ends up in
  `src-tauri\target\release\bundle\nsis\`. **`run-dev.bat`** opens the app in development mode (reloads on save).
- **Mac:** double-click **`build-mac.command`** (needs Node.js, Rust and Xcode Command Line Tools).

> **macOS without an Apple signature:** the `.dmg` is ad‑hoc signed. The first time: right-click the app → **Open** → Open.
> If it says it's "damaged": `xattr -cr "/Applications/Bitacora Tracker.app"`.
>
> **Windows:** SmartScreen may say "Windows protected your PC" because there's no signing certificate → *More info* → *Run anyway*.

---

## Where the data lives

In a normal, visible folder, **Documents › Bitácora Tracker** (Windows and macOS):
- `bitacoras.json` — all your data (with a `bitacoras.bak.json` copy)
- `respaldos/` — one automatic backup per day (the 20 most recent are kept) and one before each factory reset
- `proyectos/<code>/` — photos and files of each project

These on-disk names are kept from earlier versions. Files saved by v1.5 and earlier (Spanish keys) are read and
converted automatically (`normalize()` in `src/lib/store.ts`); they are saved in the new format on the next change.

In **Settings → Tus datos** you can open the folder, **change** it (e.g. to OneDrive or iCloud) and **move the data to
another computer** (export / import the `.json`, or copy the folder and choose *Cambiar carpeta…* → «Usar esos datos»).

## Web version (optional)

The same app also runs in a browser with sign-in (`npm run build:web` → `dist-web/`, plus the single-file PHP server
`web/api.php`, PHP 7.4+, no database). The desktop app doesn't need it.

## Structure
```
src/
  lib/types.ts       data model
  lib/store.ts       single store, loading/migrating saved data, saving, undo, reminder scheduling
  lib/schedule.ts    monthly / semiannual rules, priority by date, agenda (all dates are computed here)
  lib/exif.ts        date and GPS from photos (JPEG EXIF, no dependencies)
  lib/geo.ts         distances, reading coordinates / Maps links, groups of nearby projects and routes
  lib/parser.ts      extracting code + project + status from the PDF text
  lib/pdf.ts         reading the PDF row by row (pdf.js)
  lib/search.ts      search
  lib/csv.ts         CSV export
  lib/updater.ts     automatic updates
  lib/backend.ts     bridge to Tauri (or localStorage / PHP server in the browser)
  ui/…               project list, editor, calendar, deliveries, log, agenda, import, review, settings, help
src-tauri/src/lib.rs    local file, notification thread, tray, autostart
src-tauri/src/phone.rs  photos from the phone over Wi‑Fi (with phone.html)
test/                PDF reader, schedule rules, search and deliveries tests (npm test)
```

## Tuning the PDF reader
If a SETENA PDF isn't read well, copy a few lines of its text and add them as a case in `test/parser.test.ts`;
the logic is in `src/lib/parser.ts` (it handles tables, «code → name», section headings like «SOLICITUD DE CIERRE»
and names split over two lines). Scanned PDFs (image only) have no text: copy and paste instead.
