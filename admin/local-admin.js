/* ====== Локальная авторизация + простая админка ======
 * ВНИМАНИЕ: это клиентская «дверца». Для твоей задачи ок.
 * Поменяй логин/пароль ниже (см. CONFIG).
 */
const CONFIG = {
  username: 'forfriends',                   // ЛОГИН
  passHash: 'a841ff9a9a6d1ccc1549f1acded578a2b37cf31813cd0a594ca1f1833b09d09d', // SHA-256 от "username:password:pepper"
  pepper:  'ForFriends#Pepper-2025',        // перец
  tokenKey: 'ff_admin_token',
  tokenTtlHours: 12,
};

// --- Утилиты -------------------------------------------------
const $ = s => document.querySelector(s);
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

async function sha256(str) {
  const enc = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// --- Авторизация ---------------------------------------------
function setToken(hours=CONFIG.tokenTtlHours) {
  const t = { iat: Date.now(), exp: Date.now() + hours*3600*1000 };
  localStorage.setItem(CONFIG.tokenKey, JSON.stringify(t));
}
function hasToken() {
  try {
    const raw = localStorage.getItem(CONFIG.tokenKey);
    if (!raw) return false;
    const t = JSON.parse(raw);
    return Date.now() < t.exp;
  } catch { return false; }
}
function clearToken(){ localStorage.removeItem(CONFIG.tokenKey); }

async function verifyLogin(login, pass) {
  const base = `${login}:${pass}:${CONFIG.pepper}`;
  const hash = await sha256(base);

  if (CONFIG.passHash && CONFIG.passHash !== 'CHANGE_ME') {
    return login === CONFIG.username && hash === CONFIG.passHash;
  } else {
    // Временный режим: работает демо-пароль (видно в коде!)
    const demoOk = login === CONFIG.username && pass === CONFIG.demoPassword;
    if (demoOk) {
      console.warn('%cВНИМАНИЕ','color:#fff;background:#c0392b;padding:2px 6px;border-radius:4px',
        'Вы используете ВРЕМЕННЫЙ пароль из кода. Сгенерируйте свой hash и замените CONFIG.passHash.');
      console.info('Как сгенерировать hash:\n', `
(async ()=>{
  const user='${CONFIG.username}';
  const pass='ВашПароль!';
  const pepper='${CONFIG.pepper}';
  const data = user+':'+pass+':'+pepper;
  const enc = new TextEncoder().encode(data);
  const h = await crypto.subtle.digest('SHA-256', enc);
  console.log(Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join(''));
})();`);
    }
    return demoOk;
  }
}

// --- Данные ---------------------------------------------------
const state = {
  cats: [],
  prods: [],
  editId: null,        // id редактируемого товара
};

const paths = {
  cats: '../data/categories.json',
  prods: '../data/products.json'
};

async function safeLoadJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch (e) {
    debug(`Не удалось загрузить ${url}: ${e.message}`);
    return [];
  }
}

async function loadAll() {
  $('#statusText').textContent = 'Загрузка данных…';
  const [cats, prods] = await Promise.all([
    safeLoadJson(paths.cats),
    safeLoadJson(paths.prods)
  ]);
  state.cats = cats;
  state.prods = prods;
  renderCats();
  renderProdFormOptions();
  renderProds();
  $('#statusText').textContent = `Категорий: ${state.cats.length} • Товаров: ${state.prods.length}`;
}

