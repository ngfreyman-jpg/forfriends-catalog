(function () {
  // Инициализация Telegram WebApp (без падения вне телеги)
  const tg = window.Telegram?.WebApp;
  try { tg?.ready(); tg?.expand(); } catch (e) {}

  const $grid = document.getElementById("grid");
  const $tabs = document.getElementById("tabs");

  // Встроенный плейсхолдер, чтобы не ходить на внешние домены
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

  // Утилита загрузки JSON (возвращает массив items[] или [])
  async function load(path) {
    try {
      const r = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return Array.isArray(data?.items) ? data.items : [];
    } catch (e) {
      console.error("load failed:", path, e);
      return [];
    }
  }

  // Загружаем данные
  Promise.all([
    load("./data/products.json"),
    load("./data/categories.json")
  ]).then(([products, categories]) => {
    // Категория по умолчанию
    let activeCat = categories[0]?.title || "Все";

    renderTabs(categories, activeCat, onTabClick);
    renderList(products, activeCat);

    function onTabClick(title) {
      activeCat = title;
      renderTabs(categories, activeCat, onTabClick);
      renderList(products, activeCat);
    }
  });

  // Рендер вкладок
  function renderTabs(categories, activeCat, onClick) {
    $tabs.innerHTML = "";
    const all = [{ title: "Все" }, ...categories];

    all.forEach((c) => {
      const b = document.createElement("button");
      b.className = "tab" + (c.title === activeCat ? " active" : "");
      b.textContent = c.title;
      b.onclick = () => onClick(c.title);
      $tabs.appendChild(b);
    });
  }

  // Рендер карточек
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

      const photo =
        it.photo && it.photo.trim() ? it.photo.trim() : PLACEHOLDER;

      card.innerHTML = `
        <img class="photo" src="${photo}" alt="">
        <div class="info">
          <div class="title">${escapeHTML(it.title || "")}</div>
          <div class="sku">${escapeHTML(it.id || "")}</div>
          <div class="price">${fmtPrice(it.price)} ₽</div>
        </div>
        <button class="btn">Открыть</button>
      `;

      card.querySelector(".btn").onclick = () => {
        const link = it.link && it.link.trim() ? it.link.trim() : "";
        if (link) {
          window.open(link, "_blank");
          try { tg?.HapticFeedback?.impactOccurred("light"); } catch (e) {}
        }
      };

      $grid.appendChild(card);
    });
  }

  // helpers
  function fmtPrice(v) {
    const n = Number(v || 0);
    return n.toLocaleString("ru-RU");
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m]));
  }
})();
