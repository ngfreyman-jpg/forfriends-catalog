(function () {
  const API_BASE = 'https://forfriends-sync-production.up.railway.app';

  // === Telegram WebApp init ===
  const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  try {
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor?.('#0c0e11');
    tg?.setBackgroundColor?.('#0c0e11');
    tg?.onEvent?.('themeChanged', () => {
      tg?.setHeaderColor?.('#0c0e11');
      tg?.setBackgroundColor?.('#0c0e11');
    });
    console.log('[TG] ready. user=', tg?.initDataUnsafe?.user);
  } catch (e) {
    console.warn('[TG] init failed', e);
  }

  // === self-check: показать, что мы внутри Telegram WebApp ===
  try {
    if (tg?.initDataUnsafe?.user) {
      tg.showAlert?.(`WebApp ОК, user id: ${tg.initDataUnsafe.user.id}`);
    }
  } catch {}

  // === DEBUG: ?debug=1 → отправить тестовый ping в бота (окно НЕ закрываем)
  (function debugAutoSend() {
    try {
      const sp = new URLSearchParams(location.search);
      if (sp.get('debug') === '1' && tg?.sendData) {
        const testPayload = { ping: 1, ts: Date.now(), user: tg.initDataUnsafe?.user?.id || null };
        const js = JSON.stringify(testPayload);
        console.log('[TG][DEBUG] sendData len=', js.length, 'payload=', testPayload);
        tg.sendData(js);
        tg.showAlert?.('Тестовый ping отправлен в бота (debug=1). Проверь логи и чат.');
      }
    } catch (e) { console.warn('debugAutoSend error', e); }
  })();

  // === DOM refs ===
  const $grid  = document.getElementById("grid");
  const $tabs  = document.getElementById("tabs");
  const $catBtn       = document.getElementById("catBtn");
  const $catBtnText   = document.getElementById("catBtnText");
  const $catSheet     = document.getElementById("catSheet");
  const $catSheetList = document.getElementById("catSheetList");

  const $pm        = document.getElementById('productModal');
  const $pmPanel   = document.getElementById('pm_panel');
  const $pmImg     = document.getElementById('pm_photo');
  const $pmTitle   = document.getElementById('pm_title');
  const $pmSku     = document.getElementById('pm_sku');
  const $pmPrice   = document.getElementById('pm_price');
  const $pmDesc    = document.getElementById('pm_desc');
  const $pmComment = document.getElementById('pm_comment');
  const $pmAdd     = document.getElementById('pm_add');
  const $pmSubmit  = document.getElementById('pm_submit');

  const $appHeader = document.getElementById('appHeader');
  const $appMain   = document.getElementById('appMain');

  // === Cart state ===
  const order = (window.order = window.order || { items: [], comment: "" });
  let currentProduct = null;

  // === Deep link helpers ===
  function getUrlId()      { return new URLSearchParams(location.search).get('id'); }
  function getStartParam() { return tg?.initDataUnsafe?.start_param || null; }
  function setUrlId(id, push) {
    try {
      const u=new URL(location.href);
      u.searchParams.set('id', String(id));
      (push?history.pushState:history.replaceState).call(history,{id:String(id)},'',u.toString());
    } catch {}
  }
  function clearUrlId(push) {
    try {
      const u=new URL(location.href);
      u.searchParams.delete('id');
      (push?history.pushState:history.replaceState).call(history,{},'',u.pathname+u.search+u.hash);
    } catch {}
  }

  // === placeholder for photos ===
  const PLACEHOLDER = "data:image/svg+xml;utf8,"+encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 1000'>
      <rect width='100%' height='100%' fill='#111'/>
      <text x='50%' y='50%' dy='.35em' text-anchor='middle'
            font-family='system-ui,-apple-system,Segoe UI,Roboto'
            font-size='36' fill='#777'>Фото</text>
    </svg>`);

  // === A11y focus trap ===
  const FOCUSABLE_SEL = [
    'a[href]','button:not([disabled])','textarea:not([disabled])',
    'input:not([disabled]):not([type="hidden"])','select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  let lastActiveBeforeModal = null;
  let trapKeydownHandler = null;

  function setInertOnBackground(on) {
    [$appHeader, $appMain].forEach(el => {
      if (!el) return;
      if (on) { el.setAttribute('aria-hidden','true'); el.setAttribute('inert',''); }
      else { el.removeAttribute('aria-hidden'); el.removeAttribute('inert'); }
    });
  }
  function trapFocusIn(modalEl) {
    const focusables = Array.from(modalEl.querySelectorAll(FOCUSABLE_SEL))
      .filter(el => el.offsetParent !== null || modalEl.contains(el));
    (focusables[0] || modalEl).focus();
    trapKeydownHandler = (e) => {
      if (e.key !== 'Tab') return;
      const els = Array.from(modalEl.querySelectorAll(FOCUSABLE_SEL))
        .filter(el => el.offsetParent !== null || modalEl.contains(el));
      if (!els.length) { e.preventDefault(); return; }
      const first = els[0], last = els[els.length-1], active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !modalEl.contains(active)) { last.focus(); e.preventDefault(); }
      } else {
        if (active === last) { first.focus(); e.preventDefault(); }
      }
    };
    document.addEventListener('keydown', trapKeydownHandler, true);
  }
  function releaseFocusTrap() {
    if (trapKeydownHandler) document.removeEventListener('keydown', trapKeydownHandler, true);
    trapKeydownHandler = null;
  }

  // === Modal open/close ===
  function openModal(product, { setUrl = true } = {}) {
    if (!$pm) return;
    lastActiveBeforeModal = document.activeElement || null;
    currentProduct = product || null;

    const photo = (product.photo || '').trim() || PLACEHOLDER;
    if ($pmImg)   { $pmImg.src = photo; $pmImg.alt = product.title || 'Фото'; }
    if ($pmTitle) $pmTitle.textContent = product.title || '';
    if ($pmSku)   $pmSku.textContent   = product.id ? String(product.id) : '';
    if ($pmPrice) $pmPrice.textContent = fmtPrice(product.price) + ' ₽';
    if ($pmDesc)  $pmDesc.textContent  = product.desc ? String(product.desc) : '';
    if ($pmComment) $pmComment.value = order.comment || '';

    const already = order.items.find(x => String(x.id) === String(product.id));
    if ($pmAdd){ $pmAdd.textContent = already ? 'В корзине' : 'Добавить'; $pmAdd.disabled = !!already; }

    $pm.classList.add('open');
    $pm.removeAttribute('aria-hidden');
    document.body.style.overflow = 'hidden';
    setInertOnBackground(true);
    ($pmPanel || $pm).setAttribute('tabindex','-1');
    trapFocusIn($pmPanel || $pm);

    if (setUrl && product?.id != null) setUrlId(product.id);
    try { tg?.HapticFeedback?.selectionChanged(); } catch {}
  }
  function closeModal({ clearUrl = true } = {}) {
    if (!$pm) return;
    releaseFocusTrap();
    setInertOnBackground(false);
    $pm.classList.remove('open');
    $pm.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
    if (clearUrl) clearUrlId();
    if (lastActiveBeforeModal && document.contains(lastActiveBeforeModal)) lastActiveBeforeModal.focus();
    else if ($catBtn) $catBtn.focus();
    lastActiveBeforeModal = null;
  }

  if ($pm) {
    document.querySelectorAll('[data-close="pm"]').forEach(el => el.addEventListener('click', () => closeModal({ clearUrl: true })));
    const $backdrop = $pm.querySelector('.modal__backdrop');
    if ($backdrop) $backdrop.addEventListener('click', () => closeModal({ clearUrl: true }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $pm.classList.contains('open')) closeModal({ clearUrl: true }); });
  }

  // === Comment / Add-to-cart ===
  $pmComment?.addEventListener('input', (e)=> { order.comment = String(e.target.value || '').slice(0, 800); });
  $pmAdd?.addEventListener('click', ()=>{
    if (!currentProduct) return;
    const exists = order.items.find(x => String(x.id) === String(currentProduct.id));
    if (!exists){
      order.items.push({ id: currentProduct.id, title: currentProduct.title, price: Number(currentProduct.price || 0), qty: 1 });
      $pmAdd.textContent = 'В корзине'; $pmAdd.disabled = true;
      try { tg?.HapticFeedback?.impactOccurred('light'); } catch {}
    }
  });

  // === SEND ORDER (только вручную, окно НЕ закрываем) ===
  function getCartItems() {
    return (order.items || []).map(it => ({
      id: String(it.id ?? '').trim(),
      title: String(it.title ?? '').trim(),
      price: Number(it.price ?? 0) || 0,
      qty: Number(it.qty ?? 1) || 1
    })).filter(x => x.id && x.title);
  }
  function getComment() { return (order.comment || '').trim(); }

  let isSendingOrder = false;

  $pmSubmit?.addEventListener('click', () => {
    if (isSendingOrder) return;

    const items = getCartItems();
    if (!items.length) {
      $pmSubmit.classList.add('shake'); setTimeout(()=> $pmSubmit.classList.remove('shake'), 320);
      return;
    }
    const total = items.reduce((s, x) => s + x.price * x.qty, 0);
    const payload = {
      items, total,
      comment: getComment(),
      user: tg?.initDataUnsafe?.user ? {
        id: tg.initDataUnsafe.user.id,
        username: tg.initDataUnsafe.user.username || '',
        name: [tg.initDataUnsafe.user.first_name, tg.initDataUnsafe.user.last_name].filter(Boolean).join(' ')
      } : {}
    };
    const json = JSON.stringify(payload);
    console.log('[TG] sendData len=', json.length, 'payload=', payload);

    if (json.length > 3800) {
      tg?.showAlert?.('Слишком большой заказ. Уменьшите список и попробуйте ещё раз.');
      return;
    }
    if (!tg?.sendData) {
      alert('Открой каталог из кнопки бота — только так можно отправить заказ.');
      return;
    }

    // статус и защита от повтора
    isSendingOrder = true;
    const oldText = $pmSubmit.textContent;
    $pmSubmit.disabled = true;
    $pmSubmit.textContent = 'Отправляем…';

    try {
      tg.sendData(json);                                  // ← сюда ловит бот
      try { tg?.HapticFeedback?.notificationOccurred('success'); } catch {}
      tg?.showAlert?.('✅ Заказ отправлен. Проверьте ЛС бота.');
    } catch (e) {
      console.error('[TG] sendData error', e);
      tg?.showAlert?.('Не удалось отправить заказ. Попробуйте ещё раз.');
    } finally {
      // возвращаем кнопку; окно НЕ закрываем
      setTimeout(() => {
        isSendingOrder = false;
        $pmSubmit.disabled = false;
        $pmSubmit.textContent = oldText || 'Отправить продавцу';
      }, 500);
    }
  });

  // === Делегирование кликов по карточкам → модалка ===
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.card .btn');
    if (!btn) return;
    e.preventDefault();
    const card = btn.closest('.card');
    const id = card?.dataset?.id;

    const list = (window.state?.filtered && window.state.filtered.length) ? window.state.filtered : (window.state?.products || []);
    let product = id ? list.find(p => String(p.id) === String(id)) : null;
    if (!product) {
      const title = card.querySelector('.title')?.textContent?.trim();
      product = list.find(p => p.title === title) || null;
    }
    if (product) openModal(product, { setUrl: true });
  });

  // === Data loading (API → fallback to local) ===
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

  // === Boot ===
  Promise.all([
    getJSON("./data/products.json",   "/catalog/products"),
    getJSON("./data/categories.json", "/catalog/categories")
  ]).then(([prodsData, catsData]) => {
    const products   = toItems(prodsData);
    const categories = toItems(catsData);

    window.state = { products, filtered: [] };

    let activeCat = "Все";
    renderTabs(categories, activeCat, onChangeCat);
    renderMobilePicker(categories, activeCat, onChangeCat);
    renderList(products, activeCat);

    const deepId = getStartParam() || getUrlId();
    if (deepId) {
      const prod = products.find(p => String(p.id) === String(deepId));
      if (prod) openModal(prod, { setUrl: true });
    }

    window.addEventListener('popstate', () => {
      const id = getUrlId();
      const isOpen = $pm?.classList.contains('open');
      if (id) {
        const p = products.find(pp => String(pp.id) === String(id));
        if (p) openModal(p, { setUrl: false });
      } else if (isOpen) {
        closeModal({ clearUrl: false });
      }
    });

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

  // === UI renders ===
  function renderTabs(categories, activeCat, onClick) {
    $tabs.innerHTML = "";
    const seen = new Set(["Все"]);
    const tabs = [{ title: "Все" }, ...categories.filter(c => {
      const t = (c.title || "").trim(); if (!t || seen.has(t)) return false; seen.add(t); return true;
    })];

    tabs.forEach((c) => {
      const b = document.createElement("button");
      b.className = "tab" + (c.title === activeCat ? " active" : "");
      b.type = "button";
      b.setAttribute('role','tab');
      b.setAttribute('aria-selected', c.title === activeCat ? 'true' : 'false');
      b.textContent = c.title;
      b.onclick = () => onClick(c.title);
      $tabs.appendChild(b);
    });

    $tabs.querySelector('.tab.active')?.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
  }

  function renderMobilePicker(categories, activeCat, onPick) {
    if (!$catBtn || !$catBtnText || !$catSheet || !$catSheetList) return;

    const seen = new Set(["Все"]);
    const list = [{ title: "Все" }, ...categories.filter(c => {
      const t = (c.title || "").trim(); if (!t || seen.has(t)) return false; seen.add(t); return true;
    })];

    $catBtnText.textContent = activeCat;
    $catSheetList.innerHTML = "";
    list.forEach(c => {
      const item = document.createElement('button');
      item.type = "button";
      item.className = 'sheet__item' + (c.title === activeCat ? ' active' : '');
      item.setAttribute('role','option');
      item.setAttribute('aria-selected', c.title === activeCat ? 'true' : 'false');
      item.textContent = c.title;
      item.onclick = () => { closeSheet(); onPick(c.title); try { tg?.HapticFeedback?.selectionChanged(); } catch {} };
      $catSheetList.appendChild(item);
    });

    $catBtn.onclick = openSheet;
    $catSheet.querySelector('.sheet__backdrop')?.addEventListener('click', closeSheet);
  }
  function openSheet()  { $catSheet.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  function closeSheet() { $catSheet.classList.add('hidden');   document.body.style.overflow = '';       }

  function renderList(products, activeCat) {
    $grid.innerHTML = "";
    const list = products.filter((p) => activeCat === "Все" || p.category === activeCat);
    window.state.filtered = list;

    if (!list.length) {
      $grid.innerHTML = `<div class="empty">Тут пока пусто. Добавьте товары в <code>data/products.json</code>.</div>`;
      return;
    }

    list.forEach((it) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = it.id;

      const photo = it.photo?.trim() || PLACEHOLDER;

      card.innerHTML = `
        <div class="media">
          <img class="photo"
               src="${photo}"
               alt="${escapeHTML(it.title || 'Фото')}"
               loading="lazy" decoding="async"
               width="800" height="1000">
        </div>
        <div class="info">
          <div class="title">${escapeHTML(it.title || "")}</div>
          <div class="sku">${escapeHTML(it.id || "")}</div>
          <div class="price">${fmtPrice(it.price)} ₽</div>
        </div>
        <button class="btn" type="button" aria-haspopup="dialog" aria-controls="productModal">Открыть</button>
      `;
      $grid.appendChild(card);
    });
  }

  // === helpers ===
  function fmtPrice(v){ return Number(v || 0).toLocaleString('ru-RU'); }
  function escapeHTML(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
})();
