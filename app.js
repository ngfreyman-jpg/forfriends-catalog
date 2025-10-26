/* ForFriends — каталог с корзиной (отправка из корзины)
   ПАТЧ: категории рендерим в двух вариантах:
   - десктопные табы (#catTabs / #tabs)
   - мобильный <select id="catSelect">
   Выбор синхронизирован в обе стороны.

   ДАННЫЕ:
   - ./data/categories.json  -> ["Все","Категория 1", ...] ИЛИ {items:[...]} ИЛИ массив объектов {name|title}
   - ./data/products.json    -> [{id,title,price,category,photo,desc}] ИЛИ {items:[...]}
   Fallback: если в ./data нет, пробуем ./catalog (на случай старой структуры).
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
    categories: [],       // уже содержит "Все" один раз
    products: [],
    filter: 'Все',
    cart: loadCart(),     // [{id,title,price,qty,comment?}]
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

  // ===== Categories (tabs + select) =====
  const tabs      = qs('#catTabs') || qs('#tabs');  // поддержка старого id
  const catSelect = qs('#catSelect');

  function syncCategoryUI() {
    // активная кнопка в табах
    if (tabs) {
      qsa('.tab', tabs).forEach(b => {
        const active = b.dataset.cat === state.filter;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    // выбранное значение в <select>
    if (catSelect && catSelect.value !== state.filter) {
      // если по какой-то причине нет опции — добавим
      const exist = [...catSelect.options].some(o => o.value === state.filter);
      if (!exist) catSelect.add(new Option(state.filter, state.filter));
      catSelect.value = state.filter;
    }
  }

  function renderCategories() {
    const cats = [...state.categories]; // уже без дублей и с "Все" один раз

    // Табы
    if (tabs) {
      tabs.innerHTML = '';
      for (const cat of cats) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tab';
        b.dataset.cat = cat;
        b.textContent = cat;
        b.addEventListener('click', () => {
          state.filter = cat;
          syncCategoryUI();
          renderGrid();
        });
        tabs.appendChild(b);
      }
    }

    // Select
    if (catSelect) {
      catSelect.innerHTML = '';
      for (const cat of cats) catSelect.add(new Option(cat, cat));
      // чтобы не плодить листенеры, снимаем старый и навешиваем заново через onChange
      catSelect.onchange = (e) => {
        state.filter = e.target.value;
        syncCategoryUI();
        renderGrid();
      };
    }

    syncCategoryUI();
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
      // подстраховка по изображениям
      const img = card.querySelector('.photo');
      img.addEventListener('error', () => { img.style.opacity = '0'; });

      // кликается ТОЛЬКО кнопка
      const btn = card.querySelector('.btn');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openProduct(p);
      });

      grid.appendChild(card);
    }
  }

  // ===== Product modal =====
  const modal = document.getElementById('productModal');
  const pm = {
    photo:   modal.querySelector('#pm_photo'),
    title:   modal.querySelector('#pm_title'),
    sku:     modal.querySelector('#pm_sku'),
    price:   modal.querySelector('#pm_price'),
    desc:    modal.querySelector('#pm_desc'),     // может отсутствовать — это ок
    comment: modal.querySelector('#pm_comment'),
    add:     modal.querySelector('#pm_add'),
    back:    modal.querySelector('#pm_back'),
    panel:   modal.querySelector('#pm_panel'),
  };

  function openProduct(p) {
    state.current = p;
    if (pm.photo) pm.photo.src = p.photo || '';
    if (pm.title) pm.title.textContent = p.title || '';
    if (pm.sku)   pm.sku.textContent   = p.id ?? '';
    if (pm.price) pm.price.textContent = fmt(p.price || 0);
    if (pm.desc)  pm.desc.textContent  = p.desc || '';
    if (pm.comment) pm.comment.value   = '';

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

    const c = pm.comment?.value?.trim();
    if (c) (state.cart.find(i=>i.id===p.id) || {}).comment = c;

    saveCart();
    try { tg?.HapticFeedback?.impactOccurred?.('light'); } catch {}
    pm.add?.classList.add('shake'); setTimeout(()=>pm.add?.classList.remove('shake'), 300);
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
    const list = [...set];
    // гарантируем "Все" один раз
    if (!list.includes('Все')) list.unshift('Все');
    return list;
  }

  function normalizeProducts(raw) {
    let arr = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [];
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
      // валидируем выбранный фильтр
      if (!state.categories.includes(state.filter)) state.filter = 'Все';

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
