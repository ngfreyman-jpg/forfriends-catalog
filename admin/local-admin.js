/* ====== Локальная админка + РУЧНОЙ синк на Railway ======
 * Что делает:
 * - простая авторизация (username + SHA-256("username:password:pepper"))
 * - читает каталог из /data/*.json
 * - изменения копятся локально; отправка — только по кнопке «Внести изменения»
 * - отправляет POST на {baseUrl}/push с categories/products (items[])
 *
 * Заполни CONFIG.sync.baseUrl и CONFIG.sync.apiKey.
 * baseUrl: публичный домен Railway (напр. https://forfriends-sync-production.up.railway.app)
 * apiKey : тот же API_KEY, что лежит в переменных Railway.
 */

const CONFIG = {
  // --- авторизация ---
  username: 'forfriends',
  passHash: 'a841ff9a9a6d1ccc1549f1acded578a2b37cf31813cd0a594ca1f1833b09d09d', // SHA-256 от "username:password:pepper"
  pepper:   'ForFriends#Pepper-2025',
  tokenKey: 'ff_admin_token',
  tokenTtlHours: 12,

  // --- откуда читаем текущие данные каталога ---
  paths: {
    cats: '../data/categories.json',
    prods: '../data/products.json',
  },

  // --- куда шлём изменения ---
  sync: {
    baseUrl: 'https://forfriends-sync-production.up.railway.app', // ← замени на свой домен при необходимости
    apiKey:  'PASTE_YOUR_API_KEY_HERE', // ← сюда тот же секрет, что и на Railway
    auto:    false,        // РУЧНОЙ режим — только по кнопке
    timeoutMs: 20000,
  },
};

/* ===================== Утилиты ===================== */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

