# 🌿 Bitácora Tracker

App de escritorio (Windows y macOS) para registrar y dar seguimiento a las **bitácoras ambientales de SETENA**.
Importa el PDF, programa los recordatorios solos y avisa con **notificaciones nativas del sistema**, aunque la ventana esté cerrada en la bandeja.

**Stack:** Tauri 2 (Rust) + React 19 + TypeScript + Vite. Sin servidor: los datos viven en un archivo local.

---

## Qué hace

| | |
|---|---|
| **Modelo** | Cada bitácora = número `D1-XXXX-AAAA` **+** nombre del proyecto, **fecha de apertura**, estado (*Nueva*, *Abierta*, *Solicitud de Cierre*, *Terminada*) y avance (Pendiente / En proceso / Listo). |
| **Revisiones automáticas** | El usuario **no configura fechas**: todo sale de la apertura. **Revisión mensual** (bitácora + inspección) el mismo día de la apertura cada mes; **informe regencial** cada 6 meses (avisos desde 1 mes antes). Nueva, Abierta y Solicitud de Cierre: siempre. Terminada o archivada: ninguna. |
| **Lista** | Una fila por proyecto: **avance · código · nombre · próxima fecha · estado · B · I · Entregado · editar**. B = bitácora del mes, I = inspección, Entregado = informe regencial. |
| **Calendario del proyecto** | Al editar un proyecto se ve su **calendario de revisiones**: tira de 12 meses con su estado y el mes completo con ● revisión mensual, ◆ informe regencial y ⚑ apertura; ahí mismo se marcan bitácora, inspección e informe. |
| **Pestañas** | **Activas · Mes actual · Mes próximo · Próximos informes · Archivadas** (teclas 1–5). |
| **Archivar** | Los proyectos *Terminados* se archivan con 📦: salen de la lista y de los recordatorios, pero conservan todo su historial y se restauran cuando quieras. |
| **Avance** | Pendiente (rojo), En proceso (amarillo), Listo (verde). Un clic en la tarjeta lo cambia; nombres y colores editables. |
| **Buscador** | Número (con o sin guiones o ceros), proyecto, estado, avance y notas, sin importar mayúsculas ni acentos; busca también en las archivadas. |
| **Notificaciones** | Nativas de Windows / macOS. Cerrar la ventana la deja en la **bandeja**; los avisos siguen llegando. Arranca con el sistema (oculta). |
| **Importar PDF** | En 3 pasos: archivo → resumen → **una por una** (tarjeta limpia con número, proyecto, estado, apertura y avance). Cada bitácora se guarda al confirmarla. **Pausa**: puedes cerrar y seguir otro día (incluso tras reiniciar) con «Continuar» arriba. |
| **Tutorial** | Recorrido paso a paso la primera vez. Se repite desde Ajustes → Ayuda → «Reiniciar tutorial». |
| **Restablecer de fábrica** | Ajustes → Ayuda. Pide escribir BORRAR y antes guarda un respaldo de seguridad. |
| **Exportar** | CSV para Excel (UTF‑8, separador `;` o `,`) y respaldo/restauración `.json`. |
| **Deshacer** | `Ctrl+Z` o el botón «Deshacer» del aviso inferior. |

Atajos: `N` nueva · `I` importar · `R` resumen · `1`–`5` pestañas · `/` o `Ctrl+F` buscar · `T` hoy · `J`/`K` mes siguiente/anterior · `Ctrl+Z` deshacer.

### Qué se reutilizó de Cognose
- **Store único + Undo** (`tools/04-store.js`, `01-config.js`) → `src/lib/store.ts`
- **Sistema de ventanas** `openModal / confirmDialog / showAlert`, con el mismo cierre inteligente al arrastrar (`tools/05-modal.js`) → `src/ui/core.tsx`, ahora con cabecera estilo Habitica
- **Recordatorios** del calendario: lista de avisos, «ya disparados» para no repetir, tarjetas con Abrir / Posponer / Descartar (`cal-remind.js`) → `src/lib/avisos.ts` + `src/ui/AvisoCards.tsx`
- **Mini calendario** de la barra lateral y del selector de fechas (`cal-views.js`, `tools/13-pickers.js`) → `MicroCalendario.tsx`, `DatePick.tsx`
- **Panel de ajustes** con botón flotante, secciones plegables e interruptores (`tools/10-settings.js`, `18-notify.js`) → `Ajustes.tsx`
- **Toast con Deshacer**, chips de energía (ahora estados/colores), piel «neural», tokens de color y tipografía Anton.

