# ioBroker.fid-bridge

Lean web admin UI for ioBroker — a smaller, themed alternative to the
official `admin` adapter.

> ⚠️ **ALPHA / EXPERIMENTAL** ⚠️
>
> This adapter is in active development on a single production system.
> Breaking changes between versions are expected. There is no support
> guarantee. Issues are welcome but response time is voluntary. Use at
> your own risk.

## Status

**Iteration 1**: skeleton with Object-Browser, live logs, theme system
(LCARS + Slate). Adapter install/remove, instance CRUD and the
jsonConfig schema renderer are planned for iterations 2 and 3.

## Architecture

```
main.js               Adapter lifecycle (ready/unload/message)
lib/server.js         Express + WebSocket on its own port
lib/auth.js           Bearer-token middleware
lib/api/states.js     GET/PUT/DELETE /api/states/:id
lib/api/objects.js    Object browser API, getObjectView-based with cache
lib/api/logs.js       Recent/tail endpoints; live via WS
lib/api/themes.js     scans www/themes/ and returns metadata
lib/api/system.js     host info, versions
lib/api/adapters.js   read-only list (iter 1) — install/remove planned
lib/api/instances.js  read-only list with alive status

www/index.html        theme-agnostic shell
www/css/shell.css     layout skeleton, all colors/radii via CSS variables
www/js/api.js         HTTP + WebSocket client
www/js/theme.js       loads /api/themes, swaps <link> tag
www/js/core.js        bootstrap, tab wiring
www/js/tabs/*.js      Dashboard, Objects, Logs

www/themes/lcars/     theme.json + theme.css — Star-Trek LCARS
www/themes/slate/     theme.json + theme.css — neutral dark theme
```

## Installation

### Option A: via Admin UI

In ioBroker admin: *Adapters → Install via URL*:

```
https://github.com/fiducerion/ioBroker.fid-bridge
```

### Option B: via CLI

```bash
iobroker url https://github.com/fiducerion/ioBroker.fid-bridge
iobroker add fid-bridge
```

### Option C: pin a specific release tag

```bash
iobroker url https://github.com/fiducerion/ioBroker.fid-bridge/tarball/v0.12.5
```

## Configuration

In admin → instances → fid-bridge → settings:

- **Access**: own port (default 8095). Web extension is planned for iter 2.
- **Security**: token auth enabled by default. If left empty, a token is
  generated on startup and written to the log.
- **UI**: default theme, start tab, log buffer sizes.

## Usage

After starting the adapter, open `http://<iobroker-host>:8095/` in your
browser. The token from the adapter log goes in the login screen.

## Theme system

Each theme is a folder under `www/themes/<id>/` with:

- `theme.json` — metadata (label, dark flag, accent color for preview)
- `theme.css` — overrides only CSS variables from `shell.css`
  (`--ma-bg`, `--ma-accent`, `--ma-radius`, ...) plus optional
  theme-specific classes

To add a new theme: create the folder, restart the adapter, the theme
appears in the dropdown.

## Roadmap

- **Iter 1 (current)**: skeleton, object browser, live logs, 2 themes ✅
- **Iter 2**: adapter install/upgrade/delete via `sendToHost cmdExec`,
  instance CRUD (restart/enable/disable), repository browser
- **Iter 3**: jsonConfig schema renderer (text, number, select, checkbox,
  accordion, table) — so adapter configs become editable
- **Iter 4**: script editor (CodeMirror), backup trigger, enums, more themes

## Security warning

`fid-bridge` will (from iter 2 onwards) be able to install adapters and
execute npm commands on the host. **Never** expose an open port without
`requireAuth=true`. Ideally put it behind a reverse proxy with HTTPS, or
bind to localhost only (`bindHost: 127.0.0.1`).

## License

MIT
