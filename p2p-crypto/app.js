'use strict';
// PeerSwap — simulated P2P crypto marketplace with escrow flow. All data lives in localStorage.

const COINS = { USDT: 1, USDC: 1, BTC: 65000, ETH: 3200, SOL: 150 };       // USD reference prices (demo)
const FIATS = { USD: { r: 1, s: '$' }, EUR: { r: 0.92, s: '€' }, KRW: { r: 1370, s: '₩' }, GBP: { r: 0.78, s: '£' } };
const METHODS = ['Bank transfer', 'PayPal', 'Wise', 'Revolut', 'Cash in person'];
const COLORS = ['#2563eb', '#db2777', '#7c3aed', '#ea580c', '#0d9488', '#4b5563'];
const KEY = 'peerswap.v1';

// ---------- state ----------
function seed() {
  const names = ['Alex_K', 'SatoshiFan', 'Mina.Lee', 'CryptoJo', 'BlockBella', 'Dmitri99', 'TradeWithTom', 'Yuna_P'];
  const offers = [];
  let n = 0;
  let i = 0;
  Object.keys(COINS).forEach(coin => Object.keys(FIATS).forEach(fiat => ['sell', 'buy'].forEach(side => {
    for (let q = 0; q < 2; q++, i++) {
      offers.push({
        id: 'o' + (++n), owner: names[i % names.length], side, coin, fiat,
        margin: +(((i * 7) % 9) / 2 - 2).toFixed(1),                 // % vs market
        avail: coin === 'BTC' ? 0.5 : coin === 'ETH' ? 8 : coin === 'SOL' ? 120 : 5000,
        min: fiat === 'KRW' ? 20000 : 20, max: fiat === 'KRW' ? 2000000 : 1500 + (i % 5) * 300,
        methods: [METHODS[i % 5], METHODS[(i + 2) % 5]],
        trades: 20 + (i % 8) * 37, rate: 94 + (i % 6), mine: false
      });
    }
  })));
  return {
    me: 'You', wallet: { USDT: 1000, USDC: 0, BTC: 0.05, ETH: 1, SOL: 10 },
    offers, trades: [], seq: 1
  };
}
let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
if (!S || !S.offers) S = seed();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const color = name => COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const avatar = n => `<div class="av" style="background:${color(n)}">${esc(n[0].toUpperCase())}</div>`;
const mkt = (coin, fiat) => COINS[coin] * FIATS[fiat].r;
const priceOf = o => mkt(o.coin, o.fiat) * (1 + o.margin / 100);
const money = (v, fiat) => FIATS[fiat].s + v.toLocaleString(undefined, { maximumFractionDigits: fiat === 'KRW' ? 0 : 2, minimumFractionDigits: fiat === 'KRW' ? 0 : 2 });
const amt = (v, coin) => (+v.toFixed(coin === 'BTC' ? 6 : coin === 'ETH' ? 5 : 4)).toString();
const toast = m => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2400); };
const closeModal = () => { $('#modal').hidden = true; $('#sheet').innerHTML = ''; openTradeId = null; };
function openModal(html) { $('#sheet').innerHTML = html; $('#modal').hidden = false; }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });

// ---------- market view ----------
const F = { side: 'buy', coin: 'USDT', fiat: 'USD', method: '', amount: '' };

