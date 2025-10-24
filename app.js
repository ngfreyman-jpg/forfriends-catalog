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

  const $grid = document.getElementById("grid");
  const $tabs = document.getElementById("tabs");

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

    // Всегда стартуем с «Все»
    let activeCat = "Все";

    renderTabs(categories, activeCat, onTabClick);
    renderList(products, activeCat);

    function onTabClick(title) {
      activeCat = title;
      renderTabs(categories, activeCat, onTabClick);
      renderList(products, activeCat);
    }
  }).catch((e) => {
    console.error("Loading failed:", e);
    $grid.innerHTML = `<div class="empty">Не удалось загрузить каталог. Попробуйте обновить страницу.</div>`;
  });

  // === 4) Рендер вкладок
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
  }

  // === 5) Рендер карточек (lazy + фикс 4:5 через .media)
  function renderList(products, activeCat) {
    $grid.innerHTML = "";

    const list = products.filter(
      (p) => activeCat === "Все" || p.category === activeCat
    );

    if (list.length === 0) {
      $grid.innerHTML =
        `<div class="empty">Тут пока пусто. Добавьте товары в <code>data/products.json</code>.</div>`;
      return;
    }

    list.forEach((it) => {
      const card = document.createElement("div");
      card.className = "card";

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

      card.querySelector(".btn").onclick = () => {
        const link = it.link?.trim() || "";
        if (link) {
          window.open(link, "_blank");
          try { tg?.HapticFeedback?.impactOccurred("light"); } catch {}
        }
      };

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
