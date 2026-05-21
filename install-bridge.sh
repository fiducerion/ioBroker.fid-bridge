#!/usr/bin/env bash
# =====================================================================
# Fiducerion Bridge — Update-Skript v3
#
# Verwendung:
#   bash install-bridge.sh /tmp/fid.zip
#
# Ziel: /opt/iobroker/node_modules/iobroker.fid-bridge (echtes Verzeichnis)
# - Wenn Symlink: wird zu echtem Verzeichnis konvertiert (root behebt das)
# - node_modules-Unterordner bleibt erhalten
# - Manifest-Check verhindert unvollstaendiges Update
# - iobroker-Befehle laufen als iobroker-User (keine root-Warnung)
# =====================================================================

set -e

ZIP="${1:-}"
TARGET="/opt/iobroker/node_modules/iobroker.fid-bridge"
LEGACY="/opt/iobroker.fid-bridge"
TMPDIR="/tmp/fid_unpack_$$"
IOB_USER="iobroker"
IOB_GROUP="iobroker"

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
grn()   { printf "\033[32m%s\033[0m\n" "$*"; }
yel()   { printf "\033[33m%s\033[0m\n" "$*"; }
blu()   { printf "\033[36m%s\033[0m\n" "$*"; }

iob() {
  if [ "$(id -un)" = "$IOB_USER" ]; then iobroker "$@"
  else sudo -u "$IOB_USER" iobroker "$@"
  fi
}

MANIFEST=(
  "package.json" "io-package.json" "main.js" "LICENSE" "README.md" "install-bridge.sh"
  "lib/server.js" "lib/auth.js" "lib/totp.js"
  "lib/api/states.js" "lib/api/objects.js" "lib/api/instances.js"
  "lib/api/adapters.js" "lib/api/logs.js" "lib/api/themes.js"
  "lib/api/system.js" "lib/api/counts.js" "lib/api/auth.js"
  "lib/api/host.js" "lib/api/repo.js" "lib/api/config.js" "lib/api/scripts.js"
  "lib/api/files.js" "lib/api/links.js" "lib/api/structure.js" "lib/api/notifications.js"
  "lib/api/backup-restore.js" "lib/api/users.js" "lib/api/search.js" "lib/api/analyzer.js"
  "lib/logCollector.js"
  "admin/jsonConfig.json" "admin/fid-bridge.png"
  "admin/i18n/de/translations.json" "admin/i18n/en/translations.json"
  "www/index.html" "www/favicon.png"
  "www/assets/logo.png"
  "www/css/shell.css"
  "www/js/api.js" "www/js/core.js" "www/js/i18n.js" "www/js/theme.js"
  "www/js/toast.js" "www/js/ui.js" "www/js/totp.js" "www/js/terminal.js"
  "www/js/configEditor.js" "www/js/scriptEditor.js" "www/js/expertMode.js"
  "www/js/serviceLog.js" "www/js/globalSearch.js" "www/js/mobileNav.js"
  "www/js/tabs/dashboard.js" "www/js/tabs/services.js" "www/js/tabs/modules.js"
  "www/js/tabs/repo.js" "www/js/tabs/objects.js" "www/js/tabs/logs.js"
  "www/js/tabs/settings.js" "www/js/tabs/scripts.js" "www/js/tabs/system.js"
  "www/js/tabs/files.js" "www/js/tabs/structure.js" "www/js/tabs/users.js"
  "www/js/tabs/analyzer.js"
  "www/themes/lcars/theme.css" "www/themes/lcars/theme.json"
  "www/themes/lcars-light/theme.css" "www/themes/lcars-light/theme.json"
  "www/themes/slate/theme.css" "www/themes/slate/theme.json"
  "www/themes/slate-light/theme.css" "www/themes/slate-light/theme.json"
)