function viewMarket() {
  // "Buy" tab shows ads where advertisers SELL crypto.
  const want = F.side === 'buy' ? 'sell' : 'buy';
  const list = S.offers
    .filter(o => o.side === want && o.coin === F.coin && o.fiat === F.fiat && o.avail > 0)
    .filter(o => !F.method || o.methods.includes(F.method))
    .filter(o => !F.amount || (+F.amount >= o.min && +F.amount <= Math.min(o.max, o.avail * priceOf(o))))
    .sort((a, b) => F.side === 'buy' ? priceOf(a) - priceOf(b) : priceOf(b) - priceOf(a));

  return `
  <h1>Trade crypto peer-to-peer</h1>
  <div class="tabs" role="tablist">
    <button class="buy ${F.side === 'buy' ? 'on' : ''}" data-side="buy">Buy</button>
    <button class="sell ${F.side === 'sell' ? 'on' : ''}" data-side="sell">Sell</button>
  </div>
  <div class="filters">
    <div class="chips">${Object.keys(COINS).map(c => `<span class="chip ${F.coin === c ? 'on' : ''}" data-coin="${c}">${c}</span>`).join('')}</div>
  </div>
  <div class="filters">
    <input id="fAmt" type="number" min="0" placeholder="Amount in ${F.fiat}" value="${esc(F.amount)}" style="width:170px">
    <select id="fFiat">${Object.keys(FIATS).map(f => `<option ${f === F.fiat ? 'selected' : ''}>${f}</option>`).join('')}</select>
    <select id="fMethod"><option value="">All payment methods</option>${METHODS.map(m => `<option ${m === F.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
    <span class="sub" style="align-self:center">Market: ${money(mkt(F.coin, F.fiat), F.fiat)} / ${F.coin}</span>
  </div>
  ${list.length ? list.map(o => offerRow(o)).join('') : `<div class="empty">No offers match. Try another amount or payment method — or <a href="#" id="emptyPost">post your own</a>.</div>`}`;
}

function offerRow(o) {
  const p = priceOf(o), lim = Math.min(o.max, o.avail * p);
  const act = F.side === 'buy' ? 'buy' : 'sell';
  return `<div class="card offer">
    <div class="who">${avatar(o.owner)}<div><b>${esc(o.owner)}${o.mine ? ' (you)' : ''}</b><div class="sub">${o.trades} trades · ${o.rate}% completion</div></div></div>
    <div><div class="price">${money(p, o.fiat)}</div><div class="sub">${o.margin >= 0 ? '+' : ''}${o.margin}% vs market</div></div>
    <div><div class="sub">Limit ${money(o.min, o.fiat)} – ${money(lim, o.fiat)}</div><div class="sub">Available ${amt(o.avail, o.coin)} ${o.coin}</div>
      <div>${o.methods.map(m => `<span class="tag">${esc(m)}</span>`).join('')}</div></div>
    <button class="btn ${act}" data-trade="${o.id}" ${o.mine ? 'disabled title="This is your own offer"' : ''}>${act === 'buy' ? 'Buy' : 'Sell'} ${o.coin}</button>
  </div>`;
}

// ---------- start-trade modal ----------
function startTrade(id) {
  const o = S.offers.find(x => x.id === id); if (!o) return;
  const buying = o.side === 'sell';              // I buy when the advertiser sells
  const p = priceOf(o), lim = Math.min(o.max, o.avail * p);
  openModal(`
    <h2>${buying ? 'Buy' : 'Sell'} ${o.coin} ${buying ? 'from' : 'to'} ${esc(o.owner)}</h2>
    <div class="sub">Price ${money(p, o.fiat)} / ${o.coin} · Limit ${money(o.min, o.fiat)} – ${money(lim, o.fiat)}</div>
    <div class="field" style="margin-top:14px"><label>${buying ? 'I want to pay' : 'I want to receive'} (${o.fiat})</label>
      <div class="inwrap"><input id="tFiat" type="number" step="any" value="${F.amount || Math.max(o.min, 100)}"><button class="btn plain" id="tMax">Max</button></div></div>
    <div class="field"><label>${buying ? 'I will receive' : 'I will send'} (${o.coin})</label><input id="tCoin" type="number" step="any"></div>
    <div class="field"><label>Payment method</label><select id="tMethod">${o.methods.map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
    ${buying ? '' : `<div class="sub">Your balance: ${amt(S.wallet[o.coin], o.coin)} ${o.coin}</div>`}
    <div id="tErr" class="sub" style="color:var(--sell);min-height:20px"></div>
    <button class="btn full ${buying ? 'buy' : 'sell'}" id="tGo">${buying ? 'Buy' : 'Sell'} ${o.coin}</button>
    <button class="btn plain full" style="margin-top:8px" id="tCancel">Cancel</button>`);
  const f = $('#tFiat'), c = $('#tCoin');
  const syncC = () => c.value = f.value ? amt(+f.value / p, o.coin) : '';
  f.oninput = syncC; c.oninput = () => f.value = c.value ? +(c.value * p).toFixed(2) : '';
  $('#tMax').onclick = () => { f.value = Math.floor(buying ? lim : Math.min(lim, S.wallet[o.coin] * p)); syncC(); };
  $('#tCancel').onclick = closeModal; syncC();
  $('#tGo').onclick = () => {
    const fiat = +f.value, coin = fiat / p, err = m => $('#tErr').textContent = m;
    if (!(fiat > 0)) return err('Enter an amount.');
    if (fiat < o.min) return err(`Minimum is ${money(o.min, o.fiat)}.`);
    if (fiat > lim + 1e-9) return err(`Maximum is ${money(lim, o.fiat)}.`);
    if (!buying && coin > S.wallet[o.coin] + 1e-12) return err(`Insufficient ${o.coin} balance.`);
    const t = {
      id: 't' + (S.seq++), offer: o.id, cp: o.owner, buying, coin: o.coin, fiat: o.fiat,
      coinAmt: coin, fiatAmt: fiat, price: p, method: $('#tMethod').value,
      status: 'waiting_payment', created: Date.now(), expires: Date.now() + 15 * 60e3,
      chat: [{ s: 'sys', t: 'Trade started. Crypto is held in escrow.' }]
    };
    if (!buying) S.wallet[o.coin] -= coin;            // lock my crypto in escrow
    o.avail -= coin;                                  // reserve counterparty's crypto
    t.chat.push({ s: o.owner, t: buying ? `Hi! Please pay ${money(fiat, o.fiat)} via ${t.method}, then press "I've paid".` : `Hi! Sending ${money(fiat, o.fiat)} via ${t.method} now.` });
    S.trades.unshift(t); save(); simulate(t); showTrade(t.id); render();
  };
}

// ---------- trade room ----------
let openTradeId = null, tick = null;
const STEPS = ['Escrow locked', 'Payment sent', 'Crypto released'];
function stepIdx(t) { return { waiting_payment: 1, paid: 2, completed: 3, cancelled: 0 }[t.status] ?? 0; }

function showTrade(id) {
  const t = S.trades.find(x => x.id === id); if (!t) return;
  openTradeId = id;
  const done = t.status === 'completed', canc = t.status === 'cancelled', i = stepIdx(t);
  const left = Math.max(0, Math.round((t.expires - Date.now()) / 1000));
  let action = '', hint = '';
  if (t.status === 'waiting_payment') {
    if (t.buying) { hint = `Pay <b>${money(t.fiatAmt, t.fiat)}</b> to ${esc(t.cp)} via ${esc(t.method)}, then confirm.`; action = `<button class="btn buy full" data-act="paid">I've paid</button>`; }
    else hint = `Waiting for ${esc(t.cp)} to send <b>${money(t.fiatAmt, t.fiat)}</b> via ${esc(t.method)}…`;
  } else if (t.status === 'paid') {
    if (t.buying) hint = `Waiting for ${esc(t.cp)} to confirm payment and release your ${t.coin}…`;
    else { hint = `${esc(t.cp)} says they paid. Check your ${esc(t.method)} account — only release once the money has arrived.`; action = `<button class="btn sell full" data-act="release">Payment received – release ${t.coin}</button>`; }
  } else if (done) hint = t.buying ? `✅ ${amt(t.coinAmt, t.coin)} ${t.coin} added to your wallet.` : `✅ Released. ${money(t.fiatAmt, t.fiat)} received.`;
  else hint = 'Trade cancelled. Escrowed funds were returned.';
  const cancel = t.status === 'waiting_payment' ? `<button class="btn plain full" style="margin-top:8px" data-act="cancel">Cancel trade</button>` : '';

  openModal(`
    <div class="row"><h2>${t.buying ? 'Buying' : 'Selling'} ${amt(t.coinAmt, t.coin)} ${t.coin}</h2><button class="btn plain" data-act="close">✕</button></div>
    <div class="row"><span class="sub">With ${esc(t.cp)}</span><span class="sub">${money(t.fiatAmt, t.fiat)} @ ${money(t.price, t.fiat)}</span></div>
    <div class="steps">${STEPS.map((s, k) => `<div class="step ${!canc && k < i ? 'done' : ''}">${s}</div>`).join('')}</div>
    ${t.status === 'waiting_payment' ? `<div class="sub" id="timer">Time left: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</div>` : ''}
    <div class="warn">${hint}</div>
    <div class="chat" id="chat">${t.chat.map(m => m.s === 'sys' ? `<div class="sys">${esc(m.t)}</div>` : `<div class="msg ${m.s === 'me' ? 'me' : ''}">${esc(m.t)}</div>`).join('')}</div>
    ${done || canc ? '' : `<div class="inwrap"><input id="chatIn" placeholder="Message ${esc(t.cp)}…"><button class="btn" data-act="send">Send</button></div>`}
    <div style="margin-top:10px">${action}${cancel}</div>`);
  const ch = $('#chat'); if (ch) ch.scrollTop = 1e9;
  const inp = $('#chatIn'); if (inp) inp.onkeydown = e => { if (e.key === 'Enter') act('send'); };
}

function act(a) {
  const t = S.trades.find(x => x.id === openTradeId);
  if (a === 'close') return closeModal();
  if (!t) return;
  if (a === 'send') {
    const v = $('#chatIn').value.trim(); if (!v) return;
    t.chat.push({ s: 'me', t: v });
    setTimeout(() => { reply(t, 'Thanks, noted 👍'); }, 1200);
  }
  if (a === 'paid') { t.status = 'paid'; t.chat.push({ s: 'sys', t: 'You marked the payment as sent.' }); simulate(t); }
  if (a === 'release') finish(t);
  if (a === 'cancel') cancelTrade(t);
  save(); showTrade(t.id); render();
}

function reply(t, text) {
  if (!['waiting_payment', 'paid'].includes(t.status)) return;
  t.chat.push({ s: t.cp, t: text }); save();
  if (openTradeId === t.id) showTrade(t.id);
}
function finish(t) {
  t.status = 'completed';
  S.wallet[t.coin] += t.buying ? t.coinAmt : 0;
  t.chat.push({ s: 'sys', t: 'Escrow released. Trade complete.' });
  const o = S.offers.find(x => x.id === t.offer); if (o) o.trades++;
}
function cancelTrade(t, reason) {
  t.status = 'cancelled';
  if (!t.buying) S.wallet[t.coin] += t.coinAmt;                         // refund my escrow
  const o = S.offers.find(x => x.id === t.offer); if (o) o.avail += t.coinAmt;
  t.chat.push({ s: 'sys', t: reason || 'Trade cancelled.' });
}
// Fake counterparty behaviour so a single user can try the whole flow.
function simulate(t) {
  if (t.status === 'paid' && t.buying) {
    setTimeout(() => { if (t.status === 'paid') { t.chat.push({ s: t.cp, t: 'Payment received, releasing now!' }); finish(t); save(); refresh(t); } }, 4000);
  } else if (t.status === 'waiting_payment' && !t.buying) {
    setTimeout(() => { if (t.status === 'waiting_payment') { t.status = 'paid'; t.chat.push({ s: t.cp, t: 'Payment sent! Please check and release.' }); save(); refresh(t); } }, 5000);
  }
}
function refresh(t) { if (openTradeId === t.id) showTrade(t.id); render(); }

// expire overdue trades & update timer
setInterval(() => {
  let changed = false;
  S.trades.forEach(t => { if (t.status === 'waiting_payment' && Date.now() > t.expires) { cancelTrade(t, 'Payment window expired. Trade cancelled.'); changed = true; } });
  if (changed) { save(); if (openTradeId) showTrade(openTradeId); render(); }
  const el = $('#timer'), t = S.trades.find(x => x.id === openTradeId);
  if (el && t) { const l = Math.max(0, Math.round((t.expires - Date.now()) / 1000)); el.textContent = `Time left: ${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; }
}, 1000);

// ---------- orders / wallet ----------
function viewOrders() {
  const mine = S.offers.filter(o => o.mine);
  return `<h1>My orders</h1>
  ${S.trades.length ? S.trades.map(t => `<div class="card row" style="margin-bottom:10px;align-items:center">
    <div><b>${t.buying ? 'Buy' : 'Sell'} ${amt(t.coinAmt, t.coin)} ${t.coin}</b><div class="sub">${esc(t.cp)} · ${money(t.fiatAmt, t.fiat)} · ${new Date(t.created).toLocaleString()}</div></div>
    <div style="text-align:right"><span class="status ${t.status === 'completed' ? 'completed' : t.status === 'cancelled' ? 'cancelled' : 'open'}">${{ waiting_payment: 'Awaiting payment', paid: 'Paid – awaiting release', completed: 'Completed', cancelled: 'Cancelled' }[t.status]}</span>
    <div><a href="#" data-open="${t.id}">Open</a></div></div></div>`).join('') : `<div class="empty">No trades yet. Head to the <a href="#market">market</a> to start one.</div>`}
  <h2 style="margin-top:26px">My offers</h2>
  ${mine.length ? mine.map(o => `<div class="card row" style="margin-bottom:10px;align-items:center">
    <div><b>${o.side === 'sell' ? 'Selling' : 'Buying'} ${o.coin}</b> at ${money(priceOf(o), o.fiat)} (${o.margin >= 0 ? '+' : ''}${o.margin}%)
    <div class="sub">${amt(o.avail, o.coin)} ${o.coin} left · ${o.methods.join(', ')}</div></div>
    <button class="btn plain" data-del="${o.id}">Remove</button></div>`).join('') : `<div class="sub">You have no offers. Use “+ Post offer”.</div>`}`;
}
function viewWallet() {
  const total = Object.entries(S.wallet).reduce((a, [c, v]) => a + v * COINS[c], 0);
  const escrow = {};
  S.trades.filter(t => !t.buying && ['waiting_payment', 'paid'].includes(t.status)).forEach(t => escrow[t.coin] = (escrow[t.coin] || 0) + t.coinAmt);
  return `<h1>Wallet</h1><div class="card" style="margin-bottom:14px"><div class="sub">Estimated total</div><div class="price" style="font-size:28px">${money(total, 'USD')}</div></div>
  ${Object.keys(COINS).map(c => `<div class="card row" style="margin-bottom:10px;align-items:center"><div class="coin">${avatar(c)}<div><b>${c}</b><div class="sub">${escrow[c] ? 'In escrow: ' + amt(escrow[c], c) : 'Available'}</div></div></div>
  <div style="text-align:right"><b>${amt(S.wallet[c], c)}</b><div class="sub">${money(S.wallet[c] * COINS[c], 'USD')}</div></div></div>`).join('')}
  <button class="btn plain" id="faucet">Add demo funds</button>
  <button class="btn plain" id="reset">Reset demo data</button>`;
}

// ---------- post offer ----------
function postOffer() {
  openModal(`<div class="row"><h2>Post an offer</h2><button class="btn plain" data-act="close">✕</button></div>
  <div class="tabs" style="margin-bottom:14px"><button class="buy on" id="pSideBuy">I want to buy</button><button class="sell" id="pSideSell">I want to sell</button></div>
  <div class="grid2"><div class="field"><label>Coin</label><select id="pCoin">${Object.keys(COINS).map(c => `<option>${c}</option>`).join('')}</select></div>
  <div class="field"><label>Currency</label><select id="pFiat">${Object.keys(FIATS).map(c => `<option>${c}</option>`).join('')}</select></div></div>
  <div class="field"><label>Your price vs market (%)</label><input id="pMargin" type="number" step="0.1" value="0"><div class="sub" id="pPrev"></div></div>
  <div class="field"><label>Amount (<span id="pU">USDT</span>)</label><input id="pAvail" type="number" step="any" value="100"></div>
  <div class="grid2"><div class="field"><label>Min order</label><input id="pMin" type="number" value="20"></div><div class="field"><label>Max order</label><input id="pMax" type="number" value="1000"></div></div>
  <div class="field"><label>Payment methods</label><div class="chips">${METHODS.map(m => `<span class="chip" data-pm="${m}">${m}</span>`).join('')}</div></div>
  <div id="pErr" class="sub" style="color:var(--sell);min-height:20px"></div>
  <button class="btn full" id="pGo">Publish offer</button>`);
  let side = 'buy';
  const prev = () => { const c = $('#pCoin').value, f = $('#pFiat').value, m = +$('#pMargin').value || 0; $('#pU').textContent = c; $('#pPrev').textContent = `Your price: ${money(mkt(c, f) * (1 + m / 100), f)} / ${c}`; };
  ['pCoin', 'pFiat', 'pMargin'].forEach(i => $('#' + i).oninput = prev); prev();
  const sw = s => { side = s; $('#pSideBuy').classList.toggle('on', s === 'buy'); $('#pSideSell').classList.toggle('on', s === 'sell'); };
  $('#pSideBuy').onclick = () => sw('buy'); $('#pSideSell').onclick = () => sw('sell');
  $('#sheet').querySelectorAll('[data-pm]').forEach(c => c.onclick = () => c.classList.toggle('on'));
  $('#pGo').onclick = () => {
    const coin = $('#pCoin').value, fiat = $('#pFiat').value, avail = +$('#pAvail').value, min = +$('#pMin').value, max = +$('#pMax').value;
    const methods = [...$('#sheet').querySelectorAll('[data-pm].on')].map(c => c.dataset.pm), err = m => $('#pErr').textContent = m;
    if (!(avail > 0)) return err('Enter an amount.');
    if (!(min > 0) || max < min) return err('Check your min/max limits.');
    if (!methods.length) return err('Pick at least one payment method.');
    if (side === 'sell') { if (avail > S.wallet[coin]) return err(`You only have ${amt(S.wallet[coin], coin)} ${coin}.`); S.wallet[coin] -= avail; }
    S.offers.unshift({ id: 'o' + Date.now(), owner: S.me, side, coin, fiat, margin: +$('#pMargin').value || 0, avail, min, max, methods, trades: 0, rate: 100, mine: true });
    save(); closeModal(); toast('Offer published'); location.hash = 'orders'; render();
  };
}

// ---------- routing & events ----------
function render() {
  const page = (location.hash.slice(1) || 'market');
  $('#app').innerHTML = page === 'orders' ? viewOrders() : page === 'wallet' ? viewWallet() : viewMarket();
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === page));
  const n = S.trades.filter(t => ['waiting_payment', 'paid'].includes(t.status)).length;
  $('#orderBadge').hidden = !n; $('#orderBadge').textContent = n;
}
window.addEventListener('hashchange', render);

document.addEventListener('click', e => {
  const el = e.target.closest('[data-side],[data-coin],[data-trade],[data-act],[data-open],[data-del],#postBtn,#faucet,#reset,#emptyPost');
  if (!el) return;
  if (el.dataset.side) { F.side = el.dataset.side; render(); }
  else if (el.dataset.coin) { F.coin = el.dataset.coin; render(); }
  else if (el.dataset.trade) startTrade(el.dataset.trade);
  else if (el.dataset.act) act(el.dataset.act);
  else if (el.dataset.open) { e.preventDefault(); showTrade(el.dataset.open); }
  else if (el.dataset.del) {
    const o = S.offers.find(x => x.id === el.dataset.del);
    if (o && o.side === 'sell') S.wallet[o.coin] += o.avail;       // return unspent escrow
    S.offers = S.offers.filter(x => x !== o); save(); render(); toast('Offer removed');
  }
  else if (el.id === 'postBtn' || el.id === 'emptyPost') { e.preventDefault(); postOffer(); }
  else if (el.id === 'faucet') { S.wallet.USDT += 1000; save(); render(); toast('+1000 USDT added'); }
  else if (el.id === 'reset') { if (confirm('Reset all demo data?')) { S = seed(); save(); render(); } }
});
document.addEventListener('change', e => {
  if (e.target.id === 'fFiat') { F.fiat = e.target.value; render(); }
  if (e.target.id === 'fMethod') { F.method = e.target.value; render(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'fAmt') { F.amount = e.target.value; clearTimeout(render.t); render.t = setTimeout(() => { render(); const i = $('#fAmt'); if (i) { i.focus(); i.setSelectionRange(1e3, 1e3); } }, 350); }
});

// resume any simulated trades after reload
S.trades.forEach(t => { if (['waiting_payment', 'paid'].includes(t.status)) simulate(t); });
render();
