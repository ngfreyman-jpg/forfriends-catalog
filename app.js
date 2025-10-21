const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Удобный загрузчик JSON
async function loadJson(path) {
  const r = await fetch(path, { cache: "no-store" });
  const data = await r.json();
  return data;
}

const grid = document.getElementById("grid");

// грузим данные
const productsRaw = await loadJson("./data/products.json");
const categoriesRaw = await loadJson("./data/categories.json");

// Нормализуем форматы на всякий случай
const items = Array.isArray(productsRaw) ? productsRaw : (productsRaw.items || []);
const catsArrRaw = Array.isArray(categoriesRaw) ? categoriesRaw : (categoriesRaw.items || []);

// Категории могут быть строками или объектами { title: "" }
const cats = catsArrRaw.map(c => typeof c === "string" ? c : (c?.title || "")).filter(Boolean);

// Активная категория по умолчанию
let activeCat = cats[0] || "Все";

function render() {
  grid.innerHTML = "";

  const data = items.filter(it => activeCat === "Все" || it.category === activeCat);

  data.forEach(it => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img class="photo" src="${it.photo || ""}" alt="${it.title || ""}" loading="lazy">
      <div class="info">
        <div class="price">${(it.price || 0).toLocaleString('ru-RU')} ₽</div>
        <div class="title">${it.title || ""}<br><small>${it.id || ""}</small></div>
      </div>
      <div class="btn primary">Открыть</div>
    `;

    card.querySelector(".btn").onclick = () => {
      const url = it.link
        || (tg.initDataUnsafe?.user?.username ? `https://t.me/${tg.initDataUnsafe.user.username}` : "#");
      if (url && url !== "#") window.open(url, "_blank");
      tg.HapticFeedback?.impactOccurred?.('light');
    };

    grid.appendChild(card);
  });
}

function renderTabs() {
  const header = document.querySelector("header");
  const oldTabs = document.getElementById("tabs");
  if (oldTabs) oldTabs.remove();

  const tabs = document.createElement("div");
  tabs.id = "tabs";
  tabs.className = "tabs";

  const all = ["Все", ...cats];
  all.forEach(c => {
    const el = document.createElement("button");
    el.className = "tab" + (c === activeCat ? " active" : "");
    el.textContent = c;
    el.onclick = () => {
      activeCat = c;
      renderTabs();
      render();
    };
    tabs.appendChild(el);
  });

  header.after(tabs);
}

renderTabs();
render();