[ -z "$ZIP" ] && { red "Usage: bash install-bridge.sh <pfad_zur_zip>"; exit 1; }
[ ! -f "$ZIP" ] && { red "ZIP nicht gefunden: $ZIP"; exit 1; }

blu "Fiducerion Bridge Installer v5"
blu "  ZIP    = $ZIP"
blu "  TARGET = $TARGET"
echo

LEGACY_TARGET="/opt/iobroker/node_modules/iobroker.miniadmin"
INSTALL_MODE="update"  # update | install | migrate | recovery

# Recovery: Object-DB kennt den Adapter, aber Ordner fehlt komplett.
# Das passiert nach manchen Debian/npm-Updates (cleanup hat node_modules gepurged).
# In dem Fall NICHT add neu machen (sonst wird der Object-Record ueberschrieben),
# sondern nur Files wiederherstellen und installedVersion neu setzen.
if [ ! -d "$TARGET" ]; then
  if sudo -u "$IOB_USER" iobroker object get system.adapter.fid-bridge.0 >/dev/null 2>&1; then
    yel "==> RECOVERY-Modus: Object-DB hat den Adapter, aber Ordner fehlt."
    yel "    (Z.B. nach Debian-Update / npm-cleanup). Wir stellen die Files wieder her,"
    yel "    ohne die DB-Konfig anzufassen."
    INSTALL_MODE="recovery"
  fi
fi

# Migration: vorhandener miniadmin gefunden, neuer noch nicht?
if [ -d "$LEGACY_TARGET" ] && [ ! -d "$TARGET" ] && [ "$INSTALL_MODE" != "recovery" ]; then
  yel "==> Migration erkannt: alter Adapter iobroker.miniadmin vorhanden, neuer wird angelegt."
  INSTALL_MODE="migrate"
fi

# Erstinstallation: weder alt noch neu, auch nicht in der DB
if [ ! -d "$TARGET" ] && [ "$INSTALL_MODE" = "update" ]; then
  yel "==> Erstinstallation: lege $TARGET an."
  INSTALL_MODE="install"
fi

# ---- 1. Symlink-Falle aufloesen ----
if [ -L "$TARGET" ]; then
  yel "==> Ziel ist Symlink. Wird zu echtem Verzeichnis konvertiert..."
  RESOLVED=$(readlink -f "$TARGET")
  sudo rm "$TARGET"
  sudo mkdir -p "$TARGET"
  if [ -d "$RESOLVED" ]; then
    sudo cp -a "$RESOLVED/." "$TARGET/" || true
  fi
  sudo chown -R "$IOB_USER:$IOB_GROUP" "$TARGET"
fi

# ---- 2. Ziel-Ordner sicherstellen ----
if [ ! -d "$TARGET" ]; then
  yel "==> Lege Ziel-Verzeichnis an: $TARGET"
  sudo mkdir -p "$TARGET"
  sudo chown "$IOB_USER:$IOB_GROUP" "$TARGET"
fi

# ---- 3. Bridge stoppen (alte + neue Variante) ----
yel "==> Stoppe Bridge..."
iob stop fid-bridge.0 2>/dev/null || true
iob stop miniadmin.0 2>/dev/null || true

# ---- 4. ZIP entpacken ----
yel "==> Entpacke ZIP nach $TMPDIR..."
mkdir -p "$TMPDIR"
unzip -q -o "$ZIP" -d "$TMPDIR"
SRC="$TMPDIR/iobroker.fid-bridge"
[ -d "$SRC" ] || SRC="$TMPDIR"

# ---- 5. Source-Verify ----
yel "==> Pruefe ZIP-Inhalt..."
MISSING=0
for f in "${MANIFEST[@]}"; do
  if [ ! -f "$SRC/$f" ]; then red "  FEHLT IM ZIP: $f"; MISSING=$((MISSING+1)); fi
done
if [ "$MISSING" -gt 0 ]; then
  red "ZIP ist unvollstaendig. Abbruch."
  rm -rf "$TMPDIR"; exit 2
