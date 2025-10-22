/* ====== Локальная админка + РУЧНОЙ синк на Railway ======
 * - Авторизация: username + SHA-256("username:password:pepper")
 * - Каталог читаем из /data/*.json
 * - Изменения копятся локально; отправка — по кнопке «Внести изменения»
 * - POST {baseUrl}/push -> {jobId}; затем опрос GET {baseUrl}/status/:id
 */

const CONFIG = {
  // --- авторизация ---
  username: 'forfriends',
  passHash: 'a841ff9a9a6d1ccc1549f1acded578a2b37cf31813cd0a594ca1f1833b09d09d',
  pepper:   'ForFriends#Pepper-2025',
  tokenKey: 'ff_admin_token',
  tokenTtlHours: 12,

  // --- источники данных каталога ---
  paths: {
    cats: '../data/categories.json',
    prods: '../data/products.json',
  },

  // --- настройки синка ---
  sync: {
    baseUrl: 'https://forfriends-sync-production.up.railway.app', // твой домен Railway
    apiKey:  '056fad75ad5e57d293e57739ec70ceb3fba4967d1cd9d2fa64a9be15dbf95c20', // тот же, что API_KEY на Railway
    auto:    false,       // РУЧНОЙ режим
    timeoutMs: 20000,     // таймаут HTTP для /push
    pollMs:   1500,       // шаг опроса /status
    totalTimeoutMs: 180000 // общий таймаут ожидания коммита (3 мин)
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
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const trimBase = (u)=> u.replace(/\/+$/,'');

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
const state = { cats: [], prods: [], editId: null };

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

/* ===================== Модалка синка ===================== */
function ensureSyncUI(){
  // кнопка
  if (!$('#syncNowBtn')){
    const btn = document.createElement('button');
    btn.id = 'syncNowBtn';
    btn.className = 'btn primary';
    btn.textContent = 'Внести изменения';
    const io = $('#tab-io') || $('#app') || document.body;
    (io.querySelector('.actions') || io).appendChild(btn);
  }
  // модалка
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
function modalShow(title, msg){
  $('#syncTitle').textContent = title || 'Отправка…';
  $('#syncMsg').textContent   = msg   || 'Подождите, изменения применяются…';
  $('#syncSpinner').style.display = '';
  $('#syncCloseBtn').style.display = 'none';
  $('#syncModal').classList.remove('hide');
}
function modalSet(msg){ $('#syncMsg').textContent = msg || ''; }
function modalDone(ok, msg){
  $('#syncTitle').textContent = ok ? 'Готово' : 'Ошибка';
  $('#syncMsg').textContent   = msg || (ok ? 'Изменения внесены.' : 'Не удалось выполнить синк.');
  $('#syncSpinner').style.display = 'none';
  $('#syncCloseBtn').style.display = '';
}
function modalHide(){ $('#syncModal').classList.add('hide'); }

/* ===================== РУЧНОЙ СИНК (push + poll status) ===================== */
async function pushChangesAndWait(){
  const baseUrl = trimBase(CONFIG.sync.baseUrl||'');
  const apiKey  = CONFIG.sync.apiKey||'';
  if (!baseUrl || !apiKey){
    modalDone(false, 'Синхронизация не настроена (baseUrl/apiKey).');
    return;
  }
  modalShow('Вносим изменения…', 'Создаём задачу на сервере…');

  const payload = {
    categories: { items: state.cats },
    products:   { items: state.prods },
    meta: { ts: Date.now(), reason: 'manual' }
  };

  // 1) создаём задачу
  let jobId = null;
  try{
    const ctl = new AbortController();
    const t   = setTimeout(()=>ctl.abort(), CONFIG.sync.timeoutMs);
    const res = await fetch(`${baseUrl}/push`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(payload),
      signal: ctl.signal
    });
    clearTimeout(t);
    if (res.status === 401 || res.status === 403){
      const txt = await res.text().catch(()=> '');
      throw new Error(`Доступ запрещён (HTTP ${res.status}). ${txt||''}`);
    }
    if (!res.ok){
      const txt = await res.text().catch(()=> '');
      throw new Error(`Ошибка /push (HTTP ${res.status}). ${txt||''}`);
    }
    const data = await res.json().catch(()=> ({}));
    jobId = data?.jobId || null;
    if (!jobId) throw new Error('Сервер не вернул jobId.');
  }catch(e){
    log('✗ push FAIL: ' + (e.message||e));
    modalDone(false, e.message||'Ошибка /push');
    return;
  }

  // 2) опрос статуса
  modalSet('Задача создана. Ожидайте…');
  const started = Date.now();
  let lastState = '';

  while (Date.now() - started < CONFIG.sync.totalTimeoutMs){
    await sleep(CONFIG.sync.pollMs);
    try{
      const r = await fetch(`${baseUrl}/status/${encodeURIComponent(jobId)}`, {
        headers: { 'x-api-key': apiKey },
        cache: 'no-store'
      });
      if (!r.ok){
        const t = await r.text().catch(()=> '');
        throw new Error(`status HTTP ${r.status}: ${t}`);
      }
      const st = await r.json();
      if (st.state !== lastState){
        lastState = st.state;
        if (st.state === 'queued')  modalSet('Задача в очереди. Ожидайте…');
        if (st.state === 'running') modalSet('Выполняем коммит и пуш…');
      }
      if (st.state === 'done'){
        log('✓ sync DONE: ' + (st.commit||''));
        modalDone(true, 'Готово! Изменения закоммичены.\nGitHub Pages может обновляться 10–60 сек.');
        return;
      }
      if (st.state === 'error'){
        log('✗ sync ERROR: ' + (st.error||'unknown'));
        modalDone(false, st.error || 'Ошибка во время коммита.');
        return;
      }
    }catch(e){
      log('✗ status FAIL: ' + (e.message||e));
      modalDone(false, e.message||'Ошибка запроса статуса.');
      return;
    }
  }

  modalDone(false, 'Таймаут ожидания (3 мин). Проверь репозиторий вручную.');
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

  // кнопки товаров/категорий
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

  // импорт/экспорт (локальные файлы)
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
  $('#syncNowBtn').onclick = ()=> pushChangesAndWait();
  $('#syncCloseBtn').onclick = modalHide;

  if (!CONFIG.sync.baseUrl || !CONFIG.sync.apiKey){
    log('⚠ Синхронизация не настроена: заполните CONFIG.sync.baseUrl и apiKey.');
  }else{
    log('✓ Ручной синк включён. Нажимайте «Внести изменения» для коммита.');
  }
}

boot().catch(e=>{ console.error(e); alert('Ошибка запуска админки. См. консоль.'); });
