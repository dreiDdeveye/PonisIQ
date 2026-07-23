(function () {
  const STORAGE_KEY = 'vg_bot_wallet_state_v1';
  const STARTING_BALANCE = 50;
  const MAX_HISTORY = 24;
  const PRICE_REST_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';
  const PRICE_WS_URL = 'wss://stream.binance.com:9443/ws/btcusdt@trade';

  const els = {
    feedMode: document.getElementById('feedMode'),
    priceSource: document.getElementById('priceSource'),
    currentPrice: document.getElementById('currentPrice'),
    priceChange: document.getElementById('priceChange'),
    lastUpdate: document.getElementById('lastUpdate'),
    walletBalance: document.getElementById('walletBalance'),
    walletCash: document.getElementById('walletCash'),
    walletMargin: document.getElementById('walletMargin'),
    walletEquity: document.getElementById('walletEquity'),
    walletPnl: document.getElementById('walletPnl'),
    previewDirection: document.getElementById('previewDirection'),
    previewAvg: document.getElementById('previewAvg'),
    previewToWin: document.getElementById('previewToWin'),
    previewSize: document.getElementById('previewSize'),
    previewMargin: document.getElementById('previewMargin'),
    tradeStatus: document.getElementById('tradeStatus'),
    positionUpCard: document.getElementById('positionUpCard'),
    positionDownCard: document.getElementById('positionDownCard'),
    positionUpAvg: document.getElementById('positionUpAvg'),
    positionUpUnits: document.getElementById('positionUpUnits'),
    positionUpMargin: document.getElementById('positionUpMargin'),
    positionUpPnl: document.getElementById('positionUpPnl'),
    positionDownAvg: document.getElementById('positionDownAvg'),
    positionDownUnits: document.getElementById('positionDownUnits'),
    positionDownMargin: document.getElementById('positionDownMargin'),
    positionDownPnl: document.getElementById('positionDownPnl'),
    tradeHistory: document.getElementById('tradeHistory'),
  };

  if (!els.currentPrice) return;

  let socket = null;
  let reconnectTimer = null;
  let state = loadWalletState();

  function createDefaultState() {
    return {
      walletBalance: STARTING_BALANCE,
      cash: STARTING_BALANCE,
      realizedPnl: 0,
      currentPrice: null,
      previousPrice: null,
      lastPriceAt: null,
      feedMode: 'Connecting',
      priceSource: 'Waiting',
      lastBotAction: 'Watching for wallet feed',
      activeDirection: 'standby',
      positions: {
        up: { margin: 0, units: 0 },
        down: { margin: 0, units: 0 },
      },
      history: [],
    };
  }

  function normalizeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizePosition(raw) {
    return {
      margin: Math.max(0, normalizeNumber(raw && raw.margin, 0)),
      units: Math.max(0, normalizeNumber(raw && raw.units, 0)),
    };
  }

  function normalizeHistoryItem(item) {
    return {
      ts: normalizeNumber(item && item.ts, Date.now()),
      action: typeof (item && item.action) === 'string' ? item.action.toLowerCase() : 'watch',
      direction: typeof (item && item.direction) === 'string' ? item.direction.toLowerCase() : 'standby',
      amount: normalizeNumber(item && item.amount, 0),
      price: normalizeNumber(item && item.price, null),
      result: typeof (item && item.result) === 'string' ? item.result : 'WATCH',
      resultClass: typeof (item && item.resultClass) === 'string'
        ? item.resultClass
        : (typeof (item && item.result) === 'string' && item.result.toUpperCase().includes('LOSS'))
          ? 'loss'
          : (typeof (item && item.result) === 'string' && item.result.toUpperCase().includes('WIN'))
            ? 'win'
            : 'flat',
    };
  }

  function normalizeState(raw) {
    const base = createDefaultState();
    if (!raw || typeof raw !== 'object') return base;

    return {
      walletBalance: STARTING_BALANCE,
      cash: Math.min(STARTING_BALANCE, Math.max(0, normalizeNumber(raw.cash, STARTING_BALANCE))),
      realizedPnl: normalizeNumber(raw.realizedPnl, 0),
      currentPrice: normalizeNumber(raw.currentPrice, null),
      previousPrice: normalizeNumber(raw.previousPrice, null),
      lastPriceAt: normalizeNumber(raw.lastPriceAt, null),
      feedMode: typeof raw.feedMode === 'string' ? raw.feedMode : base.feedMode,
      priceSource: typeof raw.priceSource === 'string' ? raw.priceSource : base.priceSource,
      lastBotAction: typeof raw.lastBotAction === 'string' ? raw.lastBotAction : base.lastBotAction,
      activeDirection: raw.activeDirection === 'up' || raw.activeDirection === 'down' ? raw.activeDirection : 'standby',
      positions: {
        up: normalizePosition(raw.positions && raw.positions.up),
        down: normalizePosition(raw.positions && raw.positions.down),
      },
      history: Array.isArray(raw.history) ? raw.history.slice(0, MAX_HISTORY).map(normalizeHistoryItem) : [],
    };
  }

  function loadWalletState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch (err) {
      return createDefaultState();
    }
  }

  function formatMoney(value) {
    const amount = normalizeNumber(value, 0);
    const sign = amount < 0 ? '-' : '';
    return sign + '$' + Math.abs(amount).toFixed(2);
  }

  function formatPrice(value) {
    if (!Number.isFinite(value)) return '$--';
    return '$' + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatUnits(value) {
    return normalizeNumber(value, 0).toFixed(6) + ' BTC';
  }

  function formatTimestamp(ts) {
    if (!Number.isFinite(ts)) return 'No update yet';
    return new Date(ts).toLocaleString();
  }

  function getPosition(direction) {
    return state.positions[direction];
  }

  function getAverageEntry(direction) {
    const pos = getPosition(direction);
    if (!pos.units || !pos.margin) return null;
    return pos.margin / pos.units;
  }

  function getUnrealizedPnl(direction, priceOverride) {
    const pos = getPosition(direction);
    const price = Number.isFinite(priceOverride) ? priceOverride : state.currentPrice;
    const avg = getAverageEntry(direction);
    if (!price || !avg || !pos.units) return 0;
    return direction === 'up'
      ? pos.units * (price - avg)
      : pos.units * (avg - price);
  }

  function getMarginInPlay() {
    return getPosition('up').margin + getPosition('down').margin;
  }

  function getTotalUnrealizedPnl() {
    return getUnrealizedPnl('up') + getUnrealizedPnl('down');
  }

  function getTotalPnl() {
    return state.realizedPnl + getTotalUnrealizedPnl();
  }

  function getEquity() {
    return state.cash + getMarginInPlay() + getTotalUnrealizedPnl();
  }

  function updateClassByValue(element, value) {
    element.classList.remove('is-up', 'is-down');
    if (value > 0) element.classList.add('is-up');
    if (value < 0) element.classList.add('is-down');
  }

  function renderPreview() {
    const direction = state.activeDirection;
    const pos = direction === 'up' || direction === 'down' ? getPosition(direction) : { margin: 0, units: 0 };
    const avg = direction === 'up' || direction === 'down' ? getAverageEntry(direction) : null;
    const toWin = direction === 'up' || direction === 'down' ? getUnrealizedPnl(direction) : 0;

    els.previewDirection.textContent = direction === 'standby' ? 'Standby' : direction.toUpperCase();
    els.previewAvg.textContent = avg ? formatPrice(avg) : '$--';
    els.previewToWin.textContent = formatMoney(toWin);
    els.previewSize.textContent = formatUnits(pos.units);
    els.previewMargin.textContent = formatMoney(pos.margin);
    updateClassByValue(els.previewToWin, toWin);
  }

  function renderWallet() {
    const totalPnl = getTotalPnl();
    els.walletBalance.textContent = formatMoney(state.walletBalance);
    els.walletCash.textContent = formatMoney(state.cash);
    els.walletMargin.textContent = formatMoney(getMarginInPlay());
    els.walletEquity.textContent = formatMoney(getEquity());
    els.walletPnl.textContent = formatMoney(totalPnl);
    updateClassByValue(els.walletPnl, totalPnl);
  }

  function renderPosition(direction, config) {
    const avg = getAverageEntry(direction);
    const pnl = getUnrealizedPnl(direction);
    const pos = getPosition(direction);

    config.avg.textContent = avg ? formatPrice(avg) : '$--';
    config.units.textContent = formatUnits(pos.units);
    config.margin.textContent = formatMoney(pos.margin);
    config.pnl.textContent = formatMoney(pnl);
    updateClassByValue(config.pnl, pnl);
    config.card.classList.toggle('has-position', pos.margin > 0);
  }

  function renderPositions() {
    renderPosition('up', {
      card: els.positionUpCard,
      avg: els.positionUpAvg,
      units: els.positionUpUnits,
      margin: els.positionUpMargin,
      pnl: els.positionUpPnl,
    });
    renderPosition('down', {
      card: els.positionDownCard,
      avg: els.positionDownAvg,
      units: els.positionDownUnits,
      margin: els.positionDownMargin,
      pnl: els.positionDownPnl,
    });
  }

  function renderHistory() {
    els.tradeHistory.innerHTML = '';
    if (!state.history.length) {
      const empty = document.createElement('div');
      empty.className = 'paper-history-empty';
      empty.textContent = 'No bot wallet trades have been recorded yet. This page is ready to display them once the wallet feed starts writing updates.';
      els.tradeHistory.appendChild(empty);
      return;
    }

    state.history.forEach(function (entry) {
      const row = document.createElement('div');
      row.className = 'paper-history-row';
      row.innerHTML = [
        '<span>' + formatTimestamp(entry.ts) + '</span>',
        '<span class="paper-history-action ' + entry.action + '">' + entry.action + '</span>',
        '<span class="paper-history-direction ' + entry.direction + '">' + entry.direction + '</span>',
        '<span>' + formatMoney(entry.amount) + '</span>',
        '<span>' + formatPrice(entry.price) + '</span>',
        '<span class="paper-history-result ' + entry.resultClass + '">' + entry.result + '</span>',
      ].join('');
      els.tradeHistory.appendChild(row);
    });
  }

  function renderPrice() {
    els.currentPrice.textContent = formatPrice(state.currentPrice);
    els.priceSource.textContent = state.priceSource;
    els.lastUpdate.textContent = formatTimestamp(state.lastPriceAt);

    const delta = Number.isFinite(state.currentPrice) && Number.isFinite(state.previousPrice)
      ? state.currentPrice - state.previousPrice
      : 0;

    if (!Number.isFinite(state.previousPrice)) {
      els.priceChange.textContent = 'Waiting for price delta';
    } else {
      const sign = delta >= 0 ? '+' : '-';
      els.priceChange.textContent = sign + '$' + Math.abs(delta).toFixed(2) + ' last tick';
    }
    updateClassByValue(els.priceChange, delta);
  }

  function renderStatus() {
    els.tradeStatus.textContent = state.lastBotAction || 'Watching for wallet feed';
    els.tradeStatus.classList.remove('is-up', 'is-down');
    const pnl = getTotalPnl();
    if (pnl > 0) els.tradeStatus.classList.add('is-up');
    if (pnl < 0) els.tradeStatus.classList.add('is-down');
  }

  function render() {
    els.feedMode.textContent = state.feedMode;
    renderPrice();
    renderWallet();
    renderPreview();
    renderPositions();
    renderHistory();
    renderStatus();
  }

  function mergePriceIntoState(price, source) {
    if (!Number.isFinite(price) || price <= 0) return;
    state.previousPrice = Number.isFinite(state.currentPrice) ? state.currentPrice : state.previousPrice;
    state.currentPrice = price;
    state.lastPriceAt = Date.now();
    state.priceSource = source;
  }

  function syncWalletState() {
    const latest = loadWalletState();
    latest.currentPrice = state.currentPrice;
    latest.previousPrice = state.previousPrice;
    latest.lastPriceAt = state.lastPriceAt;
    latest.priceSource = state.priceSource;
    latest.feedMode = state.feedMode;
    state = latest;
    render();
  }

  async function fetchRestPrice() {
    try {
      const res = await fetch(PRICE_REST_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('REST price request failed');
      const data = await res.json();
      mergePriceIntoState(Number(data.price), 'REST fallback');
      if (state.feedMode !== 'Live WebSocket') {
        state.feedMode = 'REST polling';
      }
      render();
    } catch (err) {
      state.feedMode = 'Feed error';
      render();
    }
  }

  function connectPriceSocket() {
    try {
      socket = new WebSocket(PRICE_WS_URL);
    } catch (err) {
      state.feedMode = 'Socket unavailable';
      render();
      return;
    }

    socket.addEventListener('open', function () {
      state.feedMode = 'Live WebSocket';
      render();
    });

    socket.addEventListener('message', function (event) {
      try {
        const payload = JSON.parse(event.data);
        mergePriceIntoState(Number(payload.p), 'Binance WebSocket');
        render();
      } catch (err) {
        state.feedMode = 'Feed parse error';
        render();
      }
    });

    socket.addEventListener('close', function () {
      state.feedMode = 'Reconnecting';
      render();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectPriceSocket, 3000);
    });

    socket.addEventListener('error', function () {
      state.feedMode = 'Feed error';
      render();
    });
  }

  function bindPassiveSync() {
    window.addEventListener('storage', function (event) {
      if (event.key === STORAGE_KEY) syncWalletState();
    });
    setInterval(syncWalletState, 2000);
  }

  function init() {
    render();
    fetchRestPrice();
    connectPriceSocket();
    bindPassiveSync();
    setInterval(fetchRestPrice, 12000);
  }

  init();
})();
