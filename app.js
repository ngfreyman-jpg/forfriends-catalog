(function () {
  const API_BASE = 'https://forfriends-sync-production.up.railway.app';

  const tg = window.Telegram?.WebApp;
  try{
    tg?.ready(); tg?.expand();
    tg?.setHeaderColor?.('#0c0e11'); tg?.setBackgroundColor?.('#0c0e11');
    tg?.onEvent?.('themeChanged', ()=>{ tg?.setHeaderColor?.('#0c0e11'); tg?.setBackgroundColor?.('#0c0e11'); });
  }catch{}

  const $grid  = document.getElementById("grid");
  const $tabs  = document.getElementById("tabs");

  // Mobile picker (мы уже внедряли)
  const $catBtn       = document.getElementById("catBtn");
  const $catBtnText   = document.getElementById("catBtnText");
  const $catSheet     = document.getElementById("catSheet");
  const $catSheetList = document.getElementById("catSheetList");

  // Product modal
  const $pm = document.getElementById('productModal');
  const $pmPhoto = document.getElementById('pm_photo');
  const $pmTitle = document.getElementById('pm_title');
  const $pmSku   = document.getElementById('pm_sku');
  const $pmPrice = document.getElementById('pm_price');
  const $pmDesc  = document.getElementById('pm_desc');
  const $pmMinus = document.getElementById('pm_minus');
  const $pmPlus  = document.getElementById('pm_plus');
  const $pmQty   = document.getElementById('pm_qty');
  const $pmAdd   = document.getElementById('pm_add');
  const $pmGo    = document.getElementById('pm_go');

  // Cart
  const $fab        = document.getElementById('cartFab');
  const $fabCount   = document.getElementById('cartCount');
  const $drawer     = document.getElementById('cartDrawer');
  const $cartList   = document.getElementById('cartList');
  const $cartTotal  = document.getElementById('cartTotal');
  const $cartClear  = document.getElementById('cartClear');
  const $cartClose  = document.getElementById('cartClose');
  const $cartCheckout = document.getElementById('cartCheckout');

  // Placeholder под фото
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

  // API fetch с fallback на локальные JSON
  async function getJSON(localPath, apiPath){
    try{
      const r = await fetch(`${API_BASE}${apiPath}?v=${Date.now()}`, { cache:'no-store' });
      if(!r.ok) throw new Error(`API ${r.status}`);
      return await r.json();
    }catch{
      const r = await fetch(`${localPath}?v=${Date.now()}`, { cache:'no-store' });
      if(!r.ok) throw new Error(`LOCAL ${r.status}`);
      return await r.json();
    }
  }
  const toItems = (d)=> Array.isArray(d?.items) ? d.items : [];

  // === CART state ===
  let CART = loadCart();
  function loadCart(){
    try{ return JSON.parse(localStorage.getItem('cart_v1')||'[]'); }catch{ return []; }
  }
  function saveCart(){
    localStorage.setItem('cart_v1', JSON.stringify(CART));
    renderCartBadge();
  }
  function addToCart(prod, qty){
    qty = Math.max(1, Number(qty||1));
    const ix = CART.findIndex(x=>x.id===prod.id);
    if(ix>=0){ CART[ix].qty += qty; }
    else{
      CART.push({ id: prod.id, title: prod.title||'', price: Number(prod.price||0), photo: prod.photo||'', sku: prod.id||'', qty });
    }
    saveCart();
    try{ tg?.HapticFeedback?.notificationOccurred('success'); }catch{}
  }
  function removeFromCart(id){
    CART = CART.filter(x=>x.id!==id);
    saveCart();
  }
  function setQty(id, qty){
    qty = Math.max(1, Number(qty||1));
    const it = CART.find(x=>x.id===id);
    if(it){ it.qty = qty; saveCart(); }
  }
  function calcTotal(){
    return CART.reduce((s,x)=> s + x.price * x.qty, 0);
  }
  function renderCartBadge(){
    const count = CART.reduce((s,x)=> s + x.qty, 0);
    if($fabCount) $fabCount.textContent = String(count);
  }

  // UI: open/close cart drawer
  function openCart(){
    $drawer?.classList.add('open'); document.body.style.overflow='hidden';
    renderCartDrawer();
  }
  function closeCart(){ $drawer?.classList.remove('open'); document.body.style.overflow=''; }

  function renderCartDrawer(){
    $cartList.innerHTML = '';
    if(CART.length===0){
      $cartList.innerHTML = `<div class="empty">Корзина пуста</div>`;
    }else{
      CART.forEach(it=>{
        const row = document.createElement('div');
        row.className='cart__item';
        const p = it.photo||PLACEHOLDER;
        row.innerHTML = `
          <img src="${p}" alt="">
          <div>
            <div class="cart__title">${escapeHTML(it.title)}</div>
            <div class="cart__sku">${escapeHTML(it.sku||it.id)}</div>
            <div class="cart__qty">
              <button class="btn-outline" data-act="dec" data-id="${it.id}" style="padding:6px 8px">–</button>
              <input type="number" min="1" value="${it.qty}" data-id="${it.id}">
              <button class="btn-outline" data-act="inc" data-id="${it.id}" style="padding:6px 8px">+</button>
            </div>
          </div>
          <div>
            <div class="cart__price">${fmtPrice(it.price)} ₽</div>
            <button class="cart__rm" data-act="rm" data-id="${it.id}">Убрать</button>
          </div>
        `;
        $cartList.appendChild(row);
      });
    }
    $cartTotal.textContent = `${fmtPrice(calcTotal())} ₽`;

    // events
    $cartList.querySelectorAll('button[data-act]').forEach(b=>{
      b.onclick = (e)=>{
        const id = b.getAttribute('data-id');
        const act = b.getAttribute('data-act');
        const item = CART.find(x=>x.id===id);
        if(!item) return;
        if(act==='dec'){ item.qty = Math.max(1, item.qty-1); }
        if(act==='inc'){ item.qty += 1; }
        if(act==='rm'){ removeFromCart(id); }
        saveCart(); renderCartDrawer();
      };
    });
    $cartList.querySelectorAll('input[type="number"]').forEach(inp=>{
      inp.onchange = ()=>{ setQty(inp.getAttribute('data-id'), Number(inp.value||1)); renderCartDrawer(); };
    });
  }

  // ====== PAGE INIT ======
  let ALL_PRODUCTS = [];
  Promise.all([
    getJSON("./data/products.json",   "/catalog/products"),
    getJSON("./data/categories.json", "/catalog/categories")
  ]).then(([prodsData, catsData])=>{
    const products   = toItems(prodsData);
    const categories = toItems(catsData);
    ALL_PRODUCTS = products;

    let activeCat = "Все";
    renderTabs(categories, activeCat, onChangeCat);
    renderMobilePicker(categories, activeCat, onChangeCat);
    renderList(products, activeCat);
    renderCartBadge();

    function onChangeCat(next){
      activeCat = next;
      renderTabs(categories, activeCat, onChangeCat);
      renderMobilePicker(categories, activeCat, onChangeCat);
      renderList(products, activeCat);
    }
  }).catch(e=>{
    console.error(e);
    $grid.innerHTML = `<div class="empty">Не удалось загрузить каталог. Обновите страницу.</div>`;
  });

  function renderTabs(categories, active, onClick){
    $tabs.innerHTML = "";
    const seen = new Set(["Все"]);
    const tabs = [{title:"Все"}, ...categories.filter(c=>{
      const t=(c.title||"").trim(); if(!t||seen.has(t)) return false; seen.add(t); return true;
    })];
    tabs.forEach(c=>{
      const b=document.createElement('button');
      b.className='tab' + (c.title===active?' active':'');
      b.textContent=c.title; b.onclick=()=>onClick(c.title);
      $tabs.appendChild(b);
    });
    $tabs.querySelector('.tab.active')?.scrollIntoView({behavior:'auto', inline:'center', block:'nearest'});
  }

  function renderMobilePicker(categories, active, onPick){
    if(!$catBtn || !$catBtnText || !$catSheet || !$catSheetList) return;
    const seen = new Set(["Все"]);
    const list = [{title:"Все"}, ...categories.filter(c=>{
      const t=(c.title||"").trim(); if(!t||seen.has(t)) return false; seen.add(t); return true;
    })];
    $catBtnText.textContent = active;
    $catSheetList.innerHTML = "";
    list.forEach(c=>{
      const item = document.createElement('button');
      item.type='button'; item.className='sheet__item' + (c.title===active?' active':''); item.textContent=c.title;
      item.onclick = ()=>{ closeSheet(); onPick(c.title); try{ tg?.HapticFeedback?.selectionChanged(); }catch{} };
      $catSheetList.appendChild(item);
    });
    $catBtn.onclick = openSheet;
    $catSheet.querySelector('.sheet__backdrop').onclick = closeSheet;
  }
  function openSheet(){ $catSheet?.classList.remove('hidden'); document.body.style.overflow='hidden'; }
  function closeSheet(){ $catSheet?.classList.add('hidden'); document.body.style.overflow=''; }

  // ====== список карточек ======
  function renderList(products, active){
    $grid.innerHTML = "";
    const list = products.filter(p => active==="Все" || p.category===active);
    if(!list.length){
      $grid.innerHTML = `<div class="empty">Тут пусто. Добавьте товары в <code>data/products.json</code>.</div>`;
      return;
    }
    list.forEach(it=>{
      const card=document.createElement('div'); card.className='card';
      const photo = (it.photo||'').trim() || PLACEHOLDER;
      card.innerHTML = `
        <div class="media">
          <img class="photo" src="${photo}" alt="${escapeHTML(it.title||'Фото')}"
               loading="lazy" decoding="async" width="800" height="1000">
        </div>
        <div class="info">
          <div class="title">${escapeHTML(it.title||"")}</div>
          <div class="sku">${escapeHTML(it.id||"")}</div>
          <div class="price">${fmtPrice(it.price)} ₽</div>
        </div>
        <button class="btn">Открыть</button>
      `;
      card.querySelector('.btn').onclick = ()=> openProduct(it);
      $grid.appendChild(card);
    });
  }

  // ====== Product modal ======
  let PM_PRODUCT = null;
  function openProduct(prod){
    PM_PRODUCT = prod;
    $pmPhoto.src = (prod.photo||'').trim() || PLACEHOLDER;
    $pmTitle.textContent = prod.title||'';
    $pmSku.textContent   = prod.id||'';
    $pmPrice.textContent = fmtPrice(prod.price||0);
    $pmDesc.textContent  = (prod.desc||'').trim() || '—';
    $pmQty.value = 1;
    $pm.classList.add('open'); document.body.style.overflow='hidden';
    try{ tg?.HapticFeedback?.impactOccurred('light'); }catch{}
  }
  function closeProduct(){ $pm.classList.remove('open'); document.body.style.overflow=''; }

  $pm?.addEventListener('click', (e)=>{
    const t = e.target;
    if(t?.dataset?.close === 'pm') closeProduct();
  });
  document.querySelectorAll('[data-close="pm"]').forEach(x=> x.onclick = closeProduct);
  $pmMinus.onclick = ()=> $pmQty.value = Math.max(1, Number($pmQty.value||1)-1);
  $pmPlus.onclick  = ()=> $pmQty.value = Math.max(1, Number($pmQty.value||1)+1);
  $pmAdd.onclick   = ()=>{
    if(!PM_PRODUCT) return;
    addToCart(PM_PRODUCT, Number($pmQty.value||1));
    renderCartBadge();
  };
  $pmGo.onclick    = ()=>{
    if(!PM_PRODUCT) return;
    addToCart(PM_PRODUCT, Number($pmQty.value||1));
    closeProduct(); openCart();
  };

  // ====== Cart events ======
  $fab.onclick = openCart;
  $cartClose.onclick = closeCart;
  $drawer?.addEventListener('click', (e)=>{
    const t = e.target;
    if(t?.dataset?.close === 'cart') closeCart();
  });
  $cartClear.onclick = ()=>{ CART = []; saveCart(); renderCartDrawer(); };
  $cartCheckout.onclick = ()=>{
    // TODO: оформление. Пока просто тост/вибра.
    try{ tg?.HapticFeedback?.notificationOccurred('success'); }catch{}
    alert('Оформление пока не подключено. Здесь можно вывести форму/ссылку.');
  };

  // ===== helpers =====
  function fmtPrice(v){ return Number(v||0).toLocaleString('ru-RU'); }
  function escapeHTML(s){
    return String(s).replace(/[&<>"']/g, (m)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
  }
})();
