/* ====== Локальная админка (гибрид) ======
 * - Категории/товары редактируются локально
 * - «Внести изменения» шлёт POST /push и опрашивает /status/:id
 * - Загрузка фото: client-side сжатие → WebP + SHA-1 хэш имени (дедуп)
 * - Удаление фото: /media/delete (safe), если картинка больше не используется
 */

const CONFIG = {
  username: 'forfriends',
  // NOTE: позже лучше поменять на SHA256("forfriends:<пароль>:ForFriends#Pepper-2025")
  passHash: '434603fbb379008054761657ddcd827aab3221597bd247d428be4ec8fbde5b02',
  pepper:   'ForFriends#Pepper-2025',
  tokenKey: 'ff_admin_token',
  tokenTtlHours: 12,

  paths: {
    cats: '../data/categories.json',
    prods: '../data/products.json',
  },

  sync: {
    baseUrl: 'https://forfriends-sync-production.up.railway.app',
    apiKey:  '056fad75ad5e57d293e57739ec70ceb3fba4967d1cd9d2fa64a9be15dbf95c20',
    pollMs: 1500,
    timeoutMs: 20000,
    totalTimeoutMs: 180000,
  },
};

/* ============ Утилиты ============ */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

async function sha256(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
function escapeHtml(s){return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#039;' }[m]))}
function escapeAttr(s){return String(s).replace(/"/g,'&quot;')}
function fmtPrice(n){const x=Number(n||0);return x.toLocaleString('ru-RU')}
async function safeJson(url){
  const r = await fetch(`${url}?v=${Date.now()}`, { cache:'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return Array.isArray(j?.items) ? j.items : [];
}
function logLine(s){
  const ts = new Date().toLocaleTimeString();
  const box = $('#log');
  if (box) box.textContent = `[${ts}] ${s}\n` + box.textContent;
}

/* ====== Media helpers (upload/compress/delete) ====== */
function isRepoImageUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url, 'https://dummy/');
    return u.pathname.includes('/images/');
  } catch {
    return String(url).startsWith('images/');
  }
}

// Сжатие изображения на клиенте → WebP (без кропа; по желанию можно добавить кроп 4:5)
async function compressImage(file, { maxSide = 1200, quality = 0.82 } = {}) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });

  let { width, height } = img;
  const k = Math.max(width, height) / maxSide;
  if (k > 1) { width = Math.round(width / k); height = Math.round(height / k); }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality)
  );

  const nameBase = (file.name || 'photo').replace(/\.[^.]+$/,'').replace(/[^a-z0-9_.-]/gi,'_');
  return new File([blob], `${nameBase}.webp`, { type: 'image/webp' });
}

// SHA-1 хэш для Blob/File (для имени файла)
async function sha1OfBlob(blob) {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// Отправка файла на сервер: кладём как <sha1>.webp (сервер дедуплит)
async function uploadImageFile(webpFile) {
  const base = CONFIG.sync.baseUrl.replace(/\/+$/, '');
  const key  = (CONFIG.sync.apiKey || '').trim();

  // считаем хэш уже сжатого файла
  const h = await sha1OfBlob(webpFile);
  const named = new File([webpFile], `${h}.webp`, { type: 'image/webp' });

  const fd = new FormData();
  fd.append('file', named, named.name);

  const r = await fetch(`${base}/upload`, {
    method: 'POST',
    headers: { 'x-api-key': key },
    body: fd
  });
  if (!r.ok) throw new Error('upload_failed');
  const data = await r.json();
  if (!data?.url) throw new Error('bad_upload_response');
  if (data.dedup) logLine('media: дубликат — использую существующий файл');
  return data.url;
}

// Безопасное удаление файла (если больше не используется)
async function deleteImageIfUnused(url) {
  const stillUsed = state.prods.some(p => (p.photo||'').trim() === (url||'').trim());
  if (stillUsed) return;
  if (!isRepoImageUrl(url)) return;

  try {
    const base = CONFIG.sync.baseUrl.replace(/\/+$/,'');
    const key  = (CONFIG.sync.apiKey || '').trim();
    const r = await fetch(`${base}/media/delete`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key': key },
      body: JSON.stringify({ url })
    });
    if (r.ok) logLine('media: удалено ' + url);
  } catch {
    logLine('media: не удалось удалить (см. логи)');
  }
}

