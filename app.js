const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); } catch(e) { /* ок, вне Telegram */ }

const $grid = document.getElementById('grid');
const $tabs = document.getElementById('tabs');

// универсальная загрузка JSON (возвращает массив items[] либо [])
async function load(path) {
  try {
    const r = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch (e) {
    console.error('load failed:', path, e);
    return [];
  }
}

const [products, categories] = await Promise.all([
  load('./data/products.json'),
  load('./data/categories.json')
]);

let activeCat = categories[0]?.title || 'Все';

renderTabs();
renderList();

function renderTabs() {
  $tabs.innerHTML = '';
  const all = [{ title: 'Все' }, ...categories];

  all.forEach(c => {
    const b = document.createElement('button');
    b.className = 'tab' + (c.title === activeCat ? ' active' : '');
    b.textContent = c.title;
    b.onclick = () => { activeCat = c.title; renderTabs(); renderList(); };
    $tabs.appendChild(b);
  });
}

function renderList() {
  $grid.innerHTML = '';

  const list = products.filter(p => activeCat === 'Все' || p.category === activeCat);

  if (list.length === 0) {
    $grid.innerHTML = `<div class="empty">Тут пока пусто. Добавьте товары в <code>data/products.json</code>.</div>`;
    return;
  }

  list.forEach(it => {
    const card = document.createElement('div');
    card.className = 'card';

    const photo = (it.photo && it.photo.trim())
      ? it.photo
      : 'https://via.placeholder.com/800x1000/111/777?text=Фото';

    card.innerHTML = `
      <img class="photo" src="${photo}" alt="">
      <div class="info">
        <div class="title">${escapeHTML(it.title || '')}</div>
        <div class="sku">${escapeHTML(it.id || '')}</div>
        <div class="price">${fmtPrice(it.price)} ₽</div>
      </div>
      <button class="btn">Открыть</button>
    `;

    card.querySelector('.btn').onclick = () => {
      const link = (it.link && it.link.trim()) ? it.link.trim() : '';
      if (link) {
        window.open(link, '_blank');
        try { tg?.HapticFeedback?.impactOccurred('light'); } catch(e){}
      }
    };

    $grid.appendChild(card);
  });
}

// helpers
function fmtPrice(v) {
  const n = Number(v || 0);
  return n.toLocaleString('ru-RU');
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}