fi
green "  OK: alle ${#MANIFEST[@]} Files im ZIP."

# ---- 6. Permissions reparieren (vor rm) ----
yel "==> Repariere Permissions..."
sudo chown -R "$IOB_USER:$IOB_GROUP" "$TARGET"
sudo chmod -R u+rwX "$TARGET"

# ---- 7. Ziel leeren (node_modules behalten) ----
yel "==> Leere Ziel (node_modules bleibt)..."
sudo find "$TARGET" -mindepth 1 -maxdepth 1 -not -name node_modules -exec rm -rf {} +

# ---- 8. Kopieren ----
yel "==> Kopiere Files..."
sudo cp -a "$SRC/." "$TARGET/"
sudo chown -R "$IOB_USER:$IOB_GROUP" "$TARGET"

# ---- 9. Ziel-Verify ----
yel "==> Verifiziere am Ziel..."
MISSING=0
for f in "${MANIFEST[@]}"; do
  if [ ! -f "$TARGET/$f" ]; then red "  FEHLT AM ZIEL: $f"; MISSING=$((MISSING+1)); fi
done
[ "$MISSING" -gt 0 ] && { red "Kopier-Fehler. Abbruch."; rm -rf "$TMPDIR"; exit 3; }
green "  OK: alle ${#MANIFEST[@]} Files am Ziel."