function renderCats() {
  const box = $('#catList');
  box.innerHTML = '';
  if (!state.cats.length) {
    box.innerHTML = `<div class="empty">Пока нет категорий.</div>`;
    return;
  }
  state.cats.forEach((c, idx) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div class="muted">#${idx+1}</div>
      <div>${escapeHtml(c.title||'—')}</div>
      <div>
        <button class="btn secondary" data-act="del">Удалить</button>
      </div>
    `;
    row.querySelector('[data-act="del"]').onclick = () => {
      if (confirm(`Удалить категорию «${c.title}»?`)) {
        state.cats.splice(idx,1);
        renderCats();
        renderProdFormOptions();
      }
    };
    box.appendChild(row);
  });
}

function renderProdFormOptions() {
  const sel = $('#p_cat');
  sel.innerHTML = '';
  state.cats.forEach(c=>{
    const o = document.createElement('option');
    o.value = c.title;
    o.textContent = c.title;
    sel.appendChild(o);
  });
}

function renderProds() {
  const box = $('#prodList');
  box.innerHTML = '';
  if (!state.prods.length) {
    box.innerHTML = `<div class="empty">Пока нет товаров.</div>`;
    return;
  }
  state.prods.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'item';
    const photo = (p.photo&&p.photo.trim())||'';
    row.innerHTML = `
      <img src="${escapeAttr(photo)||''}" onerror="this.src='https://via.placeholder.com/160x120?text=Фото'">
      <div>
        <div><strong>${escapeHtml(p.title||'—')}</strong></div>
        <div class="muted">${escapeHtml(p.category||'—')} • ${fmtPrice(p.price)} ₽ • ${escapeHtml(p.id||'')}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn secondary" data-act="edit">Править</button>
        <button class="btn red" data-act="del">Удалить</button>
      </div>
    `;
    row.querySelector('[data-act="edit"]').onclick = () => {
      fillProdForm(p);
      state.editId = p.id;
    };
    row.querySelector('[data-act="del"]').onclick = () => {
      if (confirm(`Удалить товар «${p.title}»?`)) {
        state.prods.splice(idx,1);
        renderProds();
      }
    };
    box.appendChild(row);
  });
}

function fillProdForm(p) {
  $('#p_id').value = p.id||'';
  $('#p_title').value = p.title||'';
  $('#p_price').value = p.price||'';
  $('#p_cat').value = p.category||'';
  $('#p_photo').value = p.photo||'';
  $('#p_link').value = p.link||'';
  $('#p_desc').value = p.desc||'';
}

function clearProdForm() {
  state.editId = null;
  $('#p_id').value = '';
  $('#p_title').value = '';
  $('#p_price').value = '';
  $('#p_photo').value = '';
  $('#p_link').value = '';
  $('#p_desc').value = '';
  const cat = $('#p_cat');
  if (cat.options.length) cat.selectedIndex = 0;
}

function collectProdFromForm() {
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

function validateProd(p) {
  if (!p.id) return 'Укажите ID';
  if (!p.title) return 'Укажите название';
  if (!p.category) return 'Выберите категорию';
  if (Number.isNaN(p.price) || p.price < 0) return 'Цена некорректна';
  return null;
}

// --- Рендер и UI ---------------------------------------------
function switchTab(name) {
  $$('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  $('#tab-cats').classList.toggle('hide', name!=='cats');
  $('#tab-goods').classList.toggle('hide', name!=='goods');
  $('#tab-io').classList.toggle('hide', name!=='io');
}

function debug(msg) {
  const box = $('#debugBox'); if (!box) return;
  const t = new Date().toLocaleTimeString();
  box.textContent = `[${t}] ${msg}\n` + box.textContent;
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]))}
function escapeAttr(s){return String(s).replace(/"/g,'&quot;')}
function fmtPrice(n){const x=Number(n||0);return x.toLocaleString('ru-RU')}

// --- Инициализация -------------------------------------------
async function boot() {
  // Навигация вкладок
  $$('.tab').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));

  // Кнопки
  $('#logoutBtn').onclick = () => { clearToken(); location.reload(); };
  $('#addCatBtn').onclick = () => {
    const t = $('#catTitle').value.trim();
    if (!t) return;
    state.cats.push({ title:t });
    $('#catTitle').value = '';
    renderCats();
    renderProdFormOptions();
  };

  $('#saveProdBtn').onclick = () => {
    const p = collectProdFromForm();
    const err = validateProd(p);
    if (err) return alert(err);

    const idx = state.prods.findIndex(x=>x.id===state.editId);
    if (idx >= 0) state.prods[idx] = p; else state.prods.push(p);
    clearProdForm();
    renderProds();
  };
  $('#resetProdBtn').onclick = clearProdForm;

  // Импорт локальных файлов
  $('#fileCats').addEventListener('change', async e=>{
    const f = e.target.files[0]; if (!f) return;
    const json = JSON.parse(await f.text());
    state.cats = Array.isArray(json?.items)? json.items : [];
    renderCats(); renderProdFormOptions();
    debug('Импортированы categories.json из файла.');
  });
  $('#fileProds').addEventListener('change', async e=>{
    const f = e.target.files[0]; if (!f) return;
    const json = JSON.parse(await f.text());
    state.prods = Array.isArray(json?.items)? json.items : [];
    renderProds();
    debug('Импортированы products.json из файла.');
  });

  // Экспорт
  $('#dlCatsBtn').onclick = () => toBlobURL({ items: state.cats }, 'categories.json');
  $('#dlProdsBtn').onclick = () => toBlobURL({ items: state.prods }, 'products.json');

  // Авторизация
  if (hasToken()) {
    $('#loginCard').classList.add('hide');
    $('#app').classList.remove('hide');
    await loadAll();
  } else {
    $('#loginCard').classList.remove('hide');
    $('#app').classList.add('hide');
    bindLoginForm();
  }
}

function bindLoginForm() {
  const form = $('#loginForm');
  const err = $('#loginErr');
  const hint = $('#loginHint');

  if (CONFIG.passHash === 'CHANGE_ME') {
    hint.innerHTML = 'Сейчас действует <b>временный</b> пароль из кода. Пожалуйста, сгенерируйте свой хэш и замените <span class="kbd">CONFIG.passHash</span> в <span class="kbd">/admin/local-admin.js</span>.';
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.classList.add('hide');
    const ok = await verifyLogin($('#login').value.trim(), $('#password').value);
    if (!ok) { err.classList.remove('hide'); return; }
    setToken();
    location.reload();
  };
}

boot().catch(e=>{
  console.error(e);
  alert('Ошибка запуска админки. См. консоль.');
});