/* ============ Авторизация ============ */
function setToken(hours=CONFIG.tokenTtlHours){
  const t = { exp: Date.now()+hours*3600*1000 };
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

/* ============ Состояние ============ */
const state = { cats: [], prods: [], editId: null };

/* ============ Рендер ============ */
async function loadAll(){
  $('#statusText').textContent = 'Загрузка данных…';
  const [cats, prods] = await Promise.all([
    safeJson(CONFIG.paths.cats),
    safeJson(CONFIG.paths.prods),
  ]);
  state.cats = cats;
  state.prods = prods;
  renderCats(); renderProdFormOptions(); renderProds();
  $('#statusText').textContent = `Категорий: ${cats.length} • Товаров: ${prods.length}`;
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
  const sel = $('#p_cat'); sel.innerHTML = '';
  state.cats.forEach(c=>{
    const o = document.createElement('option');
    o.value = c.title; o.textContent = c.title;
    sel.appendChild(o);
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
    row.querySelector('[data-del]').onclick  = async ()=>{
      if (!confirm(`Удалить товар «${p.title}»?`)) return;
      const photoUrl = (p.photo || '').trim();
      state.prods.splice(i,1);
      renderProds();
      if (photoUrl && isRepoImageUrl(photoUrl)) {
        const stillUsed = state.prods.some(x => (x.photo||'').trim() === photoUrl);
        if (!stillUsed) await deleteImageIfUnused(photoUrl);
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
  const sel = $('#p_cat'); if (sel.options.length) sel.selectedIndex = 0;
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

/* ============ Синк ============ */
async function pushChanges(){
  const base = CONFIG.sync.baseUrl.replace(/\/+$/,'');
  const key  = (CONFIG.sync.apiKey || '').trim();
  if (!base || !key){ logLine('⚠ Синк не настроен (baseUrl/apiKey)'); return; }

  const payload = {
    categories: { items: state.cats },
    products:   { items: state.prods },
    meta: { ts: Date.now(), reason: 'manual' }
  };

  try{
    $('#btn-push').disabled = true;
    logLine('sync: SENDING…');

    const ctl = new AbortController();
    const t   = setTimeout(()=>ctl.abort(), CONFIG.sync.timeoutMs);
    const res = await fetch(`${base}/push`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key': key },
      body: JSON.stringify(payload),
      signal: ctl.signal
    });
    clearTimeout(t);

    if (!res.ok){
      const txt = await res.text().catch(()=> '');
      throw new Error(`push HTTP ${res.status} ${txt}`);
    }
    const { ok, jobId } = await res.json();
    if (!ok || !jobId) throw new Error('Сервер не вернул jobId.');

    logLine(`sync: QUEUED job ${jobId}`);
    await pollStatus(base, key, jobId);
  }catch(e){
    logLine('sync: ERROR ' + (e.message||e));
  }finally{
    $('#btn-push').disabled = false;
  }
}

async function pollStatus(base, key, jobId){
  const started = Date.now();
  let last = '';
  while (Date.now() - started < CONFIG.sync.totalTimeoutMs){
    await sleep(CONFIG.sync.pollMs);
    const r = await fetch(`${base}/status/${encodeURIComponent(jobId)}`, {
      headers: { 'x-api-key': key }, cache:'no-store'
    });
    if (!r.ok){
      const t = await r.text().catch(()=> '');
      throw new Error(`status HTTP ${r.status} ${t}`);
    }
    const st = await r.json();
    if (st.state !== last){
      last = st.state;
      if (st.state === 'queued')  logLine('sync: QUEUED…');
      if (st.state === 'running') logLine('sync: RUNNING…');
    }
    if (st.state === 'done'){ logLine(`sync: DONE ${st.commit||''}`); return; }
    if (st.state === 'error'){ throw new Error(st.error||'unknown'); }
  }
  throw new Error('timeout');
}

/* ============ Навигация/boot ============ */
function switchTab(name){
  $$('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  $('#tab-cats' ).classList.toggle('hide', name!=='cats');
  $('#tab-goods').classList.toggle('hide', name!=='goods');
  $('#tab-sync' ).classList.toggle('hide', name!=='sync');
}

async function boot(){
  // вкладки
  $$('.tab').forEach(b=> b.onclick = ()=> switchTab(b.dataset.tab));
  switchTab('cats');

  // auth
  $('#logoutBtn').onclick = ()=>{ clearToken(); location.reload(); };

  if (hasToken()){
    $('#loginCard').classList.add('hide');
    $('#app').classList.remove('hide');
    await loadAll();
  }else{
    $('#loginCard').classList.remove('hide');
    $('#app').classList.add('hide');
    $('#loginForm').onsubmit = async (e)=>{
      e.preventDefault();
      $('#loginErr').classList.add('hide');
      const ok = await verifyLogin($('#login').value.trim(), $('#password').value);
      if (!ok){ $('#loginErr').classList.remove('hide'); return; }
      setToken(); location.reload();
    };
  }

  // категории
  $('#addCatBtn').onclick = ()=>{
    const t = $('#catTitle').value.trim(); if (!t) return;
    state.cats.push({ title: t });
    $('#catTitle').value = '';
    renderCats(); renderProdFormOptions();
  };

  // товары
  $('#saveProdBtn').onclick = ()=>{
    const p = collectProdFromForm();
    const err = validateProd(p); if (err) return alert(err);
    const i = state.prods.findIndex(x=>x.id===state.editId);
    if (i>=0) state.prods[i] = p; else state.prods.push(p);
    clearProdForm(); renderProds();
  };
  $('#resetProdBtn').onclick = clearProdForm;

  // Загрузка фото: сжатие → sha1 имя → upload
  $('#btn-upload').onclick = async () => {
    const inp = $('#p_file');
    const orig = inp?.files?.[0];
    if (!orig) { alert('Выберите файл'); return; }
    try {
      $('#btn-upload').disabled = true;

      logLine('media: сжатие…');
      const compressed = await compressImage(orig, { maxSide: 1200, quality: 0.82 });

      logLine(`media: загрузка (${Math.round(compressed.size/1024)} КБ)…`);
      const url = await uploadImageFile(compressed);

      $('#p_photo').value = url;
      if (state.editId) {
        const i = state.prods.findIndex(x => x.id === state.editId);
        if (i >= 0) { state.prods[i].photo = url; renderProds(); }
      }
      logLine('media: загружено');
    } catch (e) {
      alert('Не удалось загрузить фото');
      logLine('media: ошибка загрузки');
    } finally {
      $('#btn-upload').disabled = false;
      if (inp) inp.value = '';
    }
  };

  // синк
  $('#btn-push').onclick = pushChanges;

  logLine('✓ Ручной синк включён. Нажимай «Внести изменения».');
}

boot().catch(e=>{ console.error(e); alert('Ошибка запуска админки. См. консоль.'); });
