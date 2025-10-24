(function () {
  // === 0) Настройка API ===
  const API_BASE = 'https://forfriends-sync-production.up.railway.app';

  // === 1) Telegram WebApp (не мешает вне телеги)
  const tg = window.Telegram?.WebApp;
  try {
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor?.('#0c0e11');
    tg?.setBackgroundColor?.('#0c0e11');
    tg?.onEvent?.('themeChanged', () => {
      tg?.setHeaderColor?.('#0c0e11');
      tg?.setBackgroundColor?.('#0c0e11');
    });
  } catch {}

  const $grid  = document.getElementById("grid");
  const $tabs  = document.getElementById("tabs");

  // Мобильная кнопка + кастомный список
  const $catBtn       = document.getElementById("catBtn");
  const $catBtnText   = document.getElementById("catBtnText");
  const $catSheet     = document.getElementById("catSheet");
  const $catSheetList = document.getElementById("catSheetList");

  // === Корзина / заказ в памяти ===
  const order = (window.order = window.order || { items: [], comment: "" });
  let currentProduct = null;

  // Плейсхолдер 800×1000 под рамку 4:5
  const PLACEHOLDER =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 1000'>
        <rect width='100%' height='100%' fill='#111'/>
        <text x='50%' y='50%' dy='.35em' text-anchor='middle'
              font-family='system-ui,-apple-system,Segoe UI,Roboto'
              font-size='36' fill='#777'>Фото</text>
      </svg>`
    );

  // === 1.5) МОДАЛКА — статическая из index.html ===
  const $pm       = document.getElementById('productModal');
  const $pmImg    = document.getElementById('pm_photo');
  const $pmTitle  = document.getElementById('pm_title');
  const $pmSku    = document.getElementById('pm_sku');
  const $pmPrice  = document.getElementById('pm_price');
  const $pmDesc   = document.getElementById('pm_desc');

  // Новые элементы
  const $pmComment = document.getElementById('pm_comment');
  const $pmAdd     = document.getElementById('pm_add');
  const $pmSubmit  = document.getElementById('pm_submit');

  function openModal(product) {
    if (!$pm) return;

    currentProduct = product || null;

    const photo = (product.photo || '').trim() || PLACEHOLDER;
    if ($pmImg) {
      $pmImg.src = photo;
      $pmImg.alt = product.title || 'Фото';
    }
    if ($pmTitle) $pmTitle.textContent = product.title || '';
    if ($pmSku)   $pmSku.textContent   = product.id ? String(product.id) : '';
    if ($pmPrice) $pmPrice.textContent = fmtPrice(product.price);
    if ($pmDesc)  $pmDesc.textContent  = product.desc ? String(product.desc) : '';

    // Комментарий общий на весь заказ
    if ($pmComment) $pmComment.value = order.comment || '';

    // Состояние кнопки "Добавить"
    const already = order.items.find(x => String(x.id) === String(product.id));
    if ($pmAdd){
      $pmAdd.textContent = already ? 'В корзине' : 'Добавить';
      $pmAdd.disabled = !!already;
    }

    $pm.classList.add('open');
    document.body.style.overflow = 'hidden';
    try { tg?.HapticFeedback?.selectionChanged(); } catch {}
  }

  function closeModal() {
    if (!$pm) return;
    $pm.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Закрытия (крестик/кнопка/фон/Escape)
  if ($pm) {
    document.querySelectorAll('[data-close="pm"]').forEach(el => {
      el.addEventListener('click', closeModal);
    });
    const $backdrop = $pm.querySelector('.modal__backdrop');
    if ($backdrop) $backdrop.addEventListener('click', closeModal);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $pm.classList.contains('open')) closeModal();
    });
  }

  // Обработчики заказа
  $pmComment?.addEventListener('input', (e)=>{
    order.comment = String(e.target.value || '').slice(0, 800);
  });

  $pmAdd?.addEventListener('click', ()=>{
    if (!currentProduct) return;
    const exists = order.items.find(x => String(x.id) === String(currentProduct.id));
    if (!exists){
      order.items.push({
        id: currentProduct.id,
        title: currentProduct.title,
        price: Number(currentProduct.price || 0),
        qty: 1
      });
      $pmAdd.textContent = 'В корзине';
      $pmAdd.disabled = true;
      try { tg?.HapticFeedback?.impactOccurred('light'); } catch {}
    }
  });

  $pmSubmit?.addEventListener('click', ()=>{
    if (!order.items.length){
      // Подсветим кнопку и не отправляем пустой заказ
      $pmSubmit.classList.add('shake');
      setTimeout(()=> $pmSubmit.classList.remove('shake'), 350);
      return;
    }
    const total = order.items.reduce((s, it)=> s + (Number(it.price||0) * Number(it.qty||1)), 0);

    const payload = {
      items: order.items.map(({id,title,price,qty})=>({id,title,price,qty})),
      comment: order.comment || '',
      total,
      ts: Date.now(),
      user: tg?.initDataUnsafe?.user ? {
        id: tg.initDataUnsafe.user.id,
        username: tg.initDataUnsafe.user.username || '',
        name: [tg.initDataUnsafe.user.first_name, tg.initDataUnsafe.user.last_name].filter(Boolean).join(' ')
      } : {}
    };

    try {
      if (tg?.sendData){
        tg.sendData(JSON.stringify(payload));
        try { tg?.HapticFeedback?.notificationOccurred('success'); } catch {}
        // Можно сразу закрыть WebApp — покупатель вернётся в чат
        setTimeout(()=> tg.close?.(), 50);
      } else {
        // Фолбэк вне Telegram — просто покажем JSON
        alert('Отправка заказа доступна внутри Telegram.\n\n' + JSON.stringify(payload, null, 2));
      }
    } catch {
      alert('Не удалось отправить заказ. Попробуйте ещё раз.');
    }
  });

  // === 1.6) Делегирование кликов по кнопке "Открыть" в карточках ===
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.card .btn');
    if (!btn) return;

    e.preventDefault();
    const card = btn.closest('.card');
    const id = card?.dataset?.id;

    const list = (window.state?.filtered && window.state.filtered.length)
      ? window.state.filtered
      : (window.state?.products || []);

    let product = id ? list.find(p => String(p.id) === String(id)) : null;

    if (!product) {
      const title = card.querySelector('.title')?.textContent?.trim();
      product = list.find(p => p.title === title) || null;
    }
    if (product) openModal(product);
  });

  // === 2) Универсальная загрузка: Railway → fallback JSON
  async function getJSON(localPath, apiPath) {
    try {
      const r = await fetch(`${API_BASE}${apiPath}?v=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`API ${r.status}`);
      return await r.json();
    } catch {
      const r = await fetch(`${localPath}?v=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`LOCAL ${r.status}`);
      return await r.json();
    }
  }
  const toItems = (data) => (Array.isArray(data?.items) ? data.items : []);

  // === 3) Стартовая загрузка
  Promise.all([
    getJSON("./data/products.json",   "/catalog/products"),
    getJSON("./data/categories.json", "/catalog/categories")
  ]).then(([prodsData, catsData]) => {
    const products   = toItems(prodsData);
    const categories = toItems(catsData);

    window.state = { products, filtered: [] };

    let activeCat = "Все";
    renderTabs(categories, activeCat, onChangeCat);
    renderMobilePicker(categories, activeCat, onChangeCat);
    renderList(products, activeCat);

    function onChangeCat(title) {
      activeCat = title;
      renderTabs(categories, activeCat, onChangeCat);
      renderMobilePicker(categories, activeCat, onChangeCat);
      renderList(products, activeCat);
    }
  }).catch((e) => {
    console.error("Loading failed:", e);
    $grid.innerHTML = `<div class="empty">Не удалось загрузить каталог. Попробуйте обновить страницу.</div>`;
  });

  // === 4) Рендер вкладок (чипы для планшет/десктоп)
  function renderTabs(categories, activeCat, onClick) {
    $tabs.innerHTML = "";

    const seen = new Set(["Все"]);
    const tabs = [{ title: "Все" }, ...categories.filter(c => {
      const t = (c.title || "").trim();
      if (!t || seen.has(t)) return false;
      seen.add(t);
      return true;
    })];

    tabs.forEach((c) => {
      const b = document.createElement("button");
      b.className = "tab" + (c.title === activeCat ? " active" : "");
      b.textContent = c.title;
      b.onclick = () => onClick(c.title);
      $tabs.appendChild(b);
    });

    const activeEl = $tabs.querySelector('.tab.active');
    activeEl?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
  }

  // === 4.1) Мобильный пикер: кнопка + bottom-sheet
  function renderMobilePicker(categories, activeCat, onPick) {
    if (!$catBtn || !$catBtnText || !$catSheet || !$catSheetList) return;

    const seen = new Set(["Все"]);
    const list = [{ title: "Все" }, ...categories.filter(c => {
      const t = (c.title || "").trim();
      if (!t || seen.has(t)) return false;
      seen.add(t);
      return true;
    })];

    $catBtnText.textContent = activeCat;

    $catSheetList.innerHTML = "";
    list.forEach(c => {
      const item = document.createElement('button');
      item.type = "button";
      item.className = 'sheet__item' + (c.title === activeCat ? ' active' : '');
      item.textContent = c.title;
      item.onclick = () => {
        closeSheet();
        onPick(c.title);
        try { tg?.HapticFeedback?.selectionChanged(); } catch {}
      };
      $catSheetList.appendChild(item);
    });

    $catBtn.onclick = openSheet;
    const $backdrop = $catSheet.querySelector('.sheet__backdrop');
    $backdrop.onclick = closeSheet;
  }

  function openSheet()  { $catSheet.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  function closeSheet() { $catSheet.classList.add('hidden');   document.body.style.overflow = '';       }

  // === 5) Рендер карточек
  function renderList(products, activeCat) {
    $grid.innerHTML = "";

    const list = products.filter(
      (p) => activeCat === "Все" || p.category === activeCat
    );

    window.state.filtered = list;

    if (list.length === 0) {
      $grid.innerHTML =
        `<div class="empty">Тут пока пусто. Добавьте товары в <code>data/products.json</code>.</div>`;
      return;
    }

    list.forEach((it) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = it.id;

      const photo = it.photo?.trim() || PLACEHOLDER;

      card.innerHTML = `
        <div class="media">
          <img
            class="photo"
            src="${photo}"
            alt="${escapeHTML(it.title || 'Фото')}"
            loading="lazy"
            decoding="async"
            width="800"
            height="1000"
          >
        </div>
        <div class="info">
          <div class="title">${escapeHTML(it.title || "")}</div>
          <div class="sku">${escapeHTML(it.id || "")}</div>
          <div class="price">${fmtPrice(it.price)} ₽</div>
        </div>
        <button class="btn">Открыть</button>
      `;

      $grid.appendChild(card);
    });
  }

  // === helpers
  function fmtPrice(v) {
    const n = Number(v || 0);
    return n.toLocaleString("ru-RU");
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
  }
})();
