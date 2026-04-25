const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const path  = require('path');
const fs    = require('fs');
const { execFile } = require('child_process');

const USER_DATA  = app.getPath('userData');
const DB_PATH    = path.join(USER_DATA, 'games.db');
const COVERS_DIR = path.join(USER_DATA, 'covers');

let SQL, db;

function saveDB() {
  const data = db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDB() {
  SQL = await require('sql.js')();
  db  = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      exe_path    TEXT NOT NULL UNIQUE,
      cover       TEXT,
      steam_id    INTEGER,
      last_played TEXT,
      play_count  INTEGER DEFAULT 0,
      added_at    TEXT DEFAULT (datetime('now')),
      folder_id   INTEGER
    );
    CREATE TABLE IF NOT EXISTS folders (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      path     TEXT NOT NULL UNIQUE,
      label    TEXT,
      type     TEXT DEFAULT 'custom',
      added_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  // Migrar columnas que pueden faltar en DBs antiguas
  try { db.run(`ALTER TABLE games   ADD COLUMN cover     TEXT`);    } catch {}
  try { db.run(`ALTER TABLE games   ADD COLUMN steam_id  INTEGER`); } catch {}
  try { db.run(`ALTER TABLE folders ADD COLUMN type      TEXT DEFAULT 'custom'`); } catch {}
  try { db.run(`ALTER TABLE folders ADD COLUMN label     TEXT`);    } catch {}
  try { db.run(`ALTER TABLE folders ADD COLUMN added_at  TEXT`);    } catch {}

  for (const [k, v] of [
    ['accent','#e84855'],['theme','dark'],
    ['autoscan_on_start','0'],['autoscan_admin','0'],['setup_done','0'],
  ]) db.run(`INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)`, [k, v]);

  saveDB();
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

// ── DB helpers ────────────────────────────────────────────────────────────────
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    for (const k of Object.keys(r)) if (typeof r[k] === 'bigint') r[k] = Number(r[k]);
    rows.push(r);
  }
  stmt.free();
  return rows;
}
function queryGet(sql, params = []) { return queryAll(sql, params)[0] || null; }
function runSave(sql, params = [])  { db.run(sql, params); saveDB(); }

// ── Descarga de imágenes ──────────────────────────────────────────────────────
async function downloadFile(url, dest) {
  // net.fetch uses Electron's browser stack — works where Node https fails
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buf));
}

