/* ForFriends — каталог с корзиной (отправка из корзины)
   ДАННЫЕ: поддерживаются варианты
   - ./data/categories.json            -> ["Все","Категория 1", ...] ИЛИ {items:[...]} ИЛИ массив объектов {name|title}
   - ./data/products.json              -> [{id,title,price,category,photo,desc}] ИЛИ {items:[...]}
   Fallback: если в ./data нет, берём из ./catalog (на случай старой структуры).
*/

(() => {
  // ===== Telegram WebApp =====
  const tg = window.Telegram?.WebApp;
  try { tg?.expand?.(); } catch {}

  // ===== Helpers =====
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => [...r.querySelectorAll(s)];
  const fmt = n => (Number(n)||0).toLocaleString('ru-RU');

  const CART_KEY = 'ff_cart_v2';

  const state = {
    categories: [],
    products: [],
    filter: 'Все',
    cart: loadCart(),   // [{id,title,price,qty,comment?}]
    current: null
  };

  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    updateCartFab();
  }
  function loadCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
    catch { return []; }
  }
  function cartTotals() {
    const qty = state.cart.reduce((s,i)=>s + (Number(i.qty)||0), 0);
    const sum = state.cart.reduce((s,i)=>s + (Number(i.price)||0)*(Number(i.qty)||0), 0);
    return {qty, sum};
  }

  // ===== Categories render =====
  const tabs = qs('#tabs');
  function renderCategories() {
    tabs.innerHTML = '';
    const cats = ['Все', ...state.categories.filter(Boolean)];
    for (const cat of cats) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab' + (state.filter===cat ? ' active' : '');
      b.textContent = cat;
      b.addEventListener('click', () => { state.filter = cat; renderGrid(); });
      tabs.appendChild(b);
    }
  }

  // ===== Grid render =====
  const grid = qs('#grid');
  function renderGrid() {
    grid.innerHTML = '';
    const items = state.products.filter(p => state.filter==='Все' || p.category===state.filter);
    if (!items.length) {
      grid.innerHTML = `<div class="empty">В этой категории пока пусто</div>`;
      return;
    }
    for (const p of items) {
      const card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `
        <div class="media">
          <img class="photo" src="${p.photo || ''}" alt="">
        </div>
        <div class="info">
          <div class="title">${p.title || ''}</div>
          <div class="sku">${p.id ?? ''}</div>
          <div class="price">${fmt(p.price)} ₽</div>
        </div>
        <button class="btn" type="button">Открыть</button>
      `;
      card.querySelector('.btn').addEventListener('click', () => openProduct(p));
      grid.appendChild(card);
    }
  }

  // ===== Product modal =====
  const modal = qs('#productModal');
  const pm = {
    photo:   qs('#pm_photo'),
    title:   qs('#pm_title'),
    sku:     qs('#pm_sku'),
    price:   qs('#pm_price'),
    desc:    qs('#pm_desc'),
    comment: qs('#pm_comment'),
    add:     qs('#pm_add'),
    back:    qs('#pm_back'),
    panel:   qs('#pm_panel'),
  };

  function openProduct(p) {
    state.current = p;
    pm.photo.src = p.photo || '';
    pm.title.textContent = p.title || '';
    pm.sku.textContent   = p.id ?? '';
    pm.price.textContent = fmt(p.price || 0);
    pm.desc.textContent  = p.desc || '';
    pm.comment.value     = '';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    pm.panel?.focus?.();
  }
  function closeProduct() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
    state.current = null;
  }
  qsa('[data-close="pm"]', modal).forEach(el => el.addEventListener('click', closeProduct));
  pm.back?.addEventListener('click', closeProduct);

  pm.add?.addEventListener('click', () => {
    const p = state.current;
    if (!p) return;
    const found = state.cart.find(i => i.id === p.id);
    if (found) found.qty += 1;
    else state.cart.push({ id: p.id, title: p.title, price: Number(p.price)||0, qty: 1 });

    const c = pm.comment.value.trim();
    if (c) (state.cart.find(i=>i.id===p.id) || {}).comment = c;

    saveCart();
    try { tg?.HapticFeedback?.impactOccurred?.('light'); } catch {}
    pm.add.classList.add('shake'); setTimeout(()=>pm.add.classList.remove('shake'), 300);
  });

  // ===== Cart FAB & sheet =====
  const cartBtn     = qs('#cartBtn');
  const cartSheet   = qs('#cartSheet');
  const cartList    = qs('#cartList');
  const cartClose   = qs('#cartClose');
  const cartTotal   = qs('#cartTotal');
  const cartSend    = qs('#cartSend');
  const cartComment = qs('#cartComment');

  function updateCartFab() {
    const {qty,sum} = cartTotals();
    if (cartBtn) cartBtn.textContent = `🛒 Корзина (${qty}) • ${fmt(sum)} ₽`;
  }
  updateCartFab();

  cartBtn?.addEventListener('click', () => {
    renderCart();
    cartSheet?.setAttribute('aria-hidden','false');
  });
  cartClose?.addEventListener('click', () => {
    cartSheet?.setAttribute('aria-hidden','true');
  });
  cartSheet?.addEventListener('click', (e)=>{
    if (e.target === cartSheet) cartSheet.setAttribute('aria-hidden','true');
  });

  function renderCart() {
    cartList.innerHTML = '';
    if (!state.cart.length) {
      cartList.innerHTML = `<div class="empty">Корзина пуста</div>`;
      cartSend.disabled = true;
      cartTotal.textContent = '0 ₽';
      return;
    }
    for (const item of state.cart) {
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div>
          <div class="cart-item__title">${item.title}</div>
          <div class="cart-item__meta">${item.id} • ${fmt(item.price)} ₽${item.comment ? ` • ${item.comment}`:''}</div>
        </div>
        <div class="cart-item__controls">
          <button class="cart-btn" data-act="dec">–</button>
          <span class="cart-qty">${item.qty}</span>
          <button class="cart-btn" data-act="inc">+</button>
          <button class="cart-remove" data-act="rem">Удалить</button>
        </div>
      `;
      row.querySelector('[data-act="inc"]').addEventListener('click', ()=>{ item.qty++; saveCart(); renderCart(); });
      row.querySelector('[data-act="dec"]').addEventListener('click', ()=>{
        item.qty = Math.max(1, item.qty-1); saveCart(); renderCart();
      });
      row.querySelector('[data-act="rem"]').addEventListener('click', ()=>{
        state.cart = state.cart.filter(x=>x.id!==item.id); saveCart(); renderCart();
      });
      cartList.appendChild(row);
    }
    cartSend.disabled = false;
    cartTotal.textContent = `${fmt(cartTotals().sum)} ₽`;
  }

  cartSend?.addEventListener('click', () => {
    if (!state.cart.length) return;

    const brief = state.cart.map(i => ({
      id: i.id, title: i.title, price: Number(i.price)||0, qty: Number(i.qty)||0
    }));
    const payload = {
      items: brief,
      total: cartTotals().sum,
      comment: cartComment?.value?.trim() || '',
      ts: Date.now()
    };

    try {
      tg?.sendData(JSON.stringify(payload));
      alert('✅ Заказ отправлен. Проверьте ЛС бота.');
      state.cart = [];
      saveCart();
      renderCart();
      cartSheet?.setAttribute('aria-hidden','true');
      // tg.close(); // если нужно закрывать сразу
    } catch (err) {
      console.error(err);
      alert('Не удалось отправить заказ. Попробуйте ещё раз.');
    }
  });

  // ===== Data loading =====
  async function fetchJSON(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  function normalizeCategories(raw) {
    if (!raw) return [];
    let arr = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [];
    // если это массив объектов — берём name/title
    if (arr.length && typeof arr[0] === 'object') {
      arr = arr.map(x => x?.name ?? x?.title).filter(Boolean);
    }
    // фильтр дублей/пустых
    const set = new Set(arr.map(String).filter(Boolean));
    return [...set];
  }

  function normalizeProducts(raw) {
    let arr = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [];
    // приводим к минимально необходимому виду
    arr = arr.map(x => ({
      id:      x.id ?? x.sku ?? '',
      title:   x.title ?? x.name ?? '',
      price:   Number(x.price) || 0,
      category:String(x.category ?? '') || 'Без категории',
      photo:   x.photo ?? x.image ?? '',
      desc:    x.desc ?? x.description ?? ''
    })).filter(p => p.id && p.title);
    return arr;
  }

  async function loadFrom(base) {
    const [catsRaw, prodsRaw] = await Promise.all([
      fetchJSON(`${base}/categories.json`),
      fetchJSON(`${base}/products.json`)
    ]);
    return { cats: normalizeCategories(catsRaw), prods: normalizeProducts(prodsRaw) };
  }

  async function boot() {
    try {
      // Пытаемся из ./data, если нет — из ./catalog
      let cats = [], prods = [];
      try {
        ({cats, prods} = await loadFrom('./data'));
      } catch {
        ({cats, prods} = await loadFrom('./catalog'));
      }

      state.categories = cats;
      if (!state.categories.includes('Все')) state.categories.unshift('Все');

      state.products = prods;
      renderCategories();
      renderGrid();

      // глубокая ссылка ?id=SKU
      const pid = new URL(location.href).searchParams.get('id');
      if (pid) {
        const p = state.products.find(x => String(x.id) === String(pid));
        if (p) openProduct(p);
      }
    } catch (e) {
      console.error(e);
      grid.innerHTML = `<div class="empty">Не удалось загрузить каталог.</div>`;
    }
  }

  boot();
})();
