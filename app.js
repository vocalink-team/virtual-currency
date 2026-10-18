"use strict";

const API = "https://data-api.binance.vision/api/v3/klines";
const PRICE_API = "https://data-api.binance.vision/api/v3/ticker/price";
const PRICE_TTL = 60000;
const STORAGE_KEY = "vocalink-trade-v1";
const STARTING_CASH = 1000000; // USDT。実際の入金は不要
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const $ = (id) => document.getElementById(id);
const money = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const qtyText = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 8 });

function initialState() {
  return { cash: STARTING_CASH, holdings: { BTCUSDT: 0, ETHUSDT: 0, SOLUSDT: 0 }, history: [] };
}

function loadState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!value || !Number.isFinite(value.cash) || value.cash < 0 || !value.holdings || !Array.isArray(value.history)) return initialState();
    if (!SYMBOLS.every((s) => Number.isFinite(value.holdings[s]) && value.holdings[s] >= 0)) return initialState();
    return value;
  } catch {
    return initialState();
  }
}

let state = loadState();
let currentSymbol = "BTCUSDT";
let candles = [];
const prices = {};
let requestId = 0;
let refreshInProgress = false;
const priceUpdatedAt = {};

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { showNotice("保存に失敗しました。ブラウザの保存領域を確認してください。"); }
}

function showNotice(message) { $("notice").textContent = message; }

async function fetchCandles(symbol) {
  const response = await fetch(API + "?symbol=" + encodeURIComponent(symbol) + "&interval=1m&limit=90", { cache: "no-store" });
  if (!response.ok) throw new Error("価格APIの応答: HTTP " + response.status);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("価格データの形式が不正です。");
  const data = rows.map((row) => ({ time: Number(row[0]), close: Number(row[4]) }));
  if (!data.every((row) => Number.isFinite(row.time) && Number.isFinite(row.close) && row.close > 0)) throw new Error("価格データの値が不正です。");
  return data;
}

async function fetchAllPrices() {
  const response = await fetch(PRICE_API, { cache: "no-store" });
  if (!response.ok) throw new Error("価格APIの応答: HTTP " + response.status);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("価格データの形式が不正です。");
  const now = Date.now();
  for (const row of rows) {
    if (!SYMBOLS.includes(row.symbol)) continue;
    const value = Number(row.price);
    if (!Number.isFinite(value) || value <= 0) continue;
    prices[row.symbol] = value;
    priceUpdatedAt[row.symbol] = now;
  }
  if (!SYMBOLS.every((symbol) => isFresh(symbol))) {
    throw new Error("一部の通貨の価格を取得できません。");
  }
}

function isFresh(symbol) {
  return Number.isFinite(prices[symbol]) &&
    Number.isFinite(priceUpdatedAt[symbol]) &&
    Date.now() - priceUpdatedAt[symbol] < PRICE_TTL;
}

async function refreshMarket() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  const symbol = currentSymbol;
  const id = ++requestId;
  $("market-status").textContent = "取得中";
  $("buy").disabled = true;
  $("sell").disabled = true;
  try {
    const [data] = await Promise.all([fetchCandles(symbol), fetchAllPrices()]);
    if (id !== requestId || symbol !== currentSymbol) return;
    candles = data;
    const updated = priceUpdatedAt[symbol];
    $("market-status").textContent = "取得成功 " + new Date(updated).toLocaleTimeString("ja-JP");
    showNotice("仮想資金を使って取引できます。");
  } catch (error) {
    if (id !== requestId) return;
    candles = [];
    for (const symbol of SYMBOLS) {
      delete prices[symbol];
      delete priceUpdatedAt[symbol];
    }
    $("market-status").textContent = "取得失敗 / 取引停止";
    showNotice("相場を取得できません。通信状況を確認してください。" +
      (error?.message ? " " + error.message : ""));
  } finally {
    refreshInProgress = false;
    render();
  }
}

function updateEstimate() {
  const amount = Number($("amount").value);
  const price = prices[currentSymbol];
  $("estimate").textContent = amount > 0 && Number.isFinite(price) ? "概算金額：" + money(amount * price) + " USDT" : "概算金額：--";
}

