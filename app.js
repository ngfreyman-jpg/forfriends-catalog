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

  // === 1.5) МОДАЛКА — создаём при первом использовании ===
  let modalCreated = false;
  let $modal, $modalCard, $mImg, $mTitle, $mSku, $mPrice, $mDesc, $mLink, $mClose;

  function ensureModal() {
    if (modalCreated) return;

    const wrap = document.createElement('div');
    wrap.id = 'modal';
    wrap.className = 'modal hidden';
    wrap.innerHTML = `
      <div class="modal__backdrop"></div>
      <div class="modal__card" role="dialog" aria-modal="true">
        <button class="modal__close" aria-label="Закрыть">×</button>
        <div class="modal__media">
          <img id="mImg" alt="Фото" width="320" height="400" loading="lazy" decoding="async">
        </div>
        <div class="modal__info">
          <div id="mTitle" class="modal__title"></div>
          <div id="mSku"   class="modal__sku"></div>
          <div id="mPrice" class="modal__price"></div>
          <div id="mDesc"  class="modal__desc"></div>
        </div>
        <div class="modal__actions">
          <button id="mLink"   class="btn btn--primary">Перейти по ссылке</button>
          <button id="mClose2" class="btn">Закрыть</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    // кэширую элементы
    $modal     = wrap;
    $modalCard = wrap.querySelector('.modal__card');
    $mImg      = wrap.querySelector('#mImg');
    $mTitle    = wrap.querySelector('#mTitle');
    $mSku      = wrap.querySelector('#mSku');
    $mPrice    = wrap.querySelector('#mPrice');
    $mDesc     = wrap.querySelector('#mDesc');
    $mLink     = wrap.querySelector('#mLink');
    $mClose    = wrap.querySelector('.modal__close');

    // закрытия
    wrap.querySelector('.modal__backdrop').onclick = closeModal;
    $mClose.onclick = closeModal;
    wrap.querySelector('#mClose2').onclick = closeModal;
    document.addEventListener('keydown', (e) => {
      if (!$modal || $modal.classList.contains('hidden')) return;
      if (e.key === 'Escape') closeModal();
    });

    modalCreated = true;
  }

  function openModal(product) {
    ensureModal();

    const photo = product.photo?.trim() || PLACEHOLDER;
    $mImg.src = photo;
    $mImg.alt = product.title || 'Фото';

    $mTitle.textContent = product.title || '';
    $mSku.textContent   = product.id ? String(product.id) : '';
    $mPrice.textContent = `${fmtPrice(product.price)} ₽`;
    $mDesc.textContent  = product.desc ? String(product.desc) : '';

    const link = product.link?.trim();
    if (link) {
      $mLink.style.display = '';
      $mLink.onclick = () => {
        window.open(link, '_blank');
        try { tg?.HapticFeedback?.impactOccurred('light'); } catch {}
      };
    } else {
      $mLink.style.display = 'none';
      $mLink.onclick = null;
    }

    $modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    try { tg?.HapticFeedback?.selectionChanged(); } catch {}
  }

  function closeModal() {
    if ($modal) {
      $modal.classList.add('hidden');
      document.body.style.overflow = '';
    }
  }

  // === 1.6) Делегирование кликов по кнопке "Открыть" в карточках ===
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.card .btn');
    if (!btn) return;

    e.preventDefault();
    const card = btn.closest('.card');
    const id = card?.dataset?.id;

    // текущий набор товаров: отфильтрованный или весь
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

    // сохраним в window.state для делегирования
    window.state = { products, filtered: [] };

    // Всегда стартуем с «Все»
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

  // === 5) Рендер карточек (lazy + фикс 4:5 через .media)
  function renderList(products, activeCat) {
    $grid.innerHTML = "";

    const list = products.filter(
      (p) => activeCat === "Все" || p.category === activeCat
    );

    // сохраним текущую выборку для делегирования
    window.state.filtered = list;

    if (list.length === 0) {
      $grid.innerHTML =
        `<div class="empty">Тут пока пусто. Добавьте товары в <code>data/products.json</code>.</div>`;
      return;
    }

    list.forEach((it) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = it.id; // ← ВАЖНО: привязка карточки к товару

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

      // Локальный обработчик уже не обязателен, но не мешает:
      // card.querySelector(".btn").onclick = () => openModal(it);

      $grid.appendChild(card);
    });
  }

  // === 6) helpers
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
