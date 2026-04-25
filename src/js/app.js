'use strict';

// ── Estado ────────────────────────────────────────────────────────────────────
let allGames    = [];
let currentView = 'grid';
let ctxGame     = null;
let renameGame  = null;

// Wizard
let frSelectedPaths  = new Set();
let frAutoScan       = false;
let frAdminScan      = false;
let frSelectedAccent = '#e84855';

const FR_ACCENTS = [
  '#e84855','#ff6b35','#f59e0b','#10b981',
  '#00d4aa','#3b82f6','#6366f1','#a855f7',
  '#ec4899','#14b8a6','#84cc16','#f97316',
];
const FR_COMMON_PATHS = [
  { label:'Steam — Program Files (x86)', path:'C:\\Program Files (x86)\\Steam\\steamapps\\common' },
  { label:'Steam — Program Files',       path:'C:\\Program Files\\Steam\\steamapps\\common' },
  { label:'SteamLibrary  D:\\',          path:'D:\\SteamLibrary\\steamapps\\common' },
  { label:'SteamLibrary  E:\\',          path:'E:\\SteamLibrary\\steamapps\\common' },
  { label:'Epic Games',                  path:'C:\\Program Files\\Epic Games' },
  { label:'GOG Galaxy',                  path:'C:\\Program Files (x86)\\GOG Galaxy\\Games' },
  { label:'Ubisoft Connect',             path:'C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games' },
  { label:'EA App',                      path:'C:\\Program Files\\EA Games' },
  { label:'Xbox / Game Pass',            path:'C:\\XboxGames' },
  { label:'Games  D:\\',                 path:'D:\\Games' },
  { label:'Games  E:\\',                 path:'E:\\Games' },
  // { label:'Mi carpeta', path:'D:\\MisJuegos' },
];

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  applyStoredTheme();
  bindWindowControls();
  bindNavButtons();
  bindToolbar();
  bindContextMenu();
  bindSearch();

  const isFirst = await api.isFirstRun();
  if (isFirst) {
    showWizard();
  } else {
    await loadGames();
    await renderFolderSidebar();
    await renderSettingsView();
  }
});

// ── Tema ──────────────────────────────────────────────────────────────────────
async function applyStoredTheme() {
  const accent = await api.getSetting('accent');
  if (accent) setAccent(accent, false);
}
function setAccent(color, save = true) {
  document.documentElement.style.setProperty('--accent', color);
  const r=parseInt(color.slice(1,3),16), g=parseInt(color.slice(3,5),16), b=parseInt(color.slice(5,7),16);
  document.documentElement.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.35)`);
  if (save) api.setSetting('accent', color);
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.color === color));
}

// ── Ventana ───────────────────────────────────────────────────────────────────
function bindWindowControls() {
  document.getElementById('btn-min').addEventListener('click',   () => api.minimize());
  document.getElementById('btn-max').addEventListener('click',   () => api.maximize());
  document.getElementById('btn-close').addEventListener('click', () => api.close());
}

// ── Navegación ────────────────────────────────────────────────────────────────
function bindNavButtons() {
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}
function switchView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`)?.classList.add('active');
  if (name === 'recent')    renderRecent();
  if (name === 'favorites') renderFavorites();
  if (name === 'settings')  renderSettingsView();
  if (name === 'grid')      renderGrid(allGames);
}

// ── Juegos ────────────────────────────────────────────────────────────────────
async function loadGames() {
  allGames = await api.getGames();
  renderGrid(allGames);
  setCount(allGames.length);
}