async function sha256(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#039;' }[m]))}
function escapeAttr(s){return String(s).replace(/"/g,'&quot;')}
function fmtPrice(n){const x=Number(n||0);return x.toLocaleString('ru-RU')}
async function safeJson(url){
  try{
    const r = await fetch(`${url}?v=${Date.now()}`, { cache:'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return Array.isArray(j?.items) ? j.items : [];
  }catch(e){ console.warn('load fail', url, e); return []; }
}

/* ===================== Авторизация ===================== */
function setToken(hours=CONFIG.tokenTtlHours){
  const t = { iat: Date.now(), exp: Date.now()+hours*3600*1000 };
  localStorage.setItem(CONFIG.tokenKey, JSON.stringify(t));
}
function hasToken(){
  try{
    const raw = localStorage.getItem(CONFIG.tokenKey); if (!raw) return false;
    const t = JSON.parse(raw); return Date.now() < t.exp;
  }catch{ return false; }
}
function clearToken(){ localStorage.removeItem(CONFIG.tokenKey); }
async function verifyLogin(login, pass){
  const base = `${login}:${pass}:${CONFIG.pepper}`;
  const hash = await sha256(base);
  return login === CONFIG.username && hash === CONFIG.passHash;
}

/* ===================== Состояние ===================== */
const state = {
  cats:  [],
  prods: [],
  editId: null, // id товара, который правим
};
function debugBox(){
  let el = $('#debugBox');
  if (!el){
    el = document.createElement('pre');
    el.id = 'debugBox';
    el.style.cssText = 'margin-top:12px;padding:10px;background:#0b0f14;border:1px solid #263140;border-radius:8px;max-height:220px;overflow:auto;color:#aab4c0;font:12px ui-monospace,Consolas';
    ($('#app')||document.body).appendChild(el);
  }
  return el;
}
function log(msg){
  const t = new Date().toLocaleTimeString();
  debugBox().textContent = `[${t}] ${msg}\n` + debugBox().textContent;
}

/* ===================== Чтение/рендер ===================== */
async function loadAll(){
  $('#statusText') && ($('#statusText').textContent = 'Загрузка данных…');
  const [cats, prods] = await Promise.all([
    safeJson(CONFIG.paths.cats),
    safeJson(CONFIG.paths.prods),
  ]);
  state.cats = cats;
  state.prods = prods;
  renderCats(); renderProdFormOptions(); renderProds();
  $('#statusText') && ($('#statusText').textContent = `Категорий: ${cats.length} • Товаров: ${prods.length}`);
}

function renderCats(){
  const box = $('#catList'); box.innerHTML = '';
  if (!state.cats.length){ box.innerHTML = `<div class="empty">Пока нет категорий.</div>`; return; }
  state.cats.forEach((c, i)=>{
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div class="muted">#${i+1}</div>
      <div>${escapeHtml(c.title||'—')}</div>
      <div><button class="btn secondary" data-del>Удалить</button></div>
    `;
    row.querySelector('[data-del]').onclick = ()=>{
      if (confirm(`Удалить категорию «${c.title}»?`)){
        state.cats.splice(i,1);
        renderCats(); renderProdFormOptions();
      }
    };
    box.appendChild(row);
  });
}
function renderProdFormOptions(){
  const sel = $('#p_cat'); if (!sel) return;
  sel.innerHTML = '';
  state.cats.forEach(c=>{
    const o = document.createElement('option');
    o.value = c.title; o.textContent = c.title; sel.appendChild(o);
  });
}
function renderProds(){
  const box = $('#prodList'); box.innerHTML = '';
  if (!state.prods.length){ box.innerHTML = `<div class="empty">Пока нет товаров.</div>`; return; }
  state.prods.forEach((p, i)=>{
    const row = document.createElement('div'); row.className = 'item';
    const photo = (p.photo||'').trim();
    row.innerHTML = `
      <img src="${escapeAttr(photo)}" onerror="this.src='https://placehold.co/160x120?text=%D0%A4%D0%BE%D1%82%D0%BE'">
      <div>
        <div><strong>${escapeHtml(p.title||'—')}</strong></div>
        <div class="muted">${escapeHtml(p.category||'—')} • ${fmtPrice(p.price)} ₽ • ${escapeHtml(p.id||'')}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn secondary" data-edit>Править</button>
        <button class="btn red" data-del>Удалить</button>
      </div>
    `;
    row.querySelector('[data-edit]').onclick = ()=>{ fillProdForm(p); state.editId = p.id; };
    row.querySelector('[data-del]').onclick  = ()=>{
      if (confirm(`Удалить товар «${p.title}»?`)){
        state.prods.splice(i,1); renderProds();
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
    id: $('#p_id').value.trim(),
    title: $('#p_title').value.trim(),
    price: Number($('#p_price').value||0),
    category: $('#p_cat').value.trim(),
    photo: $('#p_photo').value.trim(),
    link: $('#p_link').value.trim(),
    desc: $('#p_desc').value.trim(),
  };
}
function validateProd(p){
  if (!p.id) return 'Укажите ID';
  if (!p.title) return 'Укажите название';
  if (!p.category) return 'Выберите категорию';
  if (Number.isNaN(p.price) || p.price < 0) return 'Цена некорректна';
  return null;
}

/* ===================== РУЧНОЙ СИНК ===================== */
const SYNC_READY = Boolean(CONFIG.sync?.baseUrl && CONFIG.sync?.apiKey);

function ensureSyncUI(){
  // Кнопка «Внести изменения»
  if (!$('#syncNowBtn')){
    const btn = document.createElement('button');
    btn.id = 'syncNowBtn';
    btn.className = 'btn primary';
    btn.textContent = 'Внести изменения';
    // стараемся положить в таб «Импорт/Экспорт», иначе — в конец #app
    const io = $('#tab-io') || $('#app') || document.body;
    (io.querySelector('.actions') || io).appendChild(btn);
  }
  // Модалка
  if (!$('#syncModal')){
    const wrap = document.createElement('div');
    wrap.id = 'syncModal';
    wrap.className = 'modal hide';
    wrap.innerHTML = `
      <div class="modal-body">
        <div id="syncTitle">Отправка…</div>
        <div id="syncMsg" class="muted">Подождите, изменения применяются…</div>
        <div id="syncSpinner" class="spinner"></div>
        <button id="syncCloseBtn" class="btn" style="display:none">Закрыть</button>
      </div>`;
    document.body.appendChild(wrap);
  }
}
function modalShow(text){
  $('#syncTitle').textContent = text || 'Отправка…';
  $('#syncMsg').textContent = 'Подождите, изменения применяются…';
  $('#syncSpinner').style.display = '';
  $('#syncCloseBtn').style.display = 'none';
  $('#syncModal').classList.remove('hide');
}
function modalDone(ok, msg){
  $('#syncTitle').textContent = ok ? 'Готово' : 'Ошибка';
  $('#syncMsg').textContent = msg || (ok ? 'Изменения внесены.' : 'Не удалось выполнить синк.');
  $('#syncSpinner').style.display = 'none';
  $('#syncCloseBtn').style.display = '';
}
function modalHide(){ $('#syncModal').classList.add('hide'); }

async function doSync(){
  if (!SYNC_READY){
    modalDone(false, 'Синхронизация не настроена (baseUrl/apiKey).');
    return;
  }
  const payload = {
    categories: { items: state.cats },
    products:   { items: state.prods },
    meta: { ts: Date.now(), reason: 'manual' }
  };
  log('→ POST /push');
  const ctl = new AbortController();
  const t   = setTimeout(()=>ctl.abort(), CONFIG.sync.timeoutMs);
  try{
    const res = await fetch(CONFIG.sync.baseUrl.replace(/\/+$/,'') + '/push', {
      method:'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key': CONFIG.sync.apiKey },
      body: JSON.stringify(payload),
      signal: ctl.signal
    });
    clearTimeout(t);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text||''}`);
    log('✓ синк ОК: ' + (text||''));
    modalDone(true, 'Изменения успешно закоммичены.');
  }catch(e){
    clearTimeout(t);
    console.error(e);
    log('✗ синк FAIL: ' + e.message);
    modalDone(false, e.message);
  }
}

/* ===================== UI & boot ===================== */
function switchTab(name){
  $$('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  $('#tab-cats' ).classList.toggle('hide', name!=='cats');
  $('#tab-goods').classList.toggle('hide', name!=='goods');
  $('#tab-io'   ).classList.toggle('hide', name!=='io');
}

async function boot(){
  // вкладки
  $$('.tab').forEach(b=> b.onclick = ()=> switchTab(b.dataset.tab));

  // кнопки
  $('#logoutBtn').onclick = ()=>{ clearToken(); location.reload(); };

  $('#addCatBtn').onclick = ()=>{
    const t = $('#catTitle').value.trim(); if (!t) return;
    state.cats.push({ title:t }); $('#catTitle').value = '';
    renderCats(); renderProdFormOptions();
  };

  $('#saveProdBtn').onclick = ()=>{
    const p = collectProdFromForm();
    const err = validateProd(p); if (err) return alert(err);
    const i = state.prods.findIndex(x=>x.id===state.editId);
    if (i>=0) state.prods[i] = p; else state.prods.push(p);
    clearProdForm(); renderProds();
  };
  $('#resetProdBtn').onclick = clearProdForm;

  // импорт/экспорт
  $('#fileCats').addEventListener('change', async e=>{
    const f = e.target.files[0]; if (!f) return;
    const j = JSON.parse(await f.text());
    state.cats = Array.isArray(j?.items) ? j.items : [];
    renderCats(); renderProdFormOptions(); log('Импортирован categories.json');
  });
  $('#fileProds').addEventListener('change', async e=>{
    const f = e.target.files[0]; if (!f) return;
    const j = JSON.parse(await f.text());
    state.prods = Array.isArray(j?.items) ? j.items : [];
    renderProds(); log('Импортирован products.json');
  });

  // авторизация
  if (hasToken()){
    $('#loginCard').classList.add('hide');
    $('#app').classList.remove('hide');
    await loadAll();
  }else{
    $('#loginCard').classList.remove('hide');
    $('#app').classList.add('hide');
    const form = $('#loginForm');
    const err  = $('#loginErr');
    form.onsubmit = async (e)=>{
      e.preventDefault(); err.classList.add('hide');
      const ok = await verifyLogin($('#login').value.trim(), $('#password').value);
      if (!ok){ err.classList.remove('hide'); return; }
      setToken(); location.reload();
    };
  }

  // ручной синк: кнопка + модалка
  ensureSyncUI();
  $('#syncNowBtn').onclick = ()=>{ modalShow('Отправка…'); doSync(); };
  $('#syncCloseBtn').onclick = modalHide;

  if (!SYNC_READY){
    log('⚠ Синхронизация не настроена: заполните CONFIG.sync.baseUrl и apiKey.');
  }else{
    log('✓ Ручной синк включён. Используйте кнопку «Внести изменения».');
  }
}

boot().catch(e=>{ console.error(e); alert('Ошибка запуска админки. См. консоль.'); });
