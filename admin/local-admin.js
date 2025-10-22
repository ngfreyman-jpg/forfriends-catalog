/* ====== Локальная авторизация + простая админка (с авто-синком) ======
 * 1) Логин локально по username + SHA-256("username:password:pepper").
 * 2) Любые изменения категорий/товаров отправляются на sync-сервис,
 *    который коммитит в репозиторий каталога (Railway).
 * 3) Импорт/экспорт JSON в файл остаются.
 */

const CONFIG = {
  // --- Логин ---
  username:  'forfriends',
  passHash:  'a841ff9a9a6d1ccc1549f1acded578a2b37cf31813cd0a594ca1f1833b09d09d', // SHA-256 от "username:password:pepper"
  pepper:    'ForFriends#Pepper-2025',
  tokenKey:  'ff_admin_token',
  tokenTtlHours: 12,

  // --- Автосинк на Railway ---
  sync: {
    baseUrl: 'https://forfriends-sync-production.up.railway.app', // домен твоего Railway-сервиса
    apiKey:  '056fad75ad5e57d293e57739ec70ceb3fba4967d1cd9d2fa64a9be15dbf95c20', // тот же, что в переменной API_KEY на Railway
    auto: true,
    timeoutMs: 20000,
    debounceMs: 750
  },

  // --- Пути, откуда каталог читает данные ---
  paths: {
    cats:  '../data/categories.json',
    prods: '../data/products.json'
  }
};

// ========== Утилиты ==========
const $  = s => document.querySelector(s);
const $$ = (s,root=document) => Array.from(root.querySelectorAll(s));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const toBlobURL = (obj, name) => {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

async function sha256(str){
  const enc = new TextEncoder().encode(str);
  const h = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]))}