function renderGrid(games) {
  const container = document.getElementById('view-grid');
  container.innerHTML = '';
  if (!games.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🎮</div>
      <p>No hay juegos.<br>Añade carpetas con <strong>+ Carpeta</strong> o un ejecutable con <strong>+ .exe</strong>.</p>
    </div>`;
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'game-grid';
  games.forEach((g, i) => {
    const card = buildCard(g);
    card.style.animationDelay = `${Math.min(i * 18, 280)}ms`;
    grid.appendChild(card);
  });
  container.appendChild(grid);
  // Cargar portadas asíncronamente sin bloquear el render
  games.forEach(g => { if (g.cover) loadCardCover(g.id, g.cover); });
}

function buildCard(game) {
  const card = document.createElement('div');
  card.className = 'game-card';
  card.dataset.id = game.id;
  card.innerHTML = `
    <div class="card-cover" id="cover-${game.id}">
      <div class="card-initial">${(game.name||'?')[0].toUpperCase()}</div>
      ${game.play_count > 0 ? `<span class="card-badge played">×${game.play_count}</span>` : ''}
    </div>
    <div class="card-body">
      <div class="card-name" title="${escHtml(game.name)}">${escHtml(game.name)}</div>
      <button class="card-launch">▶ JUGAR</button>
    </div>`;
  card.querySelector('.card-launch').addEventListener('click', async e => {
    e.stopPropagation();
    await api.launchGame(game.exe_path);
    toast(`Lanzando ${game.name}…`, 'success');
    setTimeout(loadGames, 1500);
  });
  card.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, game); });
  return card;
}

async function loadCardCover(gameId, coverPath) {
  const el = document.getElementById(`cover-${gameId}`);
  if (!el) return;
  const dataUri = await api.getCoverDataUri(coverPath);
  if (!dataUri) return;
  el.style.backgroundImage  = `url(${dataUri})`;
  el.style.backgroundSize   = 'cover';
  el.style.backgroundPosition = 'center';
  el.querySelector('.card-initial')?.remove();
}

// ── Búsqueda ──────────────────────────────────────────────────────────────────
function bindSearch() {
  const input = document.getElementById('search-input');
  const clear = document.getElementById('search-clear');
  input.addEventListener('input', async () => {
    const q = input.value.trim();
    clear.classList.toggle('hidden', !q);
    if (!q) { renderGrid(allGames); setCount(allGames.length); return; }
    const res = await api.searchGames(q);
    renderGrid(res); setCount(res.length, true);
  });
  clear.addEventListener('click', () => {
    input.value = ''; clear.classList.add('hidden');
    renderGrid(allGames); setCount(allGames.length);
  });
}
function setCount(n, search = false) {
  document.getElementById('game-count').textContent =
    search ? `${n} resultado${n!==1?'s':''}` : `${n} juego${n!==1?'s':''}`;
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function bindToolbar() {
  document.getElementById('btn-scan').addEventListener('click',       doScan);
  document.getElementById('btn-add-folder').addEventListener('click', doAddFolder);
  document.getElementById('btn-add-exe').addEventListener('click',    doAddExe);
}

async function doAddFolder() {
  const folder = await api.selectFolder();
  if (!folder) return;

  const prog = showScanProgress('Escaneando…');

  // 1. Escanear
  let scanResult = { results: [], mode: 'generic', steamCommon: null };
  try {
    const r = await api.scanFolder(folder);
    if (r && typeof r === 'object') scanResult = r;
  } catch (e) {
    prog.remove(); toast('Error al escanear: ' + e.message, ''); return;
  }

  const { results = [], mode = 'generic', steamCommon = null } = scanResult;
  const savePath = steamCommon || folder;

  // 2. Guardar carpeta
  updateScanProgress(prog, 'Guardando…');
  let folderRecord = null;
  try {
    const res = await api.addFolder(savePath, mode === 'steam' ? 'steam' : 'custom');
    if (res && res.folder) {
      folderRecord = res.folder;
    } else {
      // Mostrar el error real en pantalla para debug
      const errDetail = res ? (res.error || JSON.stringify(res)) : 'sin respuesta';
      prog.remove();
      toast('Error BD: ' + errDetail, '');
      return;
    }
  } catch (e) {
    prog.remove(); toast('Excepción: ' + e.message, ''); return;
  }

  // 3. Actualizar UI
  updateScanProgress(prog, 'Listo');
  await renderFolderSidebar();
  await renderSettingsView();
  prog.remove();

  if (!results.length) {
    toast('Carpeta añadida sin juegos detectados.', '');
    return;
  }

  // 4. Juegos nuevos
  let existingPaths = new Set();
  try {
    existingPaths = new Set((await api.getGames()).map(g => g.exe_path.toLowerCase()));
  } catch {}

  const newGames = results
    .filter(r => r && r.exe_path && !existingPaths.has(r.exe_path.toLowerCase()))
    .map(r => ({ name: r.name, exe_path: r.exe_path, folderId: folderRecord.id }));

  if (!newGames.length) {
    toast('Todos los juegos ya estaban añadidos.', '');
    return;
  }

  toast((mode === 'steam' ? '🎮 ' : '📂 ') + newGames.length + ' juego' + (newGames.length !== 1 ? 's' : '') + ' nuevos encontrados.', 'success');
  openPickerQueue(newGames);
}
async function doAddExe() {
  const exePath = await api.selectExe();
  if (!exePath) return;
  const defaultName = exePath.split('\\').pop().replace(/\.exe$/i, '');
  // Abrir el selector de juego de Steam
  openGamePicker(defaultName, exePath);
}

async function doScan() {
  const folders = await api.getFolders();
  if (!folders.length) { toast('Añade al menos una carpeta primero.', ''); return; }
  const prog = showScanProgress('Escaneando…');

  // Recopilar todos los juegos encontrados (solo los que NO están ya en la BD)
  const existing   = new Set((await api.getGames()).map(g => g.exe_path.toLowerCase()));
  const newGames   = [];   // { name, exe_path, folderId }

  for (const folder of folders) {
    const { results = [] } = await api.scanFolder(folder.path);
    for (const r of results) {
      if (!existing.has(r.exe_path.toLowerCase())) {
        newGames.push({ name: r.name, exe_path: r.exe_path, folderId: folder.id });
      }
    }
  }
  prog.remove();

  if (!newGames.length) {
    toast('Escaneo completado — no se encontraron juegos nuevos.', '');
    return;
  }

  // Abrir el picker en cola para cada juego nuevo encontrado
  toast(`Se encontraron ${newGames.length} juego${newGames.length!==1?'s':''} nuevos. Identifícalos uno a uno.`, 'success');
  openPickerQueue(newGames);
}

async function doDetectSteam() {
  const libs = await api.detectSteam();
  if (!libs.length) { toast('No se encontraron librerías de Steam.', ''); return; }
  const prog = showScanProgress(`Detectando Steam…`);
  let games = 0;
  for (const libPath of libs) {
    const res = await api.addFolder(libPath, 'steam');
    if (res?.folder) {
      const { results = [] } = await api.scanFolder(libPath);
      if (results.length) { await api.importResults({ games: results, folderId: res.folder.id }); games += results.length; }
    }
  }
  prog.remove();
  toast(`Steam: ${libs.length} librería(s), ${games} juegos importados.`, 'success');
  await loadGames(); await renderFolderSidebar(); await renderSettingsView();
}

function showScanProgress(msg) {
  // Eliminar cualquier progress anterior que quedara huérfano
  document.querySelectorAll('.scan-progress').forEach(e => e.remove());
  const el = document.createElement('div');
  el.className = 'scan-progress';
  el.innerHTML = '<span class="sp-spin">⟳</span><span class="sp-msg"> ' + msg + '</span>';
  document.body.appendChild(el);
  return el;
}

function updateScanProgress(el, msg) {
  const txt = el.querySelector('.sp-msg');
  if (txt) txt.textContent = ' ' + msg;
}

// ════════════════════════════════════════════════════════════════════════════════
// ── PICKER DE JUEGO — con cola para escaneo múltiple ─────────────────────────
// ════════════════════════════════════════════════════════════════════════════════

let pickerQueue        = [];   // [{ name, exe_path, folderId }, ...]
let pickerQueueIndex   = 0;
let pickerExePath      = null;
let pickerFolderId     = null;
let pickerPreviewTimer = null;

// ── Abrir picker para un solo .exe (botón + .exe) ─────────────────────────────
function openGamePicker(defaultName, exePath, folderId = null) {
  pickerQueue      = [{ name: defaultName, exe_path: exePath, folderId }];
  pickerQueueIndex = 0;
  pickerShowCurrent();
}

// ── Abrir picker en cola para múltiples juegos (escaneo) ──────────────────────
function openPickerQueue(games) {
  if (!games.length) return;
  pickerQueue      = games;
  pickerQueueIndex = 0;
  pickerShowCurrent();
}

function pickerShowCurrent() {
  const entry = pickerQueue[pickerQueueIndex];
  if (!entry) return;

  pickerExePath  = entry.exe_path;
  pickerFolderId = entry.folderId || null;

  const modal  = document.getElementById('game-picker-modal');
  const input  = document.getElementById('picker-name');
  const total  = pickerQueue.length;
  const current = pickerQueueIndex + 1;

  // Actualizar título con progreso
  const titleEl = modal.querySelector('h3');
  if (titleEl) {
    titleEl.textContent = total > 1
      ? `Identificar juego (${current} de ${total})`
      : 'Añadir juego';
  }

  // Mostrar nombre del exe como referencia
  const exeNameEl = document.getElementById('picker-exe-ref');
  if (exeNameEl) exeNameEl.textContent = entry.exe_path.split('\\').pop();

  // Limpiar estado
  input.value = entry.name;
  document.getElementById('picker-preview').classList.add('hidden');
  document.getElementById('picker-preview-img').style.backgroundImage = '';
  document.getElementById('picker-preview-status').textContent = '';

  // Botón saltar — solo visible si hay cola
  const skipBtn = document.getElementById('picker-skip');
  if (skipBtn) skipBtn.classList.toggle('hidden', total <= 1);

  // Botón saltar todo — solo si quedan más de 1
  const skipAllBtn = document.getElementById('picker-skip-all');
  if (skipAllBtn) skipAllBtn.classList.toggle('hidden', total - current < 1);

  modal.classList.remove('hidden');

  // Auto-buscar portada con el nombre detectado
  clearTimeout(pickerPreviewTimer);
  pickerPreviewTimer = setTimeout(() => pickerFetchPreview(entry.name), 400);

  setTimeout(() => { input.focus(); input.select(); }, 80);
}

function closeGamePicker() {
  document.getElementById('game-picker-modal').classList.add('hidden');
  clearTimeout(pickerPreviewTimer);
  pickerQueue      = [];
  pickerQueueIndex = 0;
  pickerExePath    = null;
  pickerFolderId   = null;
}

// Saltar este juego (añadir sin nombre/portada personalizada)
async function pickerSkip() {
  const entry = pickerQueue[pickerQueueIndex];
  if (entry) {
    // Guardar con el nombre por defecto del exe, sin portada
    await api.addGame({ name: entry.name, exe_path: entry.exe_path, folder_id: entry.folderId });
  }
  pickerNext();
}

// Saltar todos los restantes (añadir todos con nombre de exe, sin portada)
async function pickerSkipAll() {
  for (let i = pickerQueueIndex; i < pickerQueue.length; i++) {
    const e = pickerQueue[i];
    await api.addGame({ name: e.name, exe_path: e.exe_path, folder_id: e.folderId });
  }
  closeGamePicker();
  await loadGames();
  toast('Juegos restantes añadidos sin identificar.', '');
}

function pickerNext() {
  pickerQueueIndex++;
  if (pickerQueueIndex >= pickerQueue.length) {
    closeGamePicker();
    loadGames();
    toast('Todos los juegos identificados.', 'success');
  } else {
    pickerShowCurrent();
  }
}

// Preview automático mientras escribe
function pickerOnNameInput() {
  clearTimeout(pickerPreviewTimer);
  const name = document.getElementById('picker-name').value.trim();
  if (!name) { document.getElementById('picker-preview').classList.add('hidden'); return; }
  pickerPreviewTimer = setTimeout(() => pickerFetchPreview(name), 700);
}

async function pickerFetchPreview(name) {
  const preview  = document.getElementById('picker-preview');
  const imgEl    = document.getElementById('picker-preview-img');
  const statusEl = document.getElementById('picker-preview-status');

  preview.classList.remove('hidden');
  imgEl.style.backgroundImage = '';
  statusEl.textContent = '⟳ Buscando portada…';
  statusEl.className   = 'picker-preview-status loading';

  const coverPath = await api.fetchCoverByName(name);
  if (!coverPath) {
    statusEl.textContent = '✗ No se encontró portada. Se añadirá sin imagen.';
    statusEl.className   = 'picker-preview-status error';
    return;
  }
  const dataUri = await api.getCoverDataUri(coverPath);
  if (dataUri) {
    imgEl.style.backgroundImage = `url(${dataUri})`;
    statusEl.textContent = '✓ Portada encontrada';
    statusEl.className   = 'picker-preview-status ok';
  }
}

async function pickerConfirm() {
  if (!pickerExePath) return;
  const name = document.getElementById('picker-name').value.trim();
  if (!name) { document.getElementById('picker-name').focus(); return; }

  const btn = document.getElementById('picker-confirm');
  btn.disabled    = true;
  btn.textContent = '⟳ Añadiendo…';

  const coverPath = await api.fetchCoverByName(name);
  await api.addGame({ name, exe_path: pickerExePath, folder_id: pickerFolderId, cover: coverPath });

  btn.disabled    = false;
  btn.textContent = '✓ Añadir juego';

  pickerNext();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('game-picker-modal')?.addEventListener('click', e => {
    if (e.target.id === 'game-picker-modal') closeGamePicker();
  });
});

// ── Sidebar carpetas ──────────────────────────────────────────────────────────
async function renderFolderSidebar() {
  try {
    const list = document.getElementById('folder-list-sidebar');
    if (!list) return;
    list.innerHTML = '';
    const folders = await api.getFolders();
    (folders || []).forEach(f => {
      const dot = document.createElement('div');
      dot.className = 'sidebar-folder-dot';
      dot.innerHTML = `${f.type==='steam'?'🎮':'📁'}<span class="folder-tooltip">${escHtml(f.label||f.path)}</span>`;
      list.appendChild(dot);
    });
  } catch(e) { console.error('renderFolderSidebar:', e); }
}

// ── Recientes / Favoritos ─────────────────────────────────────────────────────
function renderRecent() {
  const grid = document.getElementById('recent-grid');
  grid.innerHTML = '';
  const items = [...allGames].filter(g => g.last_played)
    .sort((a,b) => new Date(b.last_played)-new Date(a.last_played)).slice(0,20);
  if (!items.length) { grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">◷</div><p>Aún no has jugado a nada.</p></div>`; return; }
  items.forEach(g => grid.appendChild(buildCard(g)));
  items.forEach(g => { if (g.cover) loadCardCover(g.id, g.cover); });
}
function renderFavorites() {
  const grid = document.getElementById('fav-grid');
  grid.innerHTML = '';
  const items = allGames.filter(g => g.play_count >= 3).sort((a,b) => b.play_count-a.play_count);
  if (!items.length) { grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">♥</div><p>Juega 3+ veces para ver favoritos.</p></div>`; return; }
  items.forEach(g => grid.appendChild(buildCard(g)));
  items.forEach(g => { if (g.cover) loadCardCover(g.id, g.cover); });
}

// ── Ajustes ───────────────────────────────────────────────────────────────────
async function renderSettingsView() {
  try {
  const el = document.getElementById('settings-content');
  if (!el) return;
  const folders   = await api.getFolders();
  const accents   = ['#e84855','#ff6b35','#00d4aa','#3b82f6','#a855f7','#f59e0b','#10b981'];
  const curAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const autoScan  = await api.getSetting('autoscan_on_start') === '1';
  const adminScan = await api.getSetting('autoscan_admin')    === '1';

  el.innerHTML = `
    <div class="settings-section">
      <h3>Apariencia</h3>
      <div class="setting-row">
        <div class="setting-label">Color de acento</div>
        <div class="color-swatches">
          ${accents.map(c=>`<div class="swatch ${c===curAccent?'active':''}" style="background:${c}" data-color="${c}" onclick="setAccent('${c}')"></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="settings-section">
      <h3>Comportamiento</h3>
      <div class="setting-row">
        <div><div class="setting-label">Auto-búsqueda al iniciar</div><div class="setting-sub">Escanea carpetas en cada arranque</div></div>
        <div class="toggle-switch ${autoScan?'on':''}" id="set-toggle-autoscan" onclick="toggleSetting('autoscan_on_start','set-toggle-autoscan')"><div class="toggle-knob"></div></div>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">Pedir permisos de administrador</div><div class="setting-sub">Para acceder a todas las carpetas</div></div>
        <div class="toggle-switch ${adminScan?'on':''}" id="set-toggle-admin" onclick="toggleSetting('autoscan_admin','set-toggle-admin')"><div class="toggle-knob"></div></div>
      </div>
    </div>
    <div class="settings-section">
      <h3>Carpetas de juegos</h3>
      ${!folders.length
        ? `<p style="color:var(--subtext);font-size:12px;font-family:var(--font-mono)">Sin carpetas.</p>`
        : folders.map(f=>`<div class="folder-item-row">
            <span>${f.type==='steam'?'🎮':'📁'}</span>
            <span class="folder-path" title="${escHtml(f.path)}">${escHtml(f.path)}</span>
            <button class="btn-danger" onclick="removeFolder(${f.id})">✕</button>
          </div>`).join('')}
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-secondary" onclick="doAddFolder()">+ Añadir carpeta</button>
        <button class="btn-icon"      onclick="doScan()">↻ Re-escanear</button>
        <button class="btn-secondary" onclick="doDetectSteam()">🎮 Detectar Steam</button>
      </div>
    </div>
    <div class="settings-section">
      <h3>Base de datos</h3>
      <div class="setting-row"><div class="setting-label">Total de juegos</div><strong style="font-family:var(--font-mono);color:var(--accent)">${allGames.length}</strong></div>
      <div class="setting-row"><div class="setting-label">Carpetas indexadas</div><strong style="font-family:var(--font-mono);color:var(--accent)">${folders.length}</strong></div>
      <div style="margin-top:12px"><button class="btn-secondary" onclick="rerunWizard()" style="font-size:11px">↺ Volver a ejecutar el asistente</button></div>
    </div>`;
  } catch(e) { console.error('renderSettingsView:', e); }
}

async function removeFolder(id) {
  await api.removeFolder(id);
  toast('Carpeta eliminada.', '');
  await renderFolderSidebar(); await renderSettingsView();
}
async function toggleSetting(key, toggleId) {
  const el  = document.getElementById(toggleId);
  const isOn = !el.classList.contains('on');
  el.classList.toggle('on', isOn);
  await api.setSetting(key, isOn ? '1' : '0');
}
async function rerunWizard() { await api.setSetting('setup_done','0'); showWizard(); }

// ── Context menu ──────────────────────────────────────────────────────────────
function bindContextMenu() {
  const menu = document.getElementById('ctx-menu');
  document.getElementById('ctx-launch').addEventListener('click', async () => {
    if (!ctxGame) return;
    await api.launchGame(ctxGame.exe_path);
    toast(`Lanzando ${ctxGame.name}…`, 'success');
    menu.classList.add('hidden'); setTimeout(loadGames, 1500);
  });
  document.getElementById('ctx-folder').addEventListener('click', async () => {
    if (!ctxGame) return; await api.openFolder(ctxGame.exe_path); menu.classList.add('hidden');
  });
  document.getElementById('ctx-rename').addEventListener('click', () => {
    if (!ctxGame) return; menu.classList.add('hidden'); openRename(ctxGame);
  });
  document.getElementById('ctx-remove').addEventListener('click', async () => {
    if (!ctxGame) return;
    await api.removeGame(ctxGame.id); toast(`${ctxGame.name} eliminado.`, '');
    menu.classList.add('hidden'); await loadGames();
  });
  document.addEventListener('click', () => menu.classList.add('hidden'));
  document.addEventListener('keydown', e => { if (e.key==='Escape') { menu.classList.add('hidden'); closeGamePicker(); } });
}
function showCtxMenu(e, game) {
  ctxGame = game;
  const menu = document.getElementById('ctx-menu');
  menu.style.left = `${e.clientX}px`; menu.style.top = `${e.clientY}px`;
  menu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right  > window.innerWidth)  menu.style.left = `${e.clientX - r.width}px`;
    if (r.bottom > window.innerHeight) menu.style.top  = `${e.clientY - r.height}px`;
  });
}

// ── Renombrar ─────────────────────────────────────────────────────────────────
function openRename(game) {
  renameGame = game;
  document.getElementById('rename-input').value = game.name;
  document.getElementById('rename-modal').classList.remove('hidden');
  setTimeout(() => { document.getElementById('rename-input').focus(); }, 50);
}
function closeRename() { document.getElementById('rename-modal').classList.add('hidden'); renameGame = null; }
async function confirmRename() {
  if (!renameGame) return;
  const name = document.getElementById('rename-input').value.trim();
  if (!name) return;
  await api.updateGameName(renameGame.id, name);
  toast(`Renombrado a "${name}".`, 'success'); closeRename(); await loadGames();
}
document.getElementById('rename-input')?.addEventListener('keydown', e => {
  if (e.key==='Enter') confirmRename(); if (e.key==='Escape') closeRename();
});

// ════════════════════════════════════════════════════════════════════════════════
// ── WIZARD ───────────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════════
function showWizard() {
  document.getElementById('first-run-overlay').classList.remove('hidden');
  wizardBuildDots(); wizardBuildPaths(); wizardBuildAccentGrid(); frGoStep(1);
}

function wizardBuildDots() {
  const box = document.getElementById('first-run-box');
  let bar = document.getElementById('fr-progress-bar');
  if (!bar) {
    bar = document.createElement('div'); bar.id='fr-progress-bar'; bar.className='fr-progress';
    for (let i=1; i<=5; i++) { const d=document.createElement('div'); d.className='fr-dot'; d.id=`fr-dot-${i}`; bar.appendChild(d); }
    box.insertBefore(bar, box.firstChild);
  }
}
function wizardUpdateDots(step) {
  for (let i=1; i<=5; i++) {
    const d = document.getElementById(`fr-dot-${i}`); if (!d) continue;
    d.className = 'fr-dot';
    if (i < step) d.classList.add('done'); if (i===step && step<=5) d.classList.add('active');
  }
}

function wizardBuildPaths() {
  const list = document.getElementById('fr-common-paths');
  list.innerHTML = '';
  function renderList() {
    list.innerHTML = '';
    for (const entry of FR_COMMON_PATHS) {
      const sel  = frSelectedPaths.has(entry.path);
      const item = document.createElement('div');
      item.className = `fr-check-item${sel?' selected':''}`;
      item.innerHTML = `
        <div class="fr-check-icon">${sel?'✓':''}</div>
        <span class="fr-check-label" title="${escHtml(entry.path)}">${escHtml(entry.label)}</span>
        ${entry.autodetected?'<span class="fr-check-exists">✓ detectado</span>':''}`;
      item.addEventListener('click', () => {
        frSelectedPaths.has(entry.path) ? frSelectedPaths.delete(entry.path) : frSelectedPaths.add(entry.path);
        renderList();
      });
      list.appendChild(item);
    }
    const btn = document.createElement('button');
    btn.className='btn-secondary'; btn.style.cssText='margin-top:6px;font-size:11px;padding:5px 12px;width:100%';
    btn.textContent='+ Añadir carpeta personalizada';
    btn.addEventListener('click', async () => {
      const p = await api.selectFolder();
      if (p && !FR_COMMON_PATHS.find(e => e.path===p)) {
        FR_COMMON_PATHS.push({ label:p, path:p }); frSelectedPaths.add(p); renderList();
      }
    });
    list.appendChild(btn);
  }
  api.detectSteam().then(steamPaths => {
    for (const sp of steamPaths) {
      if (!FR_COMMON_PATHS.find(p => p.path.toLowerCase()===sp.toLowerCase()))
        FR_COMMON_PATHS.unshift({ label:`Steam detectado: ${sp}`, path:sp, autodetected:true });
      frSelectedPaths.add(sp);
    }
    renderList();
  }).catch(() => renderList());
}

function frToggleAutoscan() { frAutoScan=!frAutoScan; document.getElementById('fr-toggle-autoscan').classList.toggle('on',frAutoScan); }
function frToggleAdmin()    { frAdminScan=!frAdminScan; document.getElementById('fr-toggle-admin').classList.toggle('on',frAdminScan); }

function wizardBuildAccentGrid() {
  const grid = document.getElementById('fr-accent-grid'); if (!grid) return; grid.innerHTML='';
  for (const color of FR_ACCENTS) {
    const sw = document.createElement('div');
    sw.className=`fr-swatch${color===frSelectedAccent?' active':''}`; sw.style.background=color; sw.title=color;
    sw.addEventListener('click', () => {
      frSelectedAccent=color; grid.querySelectorAll('.fr-swatch').forEach(s=>s.classList.remove('active')); sw.classList.add('active');
      setAccent(color,false); const pk=document.getElementById('fr-custom-color'); if(pk) pk.value=color;
    });
    grid.appendChild(sw);
  }
}
function frPickCustomColor(color) { frSelectedAccent=color; document.querySelectorAll('.fr-swatch').forEach(s=>s.classList.remove('active')); setAccent(color,false); }
async function frSaveExtras() {
  if (window._frCustomSettings)
    for (const [k,v] of Object.entries(window._frCustomSettings)) await api.setSetting(k,v);
  // ── ZONA DE GUARDADO PERSONALIZADO ───────────────────────────────────────
  // const val = document.getElementById('fr-input-NOMBRE')?.value;
  // if (val) await api.setSetting('mi_clave', val);
}
function frToggleCustom(toggleId, settingKey) {
  const el=document.getElementById(`fr-toggle-${toggleId}`); const isOn=!el.classList.contains('on');
  el.classList.toggle('on',isOn); if(!window._frCustomSettings) window._frCustomSettings={};
  window._frCustomSettings[settingKey]=isOn?'1':'0';
}

function frGoStep(n) {
  document.querySelectorAll('.fr-step').forEach((s,i)=>s.classList.toggle('active',i+1===n)); wizardUpdateDots(n);
}

// ── frScan: con timeout por carpeta y skip de rutas inexistentes ──────────────
async function frScan() {
  await api.setSetting('accent',            frSelectedAccent);
  await api.setSetting('autoscan_on_start', frAutoScan  ? '1' : '0');
  await api.setSetting('autoscan_admin',    frAdminScan ? '1' : '0');
  await frSaveExtras();
  setAccent(frSelectedAccent);

  frGoStep(6);
  let total = 0;
  const paths = Array.from(frSelectedPaths);
  const statusEl = document.getElementById('fr-scan-status');

  for (const folderPath of paths) {
    if (statusEl) statusEl.textContent = `Escaneando: …${folderPath.split('\\').slice(-2).join('\\')}`;

    // Timeout de 12s por carpeta — evita el cuelgue infinito
    const scanPromise = (async () => {
      const res = await api.addFolder(folderPath, 'custom');
      if (!res?.folder) return 0;
      const { results = [] } = await api.scanFolder(folderPath);
      if (results.length) await api.importResults({ games: results, folderId: res.folder.id });
      return results.length;
    })();

    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(0), 12000));
    total += await Promise.race([scanPromise, timeoutPromise]);
  }

  const countEl = document.getElementById('fr-count');
  if (countEl) countEl.textContent = total;
  await api.setSetting('setup_done', '1');
  frGoStep(7);
}

async function frFinish() {
  document.getElementById('first-run-overlay').classList.add('hidden');
  await loadGames(); await renderFolderSidebar(); await renderSettingsView();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type='') {
  const el=document.getElementById('toast'); el.textContent=msg;
  el.className=type?`show ${type}`:'show'; clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{el.className='';},3000);
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
