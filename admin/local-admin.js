/* ====== Локальная админка + автосинк на Railway ======
 * Что делает:
 * - простая авторизация (username + SHA-256("username:password:pepper"))
 * - чтение каталога из /data/*.json (как прежде)
 * - при каждом изменении отправляет POST на Railway:
 *      POST {baseUrl}/commit      (если 404 — пробует {baseUrl}/push)
 *   Бэкенд коммитит и пушит в репо каталога.
 *
 * Заполни в CONFIG.sync:
 *   baseUrl: 'https://<твой-домен>.up.railway.app'
 *   apiKey : '<тот же API_KEY, что в переменных Railway>'
 * И всё.
 */

const CONFIG = {
  // --- логин/пароль (пароль хранится как хэш) ---
  username: 'forfriends',
  passHash: 'a841ff9a9a6d1ccc1549f1acded578a2b37cf31813cd0a594ca1f1833b09d09d', // SHA-256 от "username:password:pepper"
  pepper:   'ForFriends#Pepper-2025',
  tokenKey: 'ff_admin_token',
  tokenTtlHours: 12,

  // --- пути чтения (каталог берёт отсюда) ---
  paths: {
    cats: '../data/categories.json',
    prods: '../data/products.json',
  },

  // --- куда слать изменения ---
  sync: {
    baseUrl: 'https://forfriends-sync-production.up.railway.app', // <-- ВПИШИ СВОЙ ДОМЕН Railway
    apiKey : '056fad75ad5e57d293e57739ec70ceb3fba4967d1cd9d2fa64a9be15dbf95c20',                                          // <-- ВПИШИ СВОЙ API_KEY из Railway
    timeoutMs: 20000,
    debounceMs: 700
  },
};

/* ===================== Утилиты ===================== */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function sha256(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#039;' }[m]))}
function escapeAttr(s){return String(s).replace(/"/g,'&quot;')}
function fmtPrice(n){const x=Number(n||0);return x.toLocaleString('ru-RU')}

function ensureDebugBox(){
  let box = $('#debugBox');
  if (!box){
    box = document.createElement('pre');
    box.id = 'debugBox';
    box.style.cssText = 'margin-top:12px;padding:10px;background:#0c0e12;border:1px solid #2b2f3a;border-radius:8px;max-height:220px;overflow:auto;color:#aab4c0;font:12px/1.4 ui-monospace,Consolas';
    const host = $('#app') || document.body;
    host.appendChild(box);
  }
  return box;
}
function debug(msg){
  const box = ensureDebugBox();
  const t = new Date().toLocaleTimeString();
  box.textContent = `[${t}] ${msg}\n` + box.textContent;
}

function endpoint(base, path){ return base.replace(/\/+$/,'') + path; }
async function readBody(res){ try{ return await res.text(); } catch{ return ''; }}

/* ===================== Авторизация ===================== */
function setToken(hours=CONFIG.tokenTtlHours){
  const t = { iat: Date.now(), exp: Date.now()+hours*3600*1000 };
  localStorage.setItem(CONFIG.tokenKey, JSON.stringify(t));
}
function hasToken(){
  try{
    const raw = localStorage.getItem(CONFIG.tokenKey);
    if (!raw) return false;
    const t = JSON.parse(raw);
    return Date.now() < t.exp;
  }catch{ return false; }
}
function clearToken(){ localStorage.removeItem(CONFIG.tokenKey); }

async function verifyLogin(login, pass){
  const base = `${login}:${pass}:${CONFIG.pepper}`;
  const hash = await sha256(base);
  return login === CONFIG.username && hash === CONFIG.passHash;
}

/* ===================== Данные ===================== */
const state = {
  cats:  [],
  prods: [],
  editId: null,
};

async function safeLoadJson(url){
  try{
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return Array.isArray(j?.items) ? j.items : [];
  }catch(e){
    debug(`Не удалось загрузить ${url}: ${e.message}`);
    return [];
  }
}

async function loadAll(){
  $('#statusText') && ($('#statusText').textContent = 'Загрузка данных…');
  const [cats, prods] = await Promise.all([
    safeLoadJson(CONFIG.paths.cats),
    safeLoadJson(CONFIG.paths.prods),
  ]);
  state.cats  = cats;
  state.prods = prods;
  renderCats();
  renderProdFormOptions();
  renderProds();
  $('#statusText') && ($('#statusText').textContent = `Категорий: ${state.cats.length} • Товаров: ${state.prods.length}`);
}

/* ===================== Синк на Railway ===================== */
const SYNC_ENABLED = Boolean(CONFIG.sync?.baseUrl && CONFIG.sync?.apiKey);

let syncTimer = null;
let syncing   = false;

function scheduleSync(kind){
  if (!SYNC_ENABLED) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(()=> doSync(kind).catch(err=>{
    console.error(err);
    debug(`✗ Синк не удался (${kind}): ${err.message}`);
  }), CONFIG.sync.debounceMs);
}

async function doSync(kind){
  if (!SYNC_ENABLED) return;
  if (syncing) return;
  syncing = true;

  const payload = {
    kind,
    categories: { items: state.cats },
    products:   { items: state.prods },
    meta: { ts: Date.now(), from: 'admin-local' }
  };

  debug(`→ Синхронизация (${kind})…`);

  // 1) пробуем /commit
  let url = endpoint(CONFIG.sync.baseUrl, '/push');
  let ctl = new AbortController();
  let timer = setTimeout(()=>ctl.abort(), CONFIG.sync.timeoutMs);
  let res;
  try{
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'x-api-key': CONFIG.sync.apiKey
      },
      body: JSON.stringify(payload),
      signal: ctl.signal
    });
  }catch(e){
    clearTimeout(timer);
    throw new Error('Network error (/commit): '+e.message);
  }
  clearTimeout(timer);

  // 2) если /commit нет — пробуем /push
  if (res.status === 404){
    debug('Эндпоинт /commit не найден, пробую /push…');
    url = endpoint(CONFIG.sync.baseUrl, '/push');
    ctl = new AbortController();
    timer = setTimeout(()=>ctl.abort(), CONFIG.sync.timeoutMs);
    try{
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'x-api-key': CONFIG.sync.apiKey
        },
        body: JSON.stringify({
          categories: { items: state.cats },
          products:   { items: state.prods },
          meta: { ts: Date.now(), from: 'admin-local' }
        }),
        signal: ctl.signal
      });
    }catch(e){
      clearTimeout(timer);
      throw new Error('Network error (/push): '+e.message);
    }
    clearTimeout(timer);
  }

  if (!res.ok){
    const t = await readBody(res);
    throw new Error(`HTTP ${res.status}: ${t || 'unknown error'}`);
  }

  const t = await readBody(res);
  debug(`✓ Синхронизировано (${kind}). ${t ? t.slice(0,200) : ''}`);
  syncing = false;
}