VERSION=$(grep '"version"' "$TARGET/io-package.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
green "  io-package.json version: $VERSION"

# ---- 10. npm install nur bei Bedarf ----
yel "==> npm install pruefen..."
NEED_NPM=0
[ ! -d "$TARGET/node_modules" ] && NEED_NPM=1
[ "$TARGET/package.json" -nt "$TARGET/node_modules/.package-lock.json" ] 2>/dev/null && NEED_NPM=1
if [ "$NEED_NPM" = "1" ]; then
  yel "  package.json geaendert oder node_modules fehlt - npm install..."
  (cd "$TARGET" && sudo -u "$IOB_USER" npm install --omit=dev --no-audit --no-fund)
  sudo chown -R "$IOB_USER:$IOB_GROUP" "$TARGET/node_modules"
else
  green "  uebersprungen"
fi

# ---- 11. Aufraeumen ----
rm -rf "$TMPDIR"

# ---- 11b. Bei Neuinstall/Migration: Adapter in iobroker registrieren ----
if [ "$INSTALL_MODE" = "install" ] || [ "$INSTALL_MODE" = "migrate" ]; then
  yel "==> Registriere Adapter in ioBroker..."
  iob url "$TARGET" 2>/dev/null || true

  # Pruefen, ob bereits eine Instance existiert
  if ! iob object get system.adapter.fid-bridge.0 >/dev/null 2>&1; then
    yel "==> Lege Instance fid-bridge.0 an..."
    iob add fid-bridge -h $(hostname) 2>/dev/null || iob add fid-bridge 2>/dev/null || true
    sleep 1
  fi

  if [ "$INSTALL_MODE" = "migrate" ]; then
    yel "==> Migration: alter miniadmin.0 wird deaktiviert..."
    iob set miniadmin.0 --enabled false 2>/dev/null || true
    green "    (Daten werden beim ersten Start der neuen Bridge automatisch uebernommen.)"
    green "    (Wenn alles laeuft, kann der alte Adapter geloescht werden:"
    green "      sudo -u iobroker iobroker del miniadmin.0 )"
  fi
fi

# ---- 11c. Recovery-Mode: nur installedVersion in der DB neu setzen ----
# Sonst wuerde js-controller weiter probieren den Adapter aus npm zu installieren.
if [ "$INSTALL_MODE" = "recovery" ]; then
  yel "==> Recovery: setze installedVersion in der Object-DB auf $VERSION ..."
  # iob url ist hier NICHT noetig (der Adapter ist ja schon in der DB) und wuerde
  # potenziell wieder ein npm-install triggern - skippen wir.
  sudo -u "$IOB_USER" iobroker object set system.adapter.fid-bridge \
    common.installedVersion="$VERSION" 2>/dev/null || true
  green "    installedVersion=$VERSION gesetzt - js-controller wird nicht mehr versuchen den Adapter neu zu installieren."
fi

# ---- 11d. installedFrom auf lokalen Tarball - Reboot-Resistenz ----
# Erklaerung des Problems:
# js-controller versucht bei jedem Reboot/Start jeden Adapter zu validieren.
# Wenn der Adapter-Ordner fehlt (z.B. nach npm-prune, OS-Update, Disk-Race),
# wird automatisch versucht:
#     npm install <common.installedFrom>
# Wenn 'installedFrom' nicht gesetzt ist, faellt es zurueck auf:
#     npm install fid-bridge@<common.installedVersion>
# Das sucht in npm-Registry, findet 'fid-bridge' nicht, schlaegt fehl,
# der Adapter verschwindet aus der Adapter-Liste obwohl die Instance noch da ist.
#
# Loesung: wir packen ein npm-kompatibles Tarball aus den Source-Files,
# legen es FEST in /opt/iobroker/.fid-bridge-tarball.tgz ab und setzen
# installedFrom darauf. Wenn js-controller mal aus dem Ruder laeuft, kann er
# das Tarball selber wieder extrahieren.

TARBALL_PATH="/opt/iobroker/.fid-bridge-tarball.tgz"
yel "==> Erzeuge npm-Tarball fuer Recovery: $TARBALL_PATH"
pushd "$TARGET" > /dev/null
# 'npm pack' erzeugt iobroker.fid-bridge-<version>.tgz im current dir
sudo -u "$IOB_USER" npm pack 2>/dev/null > /tmp/fid-bridge-pack.out || true
PACKED=$(sudo -u "$IOB_USER" sh -c "ls -t iobroker.fid-bridge-*.tgz 2>/dev/null | head -1")
popd > /dev/null
if [ -n "$PACKED" ] && [ -f "$TARGET/$PACKED" ]; then
  sudo mv "$TARGET/$PACKED" "$TARBALL_PATH"
  sudo chown "$IOB_USER:$IOB_GROUP" "$TARBALL_PATH"
  grn "  Tarball erzeugt: $(ls -lh $TARBALL_PATH | awk '{print $5}')"
  INSTALLED_FROM_VALUE="file:$TARBALL_PATH"
else
  yel "  Tarball-Erzeugung fehlgeschlagen, falle auf Pfad-Referenz zurueck"
  INSTALLED_FROM_VALUE="$TARGET"
fi

yel "==> setze installedFrom=$INSTALLED_FROM_VALUE in Object-DB ..."
sudo -u "$IOB_USER" iobroker object set system.adapter.fid-bridge \
  common.installedFrom="$INSTALLED_FROM_VALUE" 2>/dev/null || true
sudo -u "$IOB_USER" iobroker object set system.adapter.fid-bridge \
  common.installedVersion="$VERSION" 2>/dev/null || true

# ---- 11e. Selbstheilungs-Watchdog (cron-Job) installieren ----
# Pruefer-Skript: laeuft alle 10min, prueft ob $TARGET/www/index.html existiert,
# falls nicht: aus Tarball wiederherstellen + Adapter restart.
WATCHDOG_SCRIPT="/opt/iobroker/.fid-bridge-watchdog.sh"
yel "==> Installiere Watchdog: $WATCHDOG_SCRIPT"
sudo tee "$WATCHDOG_SCRIPT" > /dev/null <<'WATCHDOG_EOF'
#!/bin/bash
# fid-bridge Watchdog
# Prueft ob /opt/iobroker/node_modules/iobroker.fid-bridge/ vollstaendig ist.
# Konservativ: NUR Files aus Tarball restaurieren. KEIN npm install (das hat
# in v0.12.2 -> v0.5.1 bei smartlife die ioredis-DB-Connection von
# js-controller umgebracht). KEIN automatischer Adapter-Restart - das macht
# js-controller selber wenn die Files da sind.
TARGET="/opt/iobroker/node_modules/iobroker.fid-bridge"
TARBALL="/opt/iobroker/.fid-bridge-tarball.tgz"
SENTINEL="$TARGET/www/index.html"
LOGFILE="/opt/iobroker/log/fid-bridge-watchdog.log"
COOLDOWN_FILE="/opt/iobroker/.fid-bridge-watchdog.cooldown"
COOLDOWN_SEC=3600

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $1" >> "$LOGFILE"; }

if [ -f "$SENTINEL" ]; then
  exit 0
fi

# Anti-Loop: 1h Cooldown nach letztem Restore
if [ -f "$COOLDOWN_FILE" ]; then
  LAST_TS=$(stat -c %Y "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  AGE=$((NOW - LAST_TS))
  if [ "$AGE" -lt "$COOLDOWN_SEC" ]; then
    log "Sentinel $SENTINEL fehlt aber Cooldown aktiv (${AGE}s < ${COOLDOWN_SEC}s) - kein Eingriff"
    exit 0
  fi
fi

log "FAIL: $SENTINEL fehlt - starte konservatives Recovery (NUR Files, KEIN npm, KEIN restart)"
if [ ! -f "$TARBALL" ]; then
  log "  Kein Tarball bei $TARBALL - manueller Eingriff noetig"
  exit 1
fi

TMPDIR="/tmp/fid-bridge-restore-$$"
mkdir -p "$TMPDIR"
if ! tar -xzf "$TARBALL" -C "$TMPDIR" 2>/dev/null; then
  log "  Tarball-Extraktion fehlgeschlagen - manueller Eingriff noetig"
  rm -rf "$TMPDIR"
  exit 1
fi
SRC="$TMPDIR/package"
[ -d "$SRC" ] || SRC="$TMPDIR"

mkdir -p "$TARGET"
cp -a "$SRC/." "$TARGET/"
chown -R iobroker:iobroker "$TARGET"
rm -rf "$TMPDIR"
touch "$COOLDOWN_FILE"
log "  Files wiederhergestellt. node_modules nicht angefasst."
log "  Falls Adapter trotzdem nicht startet -> manuell: bash install-bridge.sh"
WATCHDOG_EOF
sudo chmod +x "$WATCHDOG_SCRIPT"
sudo chown root:root "$WATCHDOG_SCRIPT"

# Cron-Eintrag installieren falls noch nicht vorhanden
CRON_LINE="0 * * * * $WATCHDOG_SCRIPT"
if ! sudo crontab -l 2>/dev/null | grep -qF "$WATCHDOG_SCRIPT"; then
  (sudo crontab -l 2>/dev/null; echo "$CRON_LINE") | sudo crontab -
  grn "  Watchdog-Cron installiert: $CRON_LINE"
else
  yel "  Watchdog-Cron schon vorhanden, ueberspringe."
fi

# ---- 12. Upload + Start ----
yel "==> iobroker upload fid-bridge..."
iob upload fid-bridge

yel "==> Starte Bridge..."
iob start fid-bridge.0
sleep 3

# ---- 13. Final-Check ----
green "==> Fertig."
echo
echo "  --- Status ---"
iob status fid-bridge.0 || true
echo
echo "  --- Version in Object-DB ---"
iob object get system.adapter.fid-bridge 2>/dev/null | grep -oE '"installedVersion":"[^"]*"' | head -1 || echo "  (Version aus DB nicht ablesbar)"
echo
echo "  --- io-package.json (Disk) ---"
echo "  $(grep '"version"' "$TARGET/io-package.json" | head -1)"
echo
echo "  Browser oeffnen mit Strg+Shift+R fuer Cache-Reset."
