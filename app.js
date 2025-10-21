// Telegram init — безопасно и вне Telegram-клиента
const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); } catch (e) { /* ок вне Telegram */ }

const $grid = document.getElementById('grid');
const $tabs = document.getElementById('tabs');

// загрузка JSON: всегда вернёт массив items[] (или [])
function load(path) {
  return fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : { items: [] }))
    .then(d => (Array.isArray(d?.items) ? d.items : []))
    .catch(err => { console.error('load failed', path, err); return []; });
}

// Встроенный плейсхолдер для фото (не зависит от сети)
const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='1000'>
      <rect width='100%' height='100%' fill='#111'/>
      <text x='50%' y='50%' dy='.35em' text-anchor='middle'
            fill='#777' font-family='system-ui,-apple-system,Segoe UI,Roboto' font-size='48'>
        Фото
      </text>
    </svg>`
  );

// helpers
function fmtPrice(v) {
  const n = Number(v || 0);
  return n.toLocaleString('ru-RU');
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[m]));
}

// Старт: грузим товары и категории
Promise.all([
  load('./data/products.json'),
  load('./data/categories.json')
]).then(([products, categories]) => {
  let activeCat = categories
}
