// ===== Automatic updates (installed app only) =====
// The app looks for a new version in the GitHub Releases on start and every 6 hours.
// If there is one it asks; when accepted it downloads it, installs it and restarts by itself. The data is untouched
// (it lives in Documents › Bitácora Tracker), so nothing is lost.
import { esTauri } from './backend';

export interface VersionInfo { current: string; isNew: string | null; notes: string }

let searching = false;
let lastNotified = '';

/** Installed version (or '' outside the app). */
export async function currentVersion(): Promise<string> {
  if (!esTauri) return '';
  try { const { getVersion } = await import('@tauri-apps/api/app'); return await getVersion(); } catch { return ''; }
}

/** Looks for a new version. Returns null if there is none or if it fails (no internet, etc.). */
export async function checkForUpdate(): Promise<{ version: string; notes: string; install: (progress: (p: number) => void) => Promise<void> } | null> {
  if (!esTauri) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const u = await check();
  if (!u) return null;
  return {
    version: u.version,
    notes: u.body ?? '',
    async install(progress) {
      let total = 0, downloaded = 0;
      await u.downloadAndInstall(ev => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') { downloaded += ev.data.chunkLength; if (total) progress(Math.min(99, Math.round((downloaded / total) * 100))); }
        else if (ev.event === 'Finished') progress(100);
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    }
  };
}

/** Silent background check: only notifies (once per version) when there is something new. */
export function checkInBackground(onFound: (version: string, notes: string, install: (p: (n: number) => void) => Promise<void>) => void) {
  if (!esTauri) return;
  const check = async () => {
    if (searching) return;
    searching = true;
    try {
      const u = await checkForUpdate();
      if (u && u.version !== lastNotified) { lastNotified = u.version; onFound(u.version, u.notes, u.install); }
    } catch { /* sin internet o sin releases: se intenta más tarde */ }
    searching = false;
  };
  setTimeout(check, 8000);
  setInterval(check, 6 * 3600e3);
}