// ── fetchJSON — net.fetch de Electron (maneja redirects, cookies, TLS) ─────
async function fetchJSON(url) {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Buscar cover por nombre ────────────────────────────────────────────────────
// Flujo: nombre → Steam storesearch (obtener appid) → descargar header.jpg de CDN
ipcMain.handle('cover:fetchByName', async (_, gameName) => {
  try {
    const safeName = String(gameName).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const dest     = path.join(COVERS_DIR, `${safeName}.jpg`);

    // Si ya existe en caché, devolverla directamente
    if (fs.existsSync(dest)) return dest;

    // 1. Buscar appid en Steam
    const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`;
    const data = await fetchJSON(searchUrl);

    let imageUrl = null;

    if (data && data.items && data.items.length > 0) {
      // Usar el primer resultado (el más relevante)
      const appid  = data.items[0].id;
      imageUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
    }

    if (!imageUrl) return null;

    // 2. Descargar la imagen
    await downloadFile(imageUrl, dest);
    return dest;

  } catch (e) {
    return null;
  }
});

// ── Lista negra ───────────────────────────────────────────────────────────────
const NON_GAME_EXES = new Set([
  'vc_redist.x64.exe','vc_redist.x86.exe','vcredist_x64.exe','vcredist_x86.exe',
  'dxwebsetup.exe','directx_jun2010_redist.exe','dotnetfx.exe','dotnet-runtime.exe',
  'dotnet-sdk.exe','windowsdesktop-runtime.exe','oalinst.exe','physxsetup.exe','uerequisites.exe',
  'setup.exe','install.exe','uninstall.exe','uninst.exe','uninstall000.exe',
  'setup_x64.exe','setup_x86.exe','installer.exe','redist.exe','prerequisites.exe',
  'unrealcefsubprocess.exe','crashreportclient.exe','crashpad_handler.exe',
  'sentry_crashpad_handler.exe','unitycrashhandler64.exe','unitycrashhandler32.exe',
  'unity hub.exe','unityhub.exe',
  'easyanticheat.exe','easyanticheat_setup.exe','be_launcher.exe','battleye_launcher.exe',
  'beclient.exe','beclient_x64.exe','vgc.exe','vanguard.exe','faceit.exe','esportal.exe',
  'launch.exe','launcher.exe','launcherqt.exe','gameoverlayui.exe',
  'steam.exe','steamservice.exe','steamwebhelper.exe',
  'epicgameslauncher.exe','eosoverlayrenderer.exe','goggalaxy.exe','galaxyclient.exe',
  'origin.exe','eadesktop.exe','eabackgroundservice.exe',
  'upc.exe','ubisoftconnect.exe','uplay.exe','blizzardgame.exe',
  'dxdiag.exe','regedit.exe','cmd.exe','powershell.exe',
  'cefsharp.browsersubprocess.exe','chrome_crashpad_handler.exe',
  'helper.exe','updater.exe','autoupdate.exe','patcher.exe','bootstrapper.exe',
  'worldeditor.exe','editor.exe','devtools.exe','sdk.exe','hammer.exe','modtools.exe',
]);
const NON_GAME_PATH_KW = [
  '\\redist\\','\\redistributables\\','\\prerequisites\\','\\__installer\\',
  '\\_installer\\','\\setup\\','\\tools\\','\\editor\\','\\sdk\\','\\devtools\\',
  '\\crashpad\\','\\crashreport\\','\\eac\\','\\easyanticheat\\','\\battleye\\',
  '\\cef\\','\\chromium\\',
];
function isLikelyGame(filePath) {
  if (NON_GAME_EXES.has(path.basename(filePath).toLowerCase())) return false;
  const low = filePath.toLowerCase();
  for (const kw of NON_GAME_PATH_KW) if (low.includes(kw)) return false;
  try { if (fs.statSync(filePath).size < 512 * 1024) return false; } catch { return false; }
  return true;
}

// ── Scanning ASYNC con timeout real ──────────────────────────────────────────
// Usamos fs.promises (no bloquea el hilo) + AbortController para timeout real.
// fs.readdirSync bloqueaba Node completamente — esto no.

const fsp = require('fs').promises;

async function scanSteamCommon(commonPath, deadline) {
  const results = [];
  let entries;
  try { entries = await fsp.readdir(commonPath, { withFileTypes: true }); } catch { return results; }

  for (const entry of entries) {
    if (Date.now() > deadline) break;          // timeout real
    if (!entry.isDirectory()) continue;
    const gameDir = path.join(commonPath, entry.name);
    let exes = [];
    try {
      const files = await fsp.readdir(gameDir, { withFileTypes: true });
      exes = files
        .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.exe'))
        .map(f => path.join(gameDir, f.name))
        .filter(isLikelyGame);
    } catch { continue; }

    if (!exes.length) {
      // Buscar un nivel más adentro
      try {
        const subs = await fsp.readdir(gameDir, { withFileTypes: true });
        for (const s of subs) {
          if (Date.now() > deadline) break;
          if (!s.isDirectory()) continue;
          try {
            const subFiles = await fsp.readdir(path.join(gameDir, s.name), { withFileTypes: true });
            exes.push(...subFiles
              .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.exe'))
              .map(f => path.join(gameDir, s.name, f.name))
              .filter(isLikelyGame));
          } catch {}
        }
      } catch {}
    }

    if (!exes.length) continue;
    // Elegir el .exe más grande (suele ser el principal)
    exes.sort((a, b) => {
      try { return fs.statSync(b).size - fs.statSync(a).size; } catch { return 0; }
    });
    results.push({ name: entry.name, exe_path: exes[0] });
  }
  return results;
}

async function scanGeneric(folderPath, deadline, depth = 0, maxDepth = 3) {
  const results = [];
  if (depth > maxDepth || Date.now() > deadline) return results;
  let entries;
  try { entries = await fsp.readdir(folderPath, { withFileTypes: true }); } catch { return results; }

  for (const entry of entries) {
    if (Date.now() > deadline) break;
    const full = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await scanGeneric(full, deadline, depth + 1, maxDepth);
      results.push(...sub);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && isLikelyGame(full)) {
      results.push({ name: path.basename(full, '.exe'), exe_path: full });
    }
  }
  return results;
}

function findSteamCommon(folderPath) {
  // Normalizar separadores para comparación consistente
  const norm = folderPath.replace(/\\/g, '/');
  const low  = norm.toLowerCase();

  // Caso 1: el usuario seleccionó directamente .../steamapps/common
  if (low.endsWith('steamapps/common') || low.endsWith('steamapps\\common')) {
    if (fs.existsSync(folderPath)) return folderPath;
  }

  // Caso 2: el usuario seleccionó .../steamapps  (sin /common)
  if (low.endsWith('/steamapps') || low.endsWith('\\steamapps')) {
    const c = path.join(folderPath, 'common');
    if (fs.existsSync(c)) return c;
  }

  // Caso 3: la ruta contiene 'steamapps' en algún punto intermedio
  if (low.includes('steamapps')) {
    // Subir hasta steamapps y bajar a common
    const parts = folderPath.replace(/\\/g, '/').split('/');
    const idx   = parts.map(p => p.toLowerCase()).lastIndexOf('steamapps');
    if (idx !== -1) {
      const c = parts.slice(0, idx + 1).join('/') + '/common';
      const cNorm = path.normalize(c);
      if (fs.existsSync(cNorm)) return cNorm;
    }
  }

  // Caso 4: el usuario seleccionó la carpeta de Steam raíz (contiene steamapps como hijo)
  const c1 = path.join(folderPath, 'steamapps', 'common');
  if (fs.existsSync(c1)) return c1;

  // Caso 5: carpeta con nombre 'steam' o 'steam library' — buscar steamapps dentro
  if (low.includes('steam')) {
    const c2 = path.join(folderPath, 'Steam', 'steamapps', 'common');
    if (fs.existsSync(c2)) return c2;
  }

  return null;
}

// ── IPC: games ────────────────────────────────────────────────────────────────
ipcMain.handle('db:getGames',       ()              => queryAll('SELECT * FROM games ORDER BY name'));
ipcMain.handle('db:searchGames',    (_, q)          => queryAll('SELECT * FROM games WHERE name LIKE ? ORDER BY name', [`%${q}%`]));
ipcMain.handle('db:removeGame',     (_, id)         => { runSave('DELETE FROM games WHERE id=?', [id]); return { ok: true }; });
ipcMain.handle('db:updateGameName', (_, { id, name }) => { runSave('UPDATE games SET name=? WHERE id=?', [name, id]); return { ok: true }; });

ipcMain.handle('db:addGame', (_, { name, exe_path, folder_id, cover, steam_id }) => {
  try {
    runSave(
      `INSERT OR IGNORE INTO games(name,exe_path,folder_id,cover,steam_id) VALUES(?,?,?,?,?)`,
      [name, exe_path, folder_id || null, cover || null, steam_id || null]
    );
    // Si ya existía, actualizamos cover/steam_id si se proveen
    if (cover || steam_id) {
      if (cover)    db.run(`UPDATE games SET cover=?    WHERE exe_path=? AND cover IS NULL`,    [cover,    exe_path]);
      if (steam_id) db.run(`UPDATE games SET steam_id=? WHERE exe_path=? AND steam_id IS NULL`, [steam_id, exe_path]);
      saveDB();
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('db:updateGameCover', (_, { id, cover, steam_id, name }) => {
  const sets = [];
  const vals = [];
  if (cover)    { sets.push('cover=?');    vals.push(cover);    }
  if (steam_id) { sets.push('steam_id=?'); vals.push(steam_id); }
  if (name)     { sets.push('name=?');     vals.push(name);     }
  if (!sets.length) return { ok: false };
  vals.push(id);
  runSave(`UPDATE games SET ${sets.join(',')} WHERE id=?`, vals);
  return { ok: true };
});

// ── Normalizar path — siempre forward slashes, sin trailing slash ─────────────
function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

// ── IPC: folders ──────────────────────────────────────────────────────────────
ipcMain.handle('db:getFolders', () => queryAll('SELECT * FROM folders ORDER BY label'));
ipcMain.handle('db:removeFolder', (_, id) => { runSave('DELETE FROM folders WHERE id=?', [id]); return { ok: true }; });

ipcMain.handle('db:addFolder', (_, { folderPath, type }) => {
  try {
    if (!folderPath) return { ok: false, error: 'No folder path provided' };

    const normPath   = normalizePath(folderPath);
    const label      = path.basename(normPath) || normPath;
    const folderType = type || 'custom';

    console.log('[addFolder] normPath:', normPath);

    // 1. Eliminar duplicados con formato diferente
    const allExisting = queryAll('SELECT * FROM folders');
    for (const row of allExisting) {
      if (normalizePath(row.path) === normPath && row.path !== normPath) {
        console.log('[addFolder] removing duplicate:', row.path);
        db.run('DELETE FROM folders WHERE id=?', [row.id]);
      }
    }

    // 2. INSERT OR REPLACE — siempre crea o actualiza el registro
    db.run(
      `INSERT OR REPLACE INTO folders(path, label, type) VALUES(?, ?, ?)`,
      [normPath, label, folderType]
    );
    saveDB();
    console.log('[addFolder] inserted/replaced');

    // 3. SELECT para obtener el id asignado
    const folder = queryGet('SELECT * FROM folders WHERE path=?', [normPath]);
    console.log('[addFolder] queryGet result:', JSON.stringify(folder));

    if (!folder) {
      // Listar todo lo que hay en la BD para debug
      const all = queryAll('SELECT * FROM folders');
      console.log('[addFolder] all folders in DB:', JSON.stringify(all));
      return { ok: false, error: `Record not found after insert. DB has ${all.length} folders.` };
    }

    return { ok: true, folder };
  } catch (e) {
    console.error('[addFolder] exception:', e.message, e.stack);
    return { ok: false, error: e.message };
  }
});

// ── IPC: settings ─────────────────────────────────────────────────────────────
ipcMain.handle('db:getSetting',  (_, key)          => { const r = queryGet('SELECT value FROM settings WHERE key=?', [key]); return r ? r.value : null; });
ipcMain.handle('db:setSetting',  (_, { key, value }) => { runSave(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`, [key, value]); return { ok: true }; });
ipcMain.handle('db:isFirstRun',  ()                => { const r = queryGet(`SELECT value FROM settings WHERE key='setup_done'`); return !r || r.value !== '1'; });

// ── IPC: scan CON TIMEOUT ─────────────────────────────────────────────────────
ipcMain.handle('scan:folder', async (_, folderPath) => {
  try {
    if (!folderPath) return { results: [], mode: 'generic', steamCommon: null };
    // Convertir a backslashes para fs (Windows lo necesita para existsSync)
    const winPath = folderPath.replace(/\//g, '\\');
    if (!fs.existsSync(winPath) && !fs.existsSync(folderPath))
      return { results: [], mode: 'generic', steamCommon: null };
    folderPath = fs.existsSync(winPath) ? winPath : folderPath;

    const TIMEOUT_MS = 12000;
    const deadline   = Date.now() + TIMEOUT_MS;

    const sc = findSteamCommon(folderPath);
    if (sc) {
      const results = await scanSteamCommon(sc, deadline);
      return { results: results || [], mode: 'steam', steamCommon: normalizePath(sc) };
    }
    const low = folderPath.toLowerCase().replace(/\\/g, '/');
    if (low.endsWith('steamapps/common')) {
      const results = await scanSteamCommon(folderPath, deadline);
      return { results: results || [], mode: 'steam', steamCommon: normalizePath(folderPath) };
    }
    const results = await scanGeneric(folderPath, deadline);
    return { results: results || [], mode: 'generic', steamCommon: null };
  } catch (e) {
    console.error('scan:folder error:', e);
    return { results: [], mode: 'generic', steamCommon: null };
  }
});

ipcMain.handle('scan:importResults', (_, { games, folderId }) => {
  for (const g of games)
    db.run(`INSERT OR IGNORE INTO games(name,exe_path,folder_id,cover,steam_id) VALUES(?,?,?,?,?)`,
      [g.name, g.exe_path, folderId, g.cover || null, g.steam_id || null]);
  saveDB();
  return { ok: true, count: games.length };
});

ipcMain.handle('steam:detectLibraries', () => {
  const found = [];
  for (const drive of ['C','D','E','F','G'])
    for (const p of [
      `${drive}:\\Program Files (x86)\\Steam\\steamapps\\common`,
      `${drive}:\\Program Files\\Steam\\steamapps\\common`,
      `${drive}:\\Steam\\steamapps\\common`,
      `${drive}:\\SteamLibrary\\steamapps\\common`,
      `${drive}:\\Games\\SteamLibrary\\steamapps\\common`,
    ]) if (fs.existsSync(p)) found.push(p);
  return found;
});

// ── IPC: launch ───────────────────────────────────────────────────────────────
ipcMain.handle('game:launch', (_, exePath) => {
  try {
    runSave(`UPDATE games SET play_count=play_count+1, last_played=datetime('now') WHERE exe_path=?`, [exePath]);
    execFile(exePath, { cwd: path.dirname(exePath), detached: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('game:openFolder', (_, p) => { shell.showItemInFolder(p); return { ok: true }; });

// ── IPC: dialogs ──────────────────────────────────────────────────────────────
ipcMain.handle('dialog:selectFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:selectExe', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Ejecutables', extensions: ['exe'] }] });
  return r.canceled ? null : r.filePaths[0];
});

// ── IPC: covers ───────────────────────────────────────────────────────────────
// Convertir ruta local a data URI para mostrar en renderer (contextIsolation seguro)
ipcMain.handle('cover:getDataUri', (_, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    const ext  = path.extname(filePath).slice(1) || 'jpg';
    return `data:image/${ext};base64,${data.toString('base64')}`;
  } catch { return null; }
});

// ── IPC: window ───────────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWin?.minimize());
ipcMain.on('window:maximize', () => { if (mainWin?.isMaximized()) mainWin.unmaximize(); else mainWin?.maximize(); });
ipcMain.on('window:close',    () => mainWin?.close());

let mainWin;
function createWindow() {
  mainWin = new BrowserWindow({
    width: 1100, height: 700, minWidth: 800, minHeight: 550,
    frame: false, backgroundColor: '#0d0d0f',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWin.loadFile(path.join(__dirname, 'index.html'));
  // Abrir DevTools con F12
  mainWin.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'F12') mainWin.webContents.openDevTools({ mode: 'detach' });
  });
  // Log errores del renderer en consola de Node
  mainWin.webContents.on('console-message', (_, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[Renderer L${level}] ${message}  (${sourceId}:${line})`);
  });
}

app.whenReady().then(async () => {
  await initDB();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
