/* ====== Локальная админка (гибрид) ====== */
const CONFIG = {
  username: 'forfriends',
  passHash: 'a841ff9a9a6d1ccc1549f1acded578a2b37cf31813cd0a594ca1f1833b09d09d',
  pepper:   'ForFriends#Pepper-2025',
  tokenKey: 'ff_admin_token',
  tokenTtlHours: 12,

  paths: {
    cats: '../data/categories.json',
    prods: '../data/products.json',
  },

  sync: {
    baseUrl: 'http://82.97.252.210:3000',
    apiKey:  '313e46ab08ab2fefd61634210f537e82fc2055b6ab6b3bb8d0b222744ab39797',
    pollMs: 1500,
    timeoutMs: 20000,
    totalTimeoutMs: 180000,
  },
};

/* ============ Утилиты ============ */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

async function sha256(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
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

// Сжатие изображения → WebP
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
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality)
  );

  const nameBase = (file.name || 'photo').replace(/\.[^.]+$/,'').replace(/[^a-z0-9_.-]/gi,'_');
  return new File([blob], `${nameBase}.webp`, { type: 'image/webp' });
}

async function sha1OfBlob(blob) {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function uploadImageFile(webpFile) {
  const base = CONFIG.sync.baseUrl.replace(/\/+$/, '');
  const key  = (CONFIG.sync.apiKey || '').trim();

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

/* ---------- Грязное состояние (unsaved changes) ---------- */
let isDirty = false;
const pushBtn = () => $('#btn-push');
function refreshDirtyUI() {
  const b = pushBtn();
  if (b) b.textContent = isDirty ? 'Внести изменения • несохранено' : 'Внести изменения';
}
function markDirty() {
  if (!isDirty) {
    isDirty = true;
    refreshDirtyUI();
    logLine('✎ Изменения не синхронизированы');
  }
}
function clearDirty() {
  if (isDirty) {
    isDirty = false;
    refreshDirtyUI();
    logLine('✓ Все изменения синхронизированы');
  }
}
// предупреждение при закрытии вкладки
window.addEventListener('beforeunload', (e) => {
  if (!isDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

/* ============ Клиентская предвалидация/нормализация ============ */
function normStr(s){ return String(s||'').replace(/\s+/g,' ').trim(); }
function isHttpsUrl(u){
  try { const x = new URL(u); return x.protocol === 'https:'; } catch { return false; }
}
function isImagePath(u){ return isRepoImageUrl(u) || isHttpsUrl(u); }

function validateAndCleanCategories(rawCats){
  const seen = new Set();
  const out = [];
  const errors = [];
  for (const c of rawCats||[]){
    const title = normStr(c?.title||'');
    if (!title || title.length>60){ errors.push(`Категория отброшена: "${c?.title||''}"`); continue; }
    const key = title.toLowerCase();
    if (seen.has(key)){ errors.push(`Дубликат категории: "${title}"`); continue; }
    seen.add(key);
    out.push({ title });
  }
  return { items: out, errors };
}

function validateAndCleanProducts(rawProds, catsSet){
  const seen = new Set();
  const out = [];
  const errors = [];
  for (const p of rawProds||[]){
    const id = normStr(p?.id||'');
    const title = normStr(p?.title||'');
    const category = normStr(p?.category||'');
    const desc = normStr(p?.desc||'');
    const priceNum = Number(p?.price ?? 0);

    if (!id){ errors.push(`Товар без id отброшен: "${title||'[нет названия]'}"`); continue; }
    if (!title){ errors.push(`Товар без названия отброшен: id=${id}`); continue; }
    if (Number.isNaN(priceNum) || priceNum<0){ errors.push(`Цена некорректна: id=${id}`); continue; }
    if (category && !catsSet.has(category.toLowerCase())){ errors.push(`Категория не найдена (${category}) у id=${id}`); continue; }

    let photo = normStr(p?.photo||'');
    let link  = normStr(p?.link||'');
    if (photo && !isImagePath(photo)){ errors.push(`Фото не URL/images: id=${id}`); photo=''; }
    if (link && !isHttpsUrl(link)){ errors.push(`Ссылка не https URL: id=${id}`); link=''; }

    const key = id.toLowerCase();
    if (seen.has(key)){ errors.push(`Дубликат id: ${id}`); continue; }
    seen.add(key);

    out.push({ id, title, price: priceNum, category, photo, link, desc });
  }
  return { items: out, errors };
}

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
  clearDirty(); // начальное состояние считаем чистым
  refreshDirtyUI();
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
      const catTitle = (c.title || '').trim();
      if (!catTitle) return;

      // Ищем все товары, привязанные к удаляемой категории
      const linkedIdx = [];
      const catKey = catTitle.toLowerCase();
      state.prods.forEach((p, idx)=>{
        if ((p.category||'').trim().toLowerCase() === catKey) linkedIdx.push(idx);
      });

      if (linkedIdx.length > 0){
        const ok = confirm(
          `К категории «${catTitle}» привязано товаров: ${linkedIdx.length}.\n\n` +
          `Удалить категорию и очистить у этих товаров поле категории (перенести в «без категории»)?`
        );
        if (!ok) return;

        // Очистим привязку у всех связанных товаров
        linkedIdx.forEach((idx)=> { state.prods[idx].category = ''; });
        logLine(`Категория «${catTitle}»: отвязано товаров — ${linkedIdx.length}`);
      } else {
        // Обычное подтверждение, если товаров нет
        const ok = confirm(`Удалить категорию «${catTitle}»?`);
        if (!ok) return;
      }

      // Удаляем категорию
      state.cats.splice(i,1);
      renderCats(); renderProdFormOptions(); renderProds();
      markDirty();
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
      markDirty();
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

/* ============ Синк (с предвалидацией) ============ */
async function pushChanges(){
  const base = CONFIG.sync.baseUrl.replace(/\/+$/,'');
  const key  = (CONFIG.sync.apiKey || '').trim();
  if (!base || !key){ logLine('⚠ Синк не настроен (baseUrl/apiKey)'); return; }

  // 1) Клиентская нормализация/валидация
  const { items: cleanCats, errors: catErrs } = validateAndCleanCategories(state.cats);
  const catsSet = new Set(cleanCats.map(c => c.title.toLowerCase()));
  const { items: cleanProds, errors: prodErrs } = validateAndCleanProducts(state.prods, catsSet);

  const allErrs = [...catErrs, ...prodErrs];
  if (!cleanCats.length) allErrs.push('Нет валидных категорий после очистки.');
  if (!cleanProds.length) allErrs.push('Нет валидных товаров после очистки.');

  if (allErrs.length){
    alert('Исправьте ошибки перед синком:\n\n' + allErrs.slice(0,15).join('\n') + (allErrs.length>15?`\n…и ещё ${allErrs.length-15}`:''));
    logLine('sync: ОТМЕНА — ошибки в данных (см. alert).');
    return;
  }

  // 2) Отправка на сервер
  const payload = {
    categories: { items: cleanCats },
    products:   { items: cleanProds },
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
    const data = await res.json();
    if (!data?.ok || !data?.jobId) throw new Error('Сервер не вернул jobId.');

    if (data.report){
      const { cats, prods } = data.report;
      const lines = [];
      if (cats?.dropped)   lines.push(`Категории отброшены: ${cats.dropped}`);
      if (cats?.deduped)   lines.push(`Категории дубликаты: ${cats.deduped}`);
      if (prods?.dropped)  lines.push(`Товары отброшены: ${prods.dropped}`);
      if (prods?.deduped)  lines.push(`Товары дубликаты: ${prods.deduped}`);
      if (prods?.badRefs)  lines.push(`Товары с несуществ. категорией: ${prods.badRefs}`);
      if (lines.length) logLine('server report:\n' + lines.join('\n'));
    }

    logLine(`sync: QUEUED job ${data.jobId}`);
    await pollStatus(base, key, data.jobId);

    // если дошли сюда без исключений — считаем, что синк успешен
    clearDirty();
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
    markDirty();
  };

  // товары
  $('#saveProdBtn').onclick = ()=>{
    const p = collectProdFromForm();
    const err = validateProd(p); if (err) return alert(err);
    const i = state.prods.findIndex(x=>x.id===state.editId);
    if (i>=0) state.prods[i] = p; else state.prods.push(p);
    clearProdForm(); renderProds();
    markDirty();
  };
  $('#resetProdBtn').onclick = clearProdForm;

  // upload
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
      markDirty(); // загрузка/смена фото — несохранённое изменение
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
  refreshDirtyUI();
}

boot().catch(e=>{ console.error(e); alert('Ошибка запуска админки. См. консоль.'); });