/* ===================== Рендер ===================== */
function renderCats(){
  const box = $('#catList');
  box.innerHTML = '';
  if (!state.cats.length){
    box.innerHTML = `<div class="empty">Пока нет категорий.</div>`;
    return;
  }
  state.cats.forEach((c, idx)=>{
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div class="muted">#${idx+1}</div>
      <div>${escapeHtml(c.title||'—')}</div>
      <div><button class="btn secondary" data-act="del">Удалить</button></div>
    `;
    row.querySelector('[data-act="del"]').onclick = ()=>{
      if (confirm(`Удалить категорию «${c.title}»?`)){
        state.cats.splice(idx,1);
        renderCats();
        renderProdFormOptions();
        scheduleSync('delete-category');
      }
    };
    box.appendChild(row);
  });
}

function renderProdFormOptions(){
  const sel = $('#p_cat');
  if (!sel) return;
  sel.innerHTML = '';
  state.cats.forEach(c=>{
    const o = document.createElement('option');
    o.value = c.title;
    o.textContent = c.title;
    sel.appendChild(o);
  });
}

function renderProds(){
  const box = $('#prodList');
  box.innerHTML = '';
  if (!state.prods.length){
    box.innerHTML = `<div class="empty">Пока нет товаров.</div>`;
    return;
  }
  state.prods.forEach((p, idx)=>{
    const row = document.createElement('div');
    row.className = 'item';
    const photo = (p.photo||'').trim();
    row.innerHTML = `
      <img src="${escapeAttr(photo)}" onerror="this.src='https://placehold.co/160x120?text=%D0%A4%D0%BE%D1%82%D0%BE'">
      <div>
        <div><strong>${escapeHtml(p.title||'—')}</strong></div>
        <div class="muted">${escapeHtml(p.category||'—')} • ${fmtPrice(p.price)} ₽ • ${escapeHtml(p.id||'')}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn secondary" data-act="edit">Править</button>
        <button class="btn red" data-act="del">Удалить</button>
      </div>
    `;
    row.querySelector('[data-act="edit"]').onclick = ()=>{
      fillProdForm(p);
      state.editId = p.id;
    };
    row.querySelector('[data-act="del"]').onclick = ()=>{
      if (confirm(`Удалить товар «${p.title}»?`)){
        state.prods.splice(idx,1);
        renderProds();
        scheduleSync('delete-product');
      }
    };
    box.appendChild(row);
  });
}

function fillProdForm(p){
  $('#p_id').value    = p.id||'';
  $('#p_title').value = p.title||'';
  $('#p_price').value = p.price||'';
  $('#p_cat').value   = p.category||'';
  $('#p_photo').value = p.photo||'';
  $('#p_link').value  = p.link||'';
  $('#p_desc').value  = p.desc||'';
}
function clearProdForm(){
  state.editId = null;
  $('#p_id').value = $('#p_title').value = $('#p_price').value =
  $('#p_photo').value = $('#p_link').value = $('#p_desc').value = '';
  const cat = $('#p_cat'); if (cat && cat.options.length) cat.selectedIndex = 0;
}
function collectProdFromForm(){
  return {
    id:       $('#p_id').value.trim(),
    title:    $('#p_title').value.trim(),
    price:    Number($('#p_price').value||0),
    category: $('#p_cat').value.trim(),
    photo:    $('#p_photo').value.trim(),
    link:     $('#p_link').value.trim(),
    desc:     $('#p_desc').value.trim(),
  };
}
function validateProd(p){
  if (!p.id) return 'Укажите ID';
  if (!p.title) return 'Укажите название';
  if (!p.category) return 'Выберите категорию';
  if (Number.isNaN(p.price) || p.price < 0) return 'Цена некорректна';
  return null;
}

function switchTab(name){
  $$('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  $('#tab-cats' ).classList.toggle('hide', name!=='cats');
  $('#tab-goods').classList.toggle('hide', name!=='goods');
  $('#tab-io'   ).classList.toggle('hide', name!=='io');
}

/* ===================== Инициализация ===================== */
async function boot(){
  // вкладки
  $$('.tab').forEach(b=> b.onclick = ()=> switchTab(b.dataset.tab));

  // кнопки
  $('#logoutBtn').onclick = ()=>{ clearToken(); location.reload(); };

  $('#addCatBtn').onclick = ()=>{
    const t = $('#catTitle').value.trim();
    if (!t) return;
    state.cats.push({ title: t });
    $('#catTitle').value = '';
    renderCats();
    renderProdFormOptions();
    scheduleSync('add-category');
  };

  $('#saveProdBtn').onclick = ()=>{
    const p = collectProdFromForm();
    const err = validateProd(p);
    if (err) return alert(err);

    const i = state.prods.findIndex(x=>x.id===state.editId);
    if (i>=0) state.prods[i] = p; else state.prods.push(p);
    clearProdForm();
    renderProds();
    scheduleSync('save-product');
  };
  $('#resetProdBtn').onclick = clearProdForm;

  // импорт из файлов
  $('#fileCats').addEventListener('change', async e=>{
    const f = e.target.files[0]; if (!f) return;
    const j = JSON.parse(await f.text());
    state.cats = Array.isArray(j?.items) ? j.items : [];
    renderCats(); renderProdFormOptions();
    debug('Импортированы categories.json из файла');
    scheduleSync('import-categories');
  });
  $('#fileProds').addEventListener('change', async e=>{
    const f = e.target.files[0]; if (!f) return;
    const j = JSON.parse(await f.text());
    state.prods = Array.isArray(j?.items) ? j.items : [];
    renderProds();
    debug('Импортированы products.json из файла');
    scheduleSync('import-products');
  });

  // ручной триггер (если есть кнопка)
  const manual = $('#syncNowBtn');
  if (manual) manual.onclick = ()=> doSync('manual').catch(e=>{ console.error(e); alert('Синк не удался. См. консоль.'); });

  // авторизация
  if (hasToken()){
    $('#loginCard').classList.add('hide');
    $('#app').classList.remove('hide');
    await loadAll();
  }else{
    $('#loginCard').classList.remove('hide');
    $('#app').classList.add('hide');
    bindLoginForm();
  }

  if (!SYNC_ENABLED){
    debug('⚠ Синхронизация отключена: укажи CONFIG.sync.baseUrl и CONFIG.sync.apiKey.');
  }else{
    debug('✓ Синк включён. Изменения будут коммититься в репозиторий.');
  }
}

function bindLoginForm(){
  const form = $('#loginForm');
  const err  = $('#loginErr');
  form.onsubmit = async (e)=>{
    e.preventDefault();
    err.classList.add('hide');
    const ok = await verifyLogin($('#login').value.trim(), $('#password').value);
    if (!ok){ err.classList.remove('hide'); return; }
    setToken();
    location.reload();
  };
}

boot().catch(e=>{
  console.error(e);
  alert('Ошибка запуска админки. См. консоль.');
});
