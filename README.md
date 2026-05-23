# iobroker.fid-bridge

Schlanke Verwaltungs-UI für ioBroker als Adapter. Soll mittelfristig der Komplett-Ersatz für den `admin`-Adapter sein — ohne die Features, die im Home-Setup ohnehin nicht gebraucht werden (System-Update-Notifications, ioBroker-Team-Messages, Device Manager).

> **Stand: Iteration 1** — Object-Browser, Live-Logs, Theme-System mit LCARS + Slate. Adapter installieren/löschen, Instanz-CRUD und jsonConfig-Renderer folgen in Iteration 2/3.

## Architektur

```
main.js               Adapter-Lifecycle (ready/unload/message)
lib/server.js         Express + WebSocket auf eigenem Port
lib/auth.js           Bearer-Token-Middleware
lib/api/states.js     GET/PUT/DELETE /api/states/:id
lib/api/objects.js    Object-Browser API, getObjectView-basiert + Cache
lib/api/logs.js       Recent/Tail-Endpoints; Live über WS
lib/api/themes.js     scannt www/themes/ und liefert Metadaten
lib/api/system.js     Host-Info, Versionen
lib/api/adapters.js   read-only Liste (Iter 1) — install/remove kommt
lib/api/instances.js  read-only Liste mit alive-Status

www/index.html        Theme-agnostische Shell
www/css/shell.css     Layout-Skelett, alle Farben/Radien via CSS-Variablen
www/js/api.js         HTTP + WebSocket-Client
www/js/theme.js       lädt /api/themes, swappt <link>-Tag
www/js/core.js        Bootstrap, Tab-Wiring
www/js/tabs/*.js      Dashboard, Objects, Logs

www/themes/lcars/     theme.json + theme.css  — Star-Trek-LCARS
www/themes/slate/     theme.json + theme.css  — neutrales Dark-Theme
```

## Installation (lokal vom Pfad)

```bash
cd /opt/iobroker
iobroker url /pfad/zu/iobroker.fid-bridge
# Instanz erzeugen:
iobroker add fid-bridge
```

Oder über das GitHub-Repo (sobald dort gehostet):

```bash
iobroker url https://github.com/USER/iobroker.fid-bridge/tarball/main
```

## Konfiguration

Im Admin → Instanzen → MiniAdmin → Einstellungen:

- **Zugriff:** eigenen Port aktivieren (Default 8095). Web-Extension folgt in Iter 2.
- **Sicherheit:** Token-Auth aktivieren. Bei leerem Token wird beim Start einer generiert und ins Log geschrieben.
- **UI:** Default-Theme, Start-Tab, Log-Puffergrößen.

## Theme-System

Jedes Theme ist ein Ordner unter `www/themes/<id>/` mit:

- `theme.json` — Metadaten (Label, dark-Flag, Accent-Farbe für Vorschau)
- `theme.css`  — überschreibt nur CSS-Variablen aus `shell.css` (`--ma-bg`, `--ma-accent`, `--ma-radius`, etc.) und optional theme-spezifische Klassen

Neues Theme: Ordner anlegen → Adapter neustarten → erscheint im Dropdown.

## Iterations-Plan

- **Iter 1 (dieser Stand):** Skeleton, Object-Browser, Live-Logs, 2 Themes ✅
- **Iter 2:** Adapter install/upgrade/delete via `sendToHost cmdExec`, Instanz-CRUD (restart/enable/disable), Repository-Browser
- **Iter 3:** jsonConfig-Schema-Renderer (text, number, select, checkbox, accordion, table) — damit Adapter-Konfigs editiert werden können
- **Iter 4:** Script-Editor (CodeMirror), Backup-Trigger, Enums, weitere Themes

## Sicherheits-Hinweis

MiniAdmin kann (ab Iter 2) Adapter installieren und npm-Befehle auf dem Host ausführen. **Niemals** einen offenen Port ohne `requireAuth=true` erreichbar machen. Idealerweise hinter Reverse Proxy mit Basic-Auth oder nur lokal binden (`bindHost: 127.0.0.1`).
