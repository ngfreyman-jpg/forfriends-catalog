/* ForFriends — каталог с корзиной (отправка из корзины)
   Требуемая структура данных:
   - ./catalog/categories.json: ["Все","категория1","категория2",...]
   - ./catalog/products.json: [{id,title,price,category,photo,desc}]
*/

(() => {
  const tg = window.Telegram?.WebApp;
  if (tg?.expand) try { tg.expand(); } catch {}

  // ---------- Helpers ----------
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => [...r.querySelectorAll(s)];
  const fmt = n => (n||0).toLocaleString('ru-RU');

  const CART_KEY = 'ff_cart_v2';

  const state = {
    categories: [],
    products: [],
    filter: 'Все',
    cart: loadCart(),            // [{id, title, price, qty, comment?}]
    current: null                // выбранный товар
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
    const qty = state.cart.reduce((s,i)=>s+i.qty,0);
    const sum = state.cart.reduce((s,i)=>s+i.price*i.qty,0);
    return {qty, sum};
  }

  // ---------- Рендер категорий ----------
  const tabs = qs('#tabs');
  function renderCategories() {
    tabs.innerHTML = '';
    const cats = ['Все', ...state.categories.filter(Boolean)];
    cats.forEach(cat => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab' + (state.filter === cat ? ' active' : '');
      b.textContent = cat;
      b.addEventListener('click', () => {
        state.filter = cat;
        renderGrid();
      });
      tabs.appendChild(b);
    });
  }

  // ---------- Рендер сетки ----------
  const grid = qs('#grid');
  function renderGrid() {
    grid.innerHTML = '';
    const items = state.products.filter(p => state.filter === 'Все' || p.category === state.filter);
    if (!items.length) {
      grid.innerHTML = `<div class="empty">В этой категории пока пусто</div>`;
      return;
    }
    for (const p of items) {
      const card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `
        <div class="media"><img class="photo" src="${p.photo || ''}" alt=""></div>
        <div class="info">
          <div class="title">${p.title || ''}</div>
          <div class="sku">${p.id || ''}</div>
          <div class="price">${fmt(p.price)} ₽</div>
        </div>
        <button class="btn" type="button">Открыть</button>
      `;
      card.querySelector('.btn').addEventListener('click', () => openProduct(p));
      grid.appendChild(card);
    }
  }

  // ---------- Модалка товара ----------
  const modal = qs('#productModal');
  const pm = {
    photo: qs('#pm_photo'),
    title: qs('#pm_title'),
    sku:   qs('#pm_sku'),
    price: qs('#pm_price'),
    desc:  qs('#pm_desc'),
    comment: qs('#pm_comment'),
    add:   qs('#pm_add'),
    back:  qs('#pm_back'),
    panel: qs('#pm_panel')
  };

  function openProduct(p) {
    state.current = p;
    pm.photo.src = p.photo || '';
    pm.title.textContent = p.title || '';
    pm.sku.textContent = p.id || '';
    pm.price.textContent = fmt(p.price || 0);
    pm.desc.textContent = p.desc || '';
    pm.comment.value = '';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    pm.panel.focus();
  }
  function closeProduct() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    state.current = null;
  }
  qsa('[data-close="pm"]', modal).forEach(el => el.addEventListener('click', closeProduct));

  pm.back.addEventListener('click', closeProduct);
  pm.add.addEventListener('click', () => {
    const p = state.current;
    if (!p) return;
    const inCart = state.cart.find(i => i.id === p.id);
    if (inCart) inCart.qty += 1;
    else state.cart.push({ id:p.id, title:p.title, price:+p.price||0, qty:1 });
    // позиционный комментарий из модалки — сохраним, если есть:
    const c = pm.comment.value.trim();
    if (c) state.cart.find(i=>i.id===p.id).comment = c;

    saveCart();
    // короткая вибрация в Telegram WebApp
    try { tg.HapticFeedback?.impactOccurred?.('light'); } catch {}
    pm.add.classList.add('shake');
    setTimeout(()=>pm.add.classList.remove('shake'), 300);
  });

  // ---------- FAB корзины ----------
  const cartBtn = qs('#cartBtn');
  function updateCartFab() {
    const {qty,sum} = cartTotals();
    cartBtn.textContent = `🛒 Корзина (${qty}) • ${fmt(sum)} ₽`;
  }
  updateCartFab();

  // ---------- Оверлей корзины ----------
  const cartSheet = qs('#cartSheet');
  const cartList  = qs('#cartList');
  const cartClose = qs('#cartClose');
  const cartTotal = qs('#cartTotal');
  const cartSend  = qs('#cartSend');
  const cartComment = qs('#cartComment');

  cartBtn.addEventListener('click', () => {
    renderCart();
    cartSheet.setAttribute('aria-hidden','false');
  });
  cartClose.addEventListener('click', () => {
    cartSheet.setAttribute('aria-hidden','true');
  });
  cartSheet.addEventListener('click', (e)=>{
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
    const {sum} = cartTotals();
    cartTotal.textContent = `${fmt(sum)} ₽`;
    cartSend.disabled = !state.cart.length;
  }

  // ---------- Отправка заказа продавцу ----------
  cartSend.addEventListener('click', () => {
    if (!state.cart.length) return;

    const brief = state.cart.map(i => ({
      id: i.id, title: i.title, price: i.price, qty: i.qty
    }));
    const payload = {
      items: brief,
      total: cartTotals().sum,
      comment: cartComment.value.trim() || '',
      ts: Date.now()
    };

    try {
      tg?.sendData(JSON.stringify(payload));
      // визуальный ответ
      alert('✅ Заказ отправлен. Проверьте ЛС бота.');
      // очищаем корзину и закрываем
      state.cart = [];
      saveCart();
      renderCart();
      cartSheet.setAttribute('aria-hidden','true');
      // tg.close(); // если нужно закрывать сразу
    } catch (err) {
      console.error(err);
      alert('Не удалось отправить заказ. Попробуйте ещё раз.');
    }
  });

  // ---------- Загрузка данных каталога ----------
  async function fetchJSON(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  async function boot() {
    try {
      const [cats, prods] = await Promise.all([
        fetchJSON('./catalog/categories.json'),
        fetchJSON('./catalog/products.json')
      ]);
      state.categories = Array.isArray(cats) ? cats : [];
      state.products   = Array.isArray(prods) ? prods : [];
      if (!state.categories.includes('Все')) state.categories.unshift('Все');
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
