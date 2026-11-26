# UI review loop (used by Claude in the cloud workspace)

1. `npx vite --port 1420` in the project folder (browser mode: data lives in localStorage).
2. `node scripts/ui-review/sample.mjs > /home/claude/harness/sample.json` (fictional projects; `THEME=dark` for dark).
3. `python3 scripts/ui-review/shoot.py <out-folder>`: screenshots Tareas, Proyectos, Rutas, Archivadas,
   a project (Entregas + Línea de tiempo), Informe, Nueva and a narrow window, and prints console errors.
4. Look at the screenshots, fix the worst problems, run `npm test`, repeat. Ship when a round finds nothing big.

Needs Chrome at /usr/bin/google-chrome and Python playwright. Not part of the app build.
