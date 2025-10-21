const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

async function loadProducts() {
  const res = await fetch('./data/products.json');
  const products = await res.json();

  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  products.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img class="photo" src="${p.image || 'https://via.placeholder.com/400x500?text=No+Image'}" alt="${p.title}">
      <div class="info">
        <div class="title">${p.title}</div>
        <div class="price">${p.price} ₽</div>
      </div>
      <div class="btn">Добавить</div>
    `;

    card.querySelector('.btn').addEventListener('click', () => {
      tg.sendData(JSON.stringify({ action: 'add', id: p.id }));
      tg.HapticFeedback.impactOccurred('light');
    });

    grid.appendChild(card);
  });
}

loadProducts();
