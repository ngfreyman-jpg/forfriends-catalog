const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const items = [
  { title: "Худи Maison Mihara Yasuhiro MMY3", price: "4 290 ₽", photo: "https://i.imgur.com/8pQv3sO.jpeg", sku:"3020803" },
  { title: "Худи MMY3 серый",                 price: "4 290 ₽", photo: "https://i.imgur.com/4eH2k80.jpeg", sku:"3020799" },
  { title: "Футболка MMY3",                   price: "2 490 ₽", photo: "https://i.imgur.com/6cQnq3s.jpeg",  sku:"5010001" },
];

const grid = document.getElementById("grid");

items.forEach((it) => {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <img class="photo" src="${it.photo}">
    <div class="info">
      <div class="price">${it.price}</div>
      <div class="title">${it.title}<br><small>арт. ${it.sku}</small></div>
    </div>
    <div class="btn primary">Добавить</div>
  `;
  card.querySelector(".btn").onclick = () => {
    tg.sendData(JSON.stringify({ action: "add", sku: it.sku }));
    tg.HapticFeedback.impactOccurred('light');
  };
  grid.appendChild(card);
});