function escapeAttr(s){return String(s).replace(/"/g,'&quot;')}
function fmtPrice(n){const x=Number(n||0);return x.toLocaleString('ru-RU')}

function debug(msg){
  const box = $('#debugBox'); if (!box) return;
  const t = new Date().toLocaleTimeString();
  box.textContent = `[${t}] ${msg}\n` + box.textContent;
}

// ========== Авторизация ==========
function setToken(hours=CONFIG.tokenTtlHours){
  const t = { iat: Date.now(), exp: Date.now() + hours*3600*1000 };
  localStorage.setItem(CONFIG.tokenKey, JSON.stringify(t));
}
function hasToken(){
  try {
    const raw = localStorage.getItem(CONFIG.tokenKey);
    if (!raw) return false;
    const t = JSON.parse(raw);
    return Date.now() < t.exp;
  } catch { return false; }
}
function clearToken(){ localStorage.removeItem(CONFIG.tokenKey); }

async function verifyLogin(login, pass){
  const base = `${login}:${pass}:${CONFIG.pepper}`;
  const hash = await sha256(base);
  return login === CONFIG.username && hash === CONFIG.passHash;
}

// ========== Данные ==========
const state = {
  cats: [],
  prods: [],
  editId: null, // id товара, который правим
};

async function safeLoadJson(url){
  try{
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    return Array.isArray(data?.items) ? data.items : [];
  }catch(e){
    debug(`Не удалось загрузить ${url}: ${e.message}`);
    return [];
  }
}

async function loadAll(){
  $('#statusText').textContent = 'Загрузка данных…';
  const [cats, prods] = await Promise.all([
    safeLoadJson(CONFIG.paths.cats),
    safeLoadJson(CONFIG.paths.prods)
  ]);
  state.cats  = cats;
  state.prods = prods;
  renderCats();
  renderProdFormOptions();
  renderProds();
  $('#statusText').textContent = `Категорий: ${state.cats.length} • Товаров: ${state.prods.length}`;
}

// ========== Синхронизация (Railway) ==========
const SYNC_ENABLED = Boolean(
  CONFIG.sync && CONFIG.sync.auto && CONFIG.sync.baseUrl && CONFIG.sync.apiKey
);

let syncTimer = null;
let syncing = false;
const dirty = { cats:false, prods:false };

function markDirty(kind){
  dirty[kind] = true;
  if (!SYNC_ENABLED) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(()=>runSync().catch(err=>{
    console.error(err);
    debug(`Синхронизация не удалась: ${err.message||err}`);
  }), CONFIG.sync.debounceMs);
}

async function runSync(){
  if (!SYNC_ENABLED) return;
  if (syncing) return;
  const tasks = [];
  if (dirty.cats)  tasks.push(pushCats());
  if (dirty.prods) tasks.push(pushProds());
  if (!tasks.length) return;

  syncing = true;
  debug('Синхронизация…');
  try{
    await Promise.all(tasks);
    dirty.cats = dirty.prods = false;
    debug('✓ Изменения отправлены в репозиторий.');
  }finally{
    syncing = false;
  }
}

async function pushCats(){  return postCommit({ kind:'cats',  items: state.cats  }); }
async function pushProds(){ return postCommit({ kind:'prods', items: state.prods }); }

async function postCommit(payload){
  const url = CONFIG.sync.baseUrl.replace(/\/+$/,'') + '/commit';
  const ctrl = new AbortController();
  const to   = setTimeout(()=>ctrl.abort(), CONFIG.sync.timeoutMs);
  const res  = await fetch(url, {
    method: 'POST',
    signal: ctrl.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CONFIG.sync.apiKey
    },
    body: JSON.stringify(payload)
  }).catch(err => { throw new Error('Network: '+err.message); });
  clearTimeout(to);

  if (!res.ok){
    const text = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status} ${text}`);
  }
  // можно прочитать ответ, если нужно: const data = await res.json().catch(()=>null);
}

// ========== Рендер / UI ==========
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
        markDirty('cats');
      }
    };
    box.appendChild(row);
  });
}

function renderProdFormOptions(){
  const sel = $('#p_cat');
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
    const photo = (p.photo&&p.photo.trim())||'';
    row.innerHTML = `
      <img src="${escapeAttr(photo)||''}" onerror="this.src='https://placehold.co/160x120?text=%D0%A4%D0%BE%D1%82%D0%BE'">
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
        markDirty('prods');
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
  $('#p_id').value    = '';
  $('#p_title').value = '';
  $('#p_price').value = '';
  $('#p_photo').value = '';
  $('#p_link').value  = '';
  $('#p_desc').value  = '';
  const cat = $('#p_cat'); if (cat.options.length) cat.selectedIndex = 0;
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
  $('#tab-cats').classList.toggle('hide',  name!=='cats');
  $('#tab-goods').classList.toggle('hide', name!=='goods');
  $('#tab-io').classList.toggle('hide',    name!=='io');
}

// ========== Инициализация ==========
async function boot(){
  // вкладки
  $$('.tab').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));

  // кнопки
  $('#logoutBtn').onclick = ()=>{ clearToken(); location.reload(); };

  $('#addCatBtn').onclick = ()=>{
    const t = $('#catTitle').value.trim();
    if (!t) return;
    state.cats.push({ title:t });
    $('#catTitle').value = '';
    renderCats();
    renderProdFormOptions();
    markDirty('cats');
  };

  $('#saveProdBtn').onclick = ()=>{
    const p = collectProdFromForm();
    const err = validateProd(p);
    if (err) return alert(err);
    const idx = state.prods.findIndex(x=>x.id===state.editId);
    if (idx >= 0) state.prods[idx] = p; else state.prods.push(p);
    clearProdForm();
    renderProds();
    markDirty('prods');
  };

  $('#resetProdBtn').onclick = clearProdForm;

  // ручной запуск синка (если есть кнопка)
  $('#syncNowBtn')?.addEventListener('click', async ()=>{
    dirty.cats = dirty.prods = true;
    await runSync().catch(e=>{
      console.error(e);
      alert('Синхронизация не удалась. См. консоль.');
    });
  });

  // импорт из файлов
  $('#fileCats').addEventListener('change', async e=>{
    const f = e.target.files[0]; if (!f) return;
    const json = JSON.parse(await f.text());
    state.cats = Array.isArray(json?.items)? json.items : [];
    renderCats(); renderProdFormOptions();
    debug('Импортированы categories.json из файла.');
    markDirty('cats');
  });
  $('#fileProds').addEventListener('change', async e=>{
    const f = e.target.files[0]; if (!f) return;
    const json = JSON.parse(await f.text());
    state.prods = Array.isArray(json?.items)? json.items : [];
    renderProds();
    debug('Импортированы products.json из файла.');
    markDirty('prods');
  });

  // экспорт в файл
  $('#dlCatsBtn').onclick  = ()=> toBlobURL({ items: state.cats  }, 'categories.json');
  $('#dlProdsBtn').onclick = ()=> toBlobURL({ items: state.prods }, 'products.json');

  // авторизация/загрузка
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
    debug('⚠ Синхронизация отключена: проверь CONFIG.sync.baseUrl и CONFIG.sync.apiKey.');
  }
}

function bindLoginForm(){
  const form = $('#loginForm');
  const err  = $('#loginErr');
  form.onsubmit = async e=>{
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