---

## Compilar los instaladores

### Opción A — GitHub Actions (Windows **y** macOS, recomendado)
1. Doble clic en **`preparar-github.bat`** (coloca `ci/instaladores.yml` en `.github/workflows/`), y sube la carpeta a un repositorio de GitHub (puede ser privado).
2. En GitHub: **Actions → Instaladores → Run workflow**.
3. Al terminar (~10–15 min), descarga los artefactos:
   - `bitacora-tracker-windows` → `Bitacora Tracker_1.0.0_x64-setup.exe` y `.msi`
   - `bitacora-tracker-macos` → `Bitacora Tracker_1.0.0_universal.dmg` (Intel + Apple Silicon)
   
   También quedan en un borrador de *Release*. Subir una etiqueta `v1.0.1` lo hace automáticamente.

### Opción B — En tu PC con Windows
Requisitos (una sola vez): [Node.js LTS](https://nodejs.org), [Rust](https://rustup.rs) y *Visual Studio Build Tools* con «Desarrollo para escritorio con C++» (el instalador de Rust lo ofrece).
Luego doble clic en **`compilar-windows.bat`**. El `.exe` queda en `src-tauri\target\release\bundle\nsis\`.

`probar-app.bat` abre la app en modo desarrollo (recarga al guardar cambios).

### Opción C — En una Mac
Doble clic en **`compilar-mac.command`** (pide Node.js, Rust y Xcode Command Line Tools).

> **macOS sin firma de Apple:** el `.dmg` va firmado *ad‑hoc*. La primera vez: clic derecho sobre la app → **Abrir** → Abrir.
> Si dice «está dañada»: `xattr -cr "/Applications/Bitacora Tracker.app"`. Para distribuirla sin avisos hace falta una cuenta de Apple Developer (firma + notarización).
>
> **Windows:** SmartScreen puede decir «Windows protegió su PC» por no tener certificado de firma → *Más información* → *Ejecutar de todas formas*.

---

## Dónde se guardan los datos
En una carpeta normal y visible, **Documentos › Bitácora Tracker** (Windows y macOS):
- `bitacoras.json` — todos tus datos (con copia `bitacoras.bak.json`)
- `respaldos/` — un respaldo automático por día (se guardan los 20 más recientes) y uno antes de cada restablecimiento de fábrica

En **Ajustes → Tus datos** puedes abrir la carpeta, **cambiarla** (por ejemplo a OneDrive o iCloud) y **pasar los datos a otra computadora**:
- *Exportar archivo de datos* → lleva el `.json` a la otra computadora → *Importar archivo de datos*. Funciona entre Windows y macOS.
- O copia la carpeta completa y, en la otra computadora, elige *Cambiar carpeta…* → «Usar esos datos».

Las versiones 1.0/1.1 guardaban en la carpeta oculta de la app; al actualizar, los datos se copian solos a la nueva carpeta.

## Estructura
```
src/
  lib/types.ts       modelo de datos
  lib/store.ts       store único, guardado, deshacer, programación de avisos
  lib/avisos.ts      reglas mensual / semestral (todas las fechas se calculan aquí)
  lib/parser.ts      extracción número + proyecto + estado desde el texto del PDF
  lib/pdf.ts         lectura del PDF por filas (pdf.js)
  lib/csv.ts         exportación a CSV
  lib/backend.ts     puente con Tauri (o localStorage en el navegador)
  ui/…               micro-calendario, lista, editor, importar, revisión, ajustes, avisos
src-tauri/src/lib.rs archivo local, hilo de notificaciones, bandeja, inicio automático
test/                pruebas del lector de PDF y de las reglas de avisos (npm test)
```

## Ajustar el lector de PDF
Si tu PDF de SETENA tiene un formato que no se lee bien, copia unas líneas del texto y agrégalas como caso en
`test/parser.test.ts`; la lógica está en `src/lib/parser.ts` (reconoce tablas, «número → nombre», encabezados de sección
como «SOLICITUD DE CIERRE» y nombres partidos en dos líneas). Los PDF escaneados (solo imagen) no tienen texto: copia y pega.