function render() {
  const price = prices[currentSymbol];
  $("pair-label").textContent = currentSymbol.replace("USDT", " / USDT");
  $("price-label").textContent = Number.isFinite(price) ? money(price) + " USDT" : "--";
  $("cash").textContent = money(state.cash) + " USDT";
  const holdingsValue = SYMBOLS.reduce((sum, symbol) => sum + (isFresh(symbol) ? state.holdings[symbol] * prices[symbol] : 0), 0);
  const unknown = SYMBOLS.some((symbol) => state.holdings[symbol] > 0 && !isFresh(symbol));
  const equity = state.cash + holdingsValue;
  $("equity").textContent = unknown ? "価格取得待ち" : money(equity) + " USDT";
  $("pnl").textContent = unknown ? "--" : (equity >= STARTING_CASH ? "+" : "") + money(equity - STARTING_CASH) + " USDT";
  $("holdings-list").replaceChildren();
  for (const symbol of SYMBOLS) {
    const row = document.createElement("div");
    row.className = "holding-row";
    const name = document.createElement("span");
    name.textContent = symbol.replace("USDT", "");
    const amount = document.createElement("span");
    amount.textContent = qtyText(state.holdings[symbol]) + " (" + (isFresh(symbol) ? money(state.holdings[symbol] * prices[symbol]) + " USDT" : "価格未取得") + ")";
    row.append(name, amount);
    $("holdings-list").append(row);
  }
  $("history-body").replaceChildren();
  for (const entry of state.history.slice(0, 25)) {
    const tr = document.createElement("tr");
    for (const value of [new Date(entry.time).toLocaleString("ja-JP"), entry.side === "buy" ? "買い" : "売り", entry.symbol.replace("USDT", ""), qtyText(entry.amount), money(entry.price)]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    $("history-body").append(tr);
  }
  const live = isFresh(currentSymbol) && !refreshInProgress;
  $("buy").disabled = !live;
  $("sell").disabled = !live;
  updateEstimate();
  drawChart();
}

function trade(side) {
  const amount = Number($("amount").value);
  const price = prices[currentSymbol];
  if (refreshInProgress || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || !isFresh(currentSymbol)) {
    showNotice("数量または相場データが無効です。"); return;
  }
  const total = amount * price;
  if (!Number.isFinite(total) || total <= 0) { showNotice("注文金額が不正です。"); return; }
  if (side === "buy") {
    if (total > state.cash + 1e-8) { showNotice("仮想資金が不足しています。"); return; }
    state.cash = Math.max(0, state.cash - total);
    state.holdings[currentSymbol] += amount;
  } else {
    if (amount > state.holdings[currentSymbol] + 1e-10) { showNotice("保有数量が不足しています。"); return; }
    state.holdings[currentSymbol] = Math.max(0, state.holdings[currentSymbol] - amount);
    state.cash += total;
  }
  state.history.unshift({ time: Date.now(), side, symbol: currentSymbol, amount, price });
  state.history = state.history.slice(0, 100);
  saveState();
  showNotice((side === "buy" ? "買い" : "売り") + "注文が成立しました（ゲーム内のみ）。");
  render();
}

function drawChart() {
  const canvas = $("chart");
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (candles.length < 2) {
    ctx.fillStyle = "#91a6c5"; ctx.font = "14px system-ui";
    ctx.fillText("価格データを取得できません", 20, h / 2); return;
  }
  const values = candles.map((c) => c.close);
  const min = Math.min(...values), max = Math.max(...values);
  const pad = Math.max((max - min) * 0.18, max * 0.0005);
  const low = min - pad, high = max + pad;
  const x = (i) => 12 + i / (values.length - 1) * (w - 24);
  const y = (v) => 15 + (high - v) / (high - low) * (h - 30);
  ctx.strokeStyle = "#263851"; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) { const yy = h * i / 5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke(); }
  const rising = values.at(-1) >= values[0];
  const color = rising ? "#48d7ac" : "#ff6b84";
  ctx.beginPath(); values.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.lineTo(x(values.length - 1), h); ctx.lineTo(x(0), h); ctx.closePath();
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, rising ? "rgba(72,215,172,.25)" : "rgba(255,107,132,.25)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient; ctx.fill();
}

$("coin").addEventListener("change", () => {
  currentSymbol = $("coin").value;
  candles = [];
  render();
  refreshMarket();
});
$("amount").addEventListener("input", updateEstimate);
$("buy").addEventListener("click", () => trade("buy"));
$("sell").addEventListener("click", () => trade("sell"));
$("reset").addEventListener("click", () => {
  if (!confirm("ゲーム内の資産と取引履歴を初期化しますか？")) return;
  state = initialState(); saveState(); render(); showNotice("初期化しました。");
});
window.addEventListener("resize", drawChart);
render();
refreshMarket();
setInterval(refreshMarket, 15000);
setInterval(render, 5000);
