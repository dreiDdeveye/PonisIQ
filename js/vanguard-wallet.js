(function () {
  const STORAGE_KEY = 'vanguard_wallet_state_v1';
  const STARTING_BALANCE = 1000;
  const MAX_HISTORY = 24;
  const FIXED_RISK = 50.00; // Fixed risk amount per trade
  const WIN_MULTIPLIER = 0.8; // 80% win payout
  const LOSS_MULTIPLIER = 1.0; // 100% loss risk
  const TRADE_DURATION_MS = 15000; // Trade duration before settlement
  const PRICE_REST_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';
  const PRICE_WS_URL = 'wss://stream.binance.com:9443/ws/btcusdt@trade';
  const BINANCE_TIME_URL = 'https://api.binance.com/api/v3/time';
  const SUPABASE_URL = 'https://zrvbmzjsivxlcodsdvrb.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpydmJtempzaXZ4bGNvZHNkdnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTkxNTYsImV4cCI6MjA4ODEzNTE1Nn0.gBu0RL9tHBCjYmkiupziTPAsVX3s8TovUdMhjWPjiLw';
  const SB = {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };

  const TF_CONFIG = {
    '5m': { seconds: 300, predId: 1, lock: 195 },
    '15m': { seconds: 900, predId: 2, lock: 180 },
    '1h': { seconds: 3600, predId: 3, lock: 600 },
  };

  // ═══ TECHNICAL ANALYSIS & AUTO-TRADING ═══
  const TA = {
    priceBuffer: [],      // Last 60 prices for analysis
    rsi: null,
    momentum: null,
    signal: null,         // 'up', 'down', or null
    confidence: 0,        // 0-100%
    source: 'pending',    // 'agent' or 'self'
  };

  function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  function calculateMomentum(prices, period = 12) {
    if (prices.length < period) return 0;
    return prices[prices.length - 1] - prices[prices.length - period];
  }

  function generateAutoSignal() {
    // Generate UP/DOWN signal based on momentum + RSI + price action
    if (TA.priceBuffer.length < 15) return null;
    
    const rsi = calculateRSI(TA.priceBuffer);
    const momentum = calculateMomentum(TA.priceBuffer);
    const recentChange = TA.priceBuffer[TA.priceBuffer.length - 1] - TA.priceBuffer[TA.priceBuffer.length - 3];
    
    TA.rsi = rsi;
    TA.momentum = momentum;
    
    let signal = null;
    let confidence = 50; // Base confidence
    
    // RSI signals
    if (rsi > 70) {
      signal = 'down';     // Overbought
      confidence = Math.min(100, 50 + (rsi - 70) * 1.5);
    } else if (rsi < 30) {
      signal = 'up';       // Oversold
      confidence = Math.min(100, 50 + (30 - rsi) * 1.5);
    }
    
    // Momentum confirmation
    if (momentum > 0 && signal !== 'down') {
      signal = 'up';
      confidence = Math.min(100, confidence + 10);
    } else if (momentum < 0 && signal !== 'up') {
      signal = 'down';
      confidence = Math.min(100, confidence + 10);
    }
    
    // Price action confirmation
    if (recentChange > 0 && signal === 'up') confidence += 10;
    if (recentChange < 0 && signal === 'down') confidence += 10;
    
    TA.signal = signal;
    TA.confidence = Math.min(100, confidence);
    
    return { signal, confidence: TA.confidence };
  }

  function getBetAmount(confidence) {
    // Adjust bet size based on confidence (0-100%)
    const minBet = 2.00;
    const maxBet = 50.00;
    return minBet + ((maxBet - minBet) * (confidence / 100));
  }

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
    voteTimeframe: document.getElementById('voteTimeframe'),
    voteStatus: document.getElementById('voteStatus'),
    voteDirection: document.getElementById('voteDirection'),
    voteWindow: document.getElementById('voteWindow'),
    lastTradeType: document.getElementById('lastTradeType'),
    lastTradeDirection: document.getElementById('lastTradeDirection'),
    lastTradeEntry: document.getElementById('lastTradeEntry'),
    lastTradeResult: document.getElementById('lastTradeResult'),
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
    resetSession: document.getElementById('resetSession'),
    timeframeButtons: Array.from(document.querySelectorAll('[data-timeframe]')),
  };

  if (!els.currentPrice) return;

  // Ensure a `priceToBeat` display exists below current price
  els.priceToBeat = document.getElementById('priceToBeat');
  if (!els.priceToBeat) {
    try {
      const el = document.createElement('div');
      el.id = 'priceToBeat';
      el.className = 'price-to-beat';
      el.style.fontSize = '0.9em';
      el.style.opacity = '0.85';
      el.style.marginTop = '4px';
      el.textContent = '--';
      if (els.currentPrice && els.currentPrice.parentNode) {
        els.currentPrice.parentNode.insertBefore(el, els.currentPrice.nextSibling);
        els.priceToBeat = el;
      }
    } catch (err) {
      els.priceToBeat = { textContent: '' };
    }
  }

  let socket = null;
  let reconnectTimer = null;
  let tradeCloseTimer = null;
  let activeTF = '5m';
  let liveVote = { direction: 'pending', locked: false, windowStart: null, updatedAt: null, stale: false };
  let currentWindow = null; // Track current trading window
  let hasTradedInWindow = false; // Prevent multiple trades per window
  let openTrade = null;
  let lastSignalLockTime = null; // Track when signal became locked for logging
  let state = loadState();
  let timeOffsetMs = 0; // serverTime - localTime (ms)

  function getNowSec() {
    return Math.floor((Date.now() + timeOffsetMs) / 1000);
  }

  async function syncServerTime() {
    try {
      const res = await fetch(BINANCE_TIME_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('time sync failed');
      const data = await res.json();
      const server = Number(data.serverTime);
      if (Number.isFinite(server)) {
        timeOffsetMs = server - Date.now();
        console.log('[VANGUARD WALLET] Time synchronized with server, offset (ms):', timeOffsetMs);
      }
    } catch (err) {
      console.warn('[VANGUARD WALLET] Time sync failed:', err);
    }
  }

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
      lastAction: 'Loading automatic trading system. Trades execute automatically on locked votes.',
      activeDirection: 'pending',
      positions: {
        up: { margin: 0, units: 0 },
        down: { margin: 0, units: 0 },
      },
      history: [],
      lastTrade: {
        type: '--',
        direction: '--',
        entryPrice: null,
        result: '--',
      },
      priceToBeat: null,
    };
  }

  function normalizeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeDirection(direction) {
    if (!direction || typeof direction !== 'string') return 'pending';
    const value = String(direction).trim().toLowerCase();
    if (value === 'over' || value === 'up') return 'up';
    if (value === 'under' || value === 'down') return 'down';
    return 'pending';
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
      action: typeof (item && item.action) === 'string' ? item.action : 'watch',
      direction: typeof (item && item.direction) === 'string' ? item.direction : 'pending',
      amount: normalizeNumber(item && item.amount, 0),
      price: normalizeNumber(item && item.price, null),
      result: typeof (item && item.result) === 'string' ? item.result : 'OPEN',
      resultClass: typeof (item && item.resultClass) === 'string' ? item.resultClass : 'flat',
      timeframe: typeof (item && item.timeframe) === 'string' ? item.timeframe : '15m',
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
      lastAction: typeof raw.lastAction === 'string' ? raw.lastAction : base.lastAction,
      activeDirection: raw.activeDirection === 'up' || raw.activeDirection === 'down' ? raw.activeDirection : 'pending',
      positions: {
        up: normalizePosition(raw.positions && raw.positions.up),
        down: normalizePosition(raw.positions && raw.positions.down),
      },
      history: Array.isArray(raw.history) ? raw.history.slice(0, MAX_HISTORY).map(normalizeHistoryItem) : [],
      lastTrade: raw.lastTrade && typeof raw.lastTrade === 'object' ? {
        type: typeof raw.lastTrade.type === 'string' ? raw.lastTrade.type : '--',
        direction: typeof raw.lastTrade.direction === 'string' ? raw.lastTrade.direction : '--',
        entryPrice: normalizeNumber(raw.lastTrade.entryPrice, null),
        result: typeof raw.lastTrade.result === 'string' ? raw.lastTrade.result : '--',
      } : base.lastTrade,
      priceToBeat: normalizeNumber(raw.priceToBeat, null),
    };
  }

  function loadState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch (err) {
      return createDefaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    if (!Number.isFinite(ts)) return '--';
    return new Date(ts).toLocaleTimeString();
  }

  function getWindowStart(nowSec, timeframe) {
    const size = TF_CONFIG[timeframe].seconds;
    return Math.floor(nowSec / size) * size;
  }

  function getSecondsLeft(timeframe) {
    const nowSec = getNowSec();
    const start = getWindowStart(nowSec, timeframe);
    return TF_CONFIG[timeframe].seconds - (nowSec - start);
  }

  function isPredictionForCurrentWindow(pred) {
    if (!pred) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    const activeWindow = getWindowStart(nowSec, activeTF);
    const predWindow = pred.window_start != null ? Number(pred.window_start) : null;
    if (predWindow != null) return predWindow === activeWindow;
    if (pred.updated_at) {
      const updatedMs = Date.parse(pred.updated_at);
      return !Number.isNaN(updatedMs) && updatedMs >= activeWindow * 1000;
    }
    return false;
  }

  function isVoteLockedForCurrentWindow(pred) {
    // CRITICAL: Validate agent signal is locked and for CURRENT window
    // A vote is "locked" only when:
    // 1. Direction is definitive (UP/DOWN, not pending)
    // 2. Window start matches current market window
    // 3. Prediction data exists and is valid
    
    if (!pred || typeof pred !== 'object') return false;
    
    const direction = normalizeDirection(pred.direction);
    const isDefinitive = direction === 'up' || direction === 'down';
    
    if (!isDefinitive) return false; // No signal yet = not locked
    
    const nowSec = Math.floor(Date.now() / 1000);
    const currentWindow = getWindowStart(nowSec, activeTF);
    const predWindow = pred.window_start != null ? Number(pred.window_start) : null;
    
    // Ensure prediction is for CURRENT window, not stale
    if (predWindow === null || predWindow === undefined) return false;
    if (predWindow !== currentWindow) return false; // Stale/old window = not locked
    
    // Signal is locked: Direction is UP/DOWN + current window match
    return true;
  }

  function scheduleTradeClose() {
    if (tradeCloseTimer) {
      clearTimeout(tradeCloseTimer);
      tradeCloseTimer = null;
    }
    // Schedule the trade to close at the end of the active timeframe window
    // Use synced server time via getNowSec() to compute precise window end
    try {
      const secsLeft = getSecondsLeft(activeTF);
      // If secsLeft is valid and > 0, wait until window end + small buffer; otherwise fallback
      const waitMs = (secsLeft && secsLeft > 0) ? (secsLeft * 1000) + 800 : TRADE_DURATION_MS;
      tradeCloseTimer = setTimeout(closeOpenTrade, waitMs);
    } catch (err) {
      // Fallback: close after default trade duration
      tradeCloseTimer = setTimeout(closeOpenTrade, TRADE_DURATION_MS);
    }
  }

  function startLockedTrade(direction, source = 'agent', betAmount = FIXED_RISK) {
    if (!Number.isFinite(state.currentPrice)) {
      setStatus('Price unavailable. Cannot start trade yet.', 'down');
      return;
    }
    if (openTrade) return; // Trade already in progress

    const entryPrice = state.currentPrice;
    const units = betAmount / entryPrice; // Calculate BTC units for this trade
    
    openTrade = {
      direction: direction,
      entryPrice,
      units: units,
      betAmount: betAmount,
      source: source, // 'agent' or 'self'
      startTime: Date.now(),
      durationMs: TRADE_DURATION_MS,
      timeframe: activeTF,
    };

    // Update position tracker immediately
    state.positions[direction].margin += betAmount;
    state.positions[direction].units += units;

    state.lastTrade = {
      type: 'BUY',
      direction,
      entryPrice,
      result: 'OPEN',
      exitPrice: null,
      source: source,
    };

    // LOG: Trade execution with source
    lastSignalLockTime = Date.now();
    const sourceLabel = source === 'agent' ? '🤖 AGENT' : '📊 SELF-TRADE';
    console.log('[VANGUARD WALLET] ' + sourceLabel + ' → TRADE EXECUTED', {
      timeframe: activeTF,
      direction: direction,
      entryPrice: entryPrice,
      units: units.toFixed(8),
      betAmount: betAmount,
      confidence: TA.confidence || '-',
      lockTime: new Date(lastSignalLockTime).toISOString(),
    });

    const statusMsg = source === 'agent' 
      ? '✓ AGENT SIGNAL: ' + direction.toUpperCase() + ' @ ' + formatPrice(entryPrice) + '.'
      : '✓ AUTO-TRADE: ' + direction.toUpperCase() + ' @ ' + formatPrice(entryPrice) + ' (RSI: ' + (TA.rsi ? TA.rsi.toFixed(0) : '--') + ')';
    
    setStatus(statusMsg, 'up');
    scheduleTradeClose();
    render();
  }

  function closeOpenTrade() {
    if (!openTrade) return;
    if (!Number.isFinite(state.currentPrice)) {
      setStatus('Price unavailable. Waiting to settle trade.', 'down');
      scheduleTradeClose();
      return;
    }

    const direction = openTrade.direction;
    const entryPrice = openTrade.entryPrice;
    const exitPrice = state.currentPrice;
    const units = openTrade.units;
    const betAmount = openTrade.betAmount;
    const source = openTrade.source || 'agent';
    const priceDelta = exitPrice - entryPrice;
    const isWin = direction === 'up' ? exitPrice > entryPrice : exitPrice < entryPrice;
    const pnl = isWin ? betAmount * WIN_MULTIPLIER : -betAmount;
    
    // Remove from active positions
    state.positions[direction].margin -= betAmount;
    state.positions[direction].units -= units;
    
    // Ensure no negative/floating point errors
    state.positions[direction].margin = Math.max(0, state.positions[direction].margin);
    state.positions[direction].units = Math.max(0, state.positions[direction].units);
    
    state.realizedPnl += pnl;
    state.walletBalance = STARTING_BALANCE + state.realizedPnl;

    recordTrade('trade', direction, betAmount, entryPrice, pnl, exitPrice, source);
    
    // LOG: Trade settlement
    const sourceLabel = source === 'agent' ? '🤖 AGENT' : '📊 SELF';
    console.log('[VANGUARD WALLET] ' + sourceLabel + ' TRADE SETTLED', {
      direction: direction,
      entry: entryPrice,
      exit: exitPrice,
      delta: priceDelta.toFixed(2),
      units: units.toFixed(8),
      result: isWin ? 'WIN' : 'LOSS',
      pnl: pnl,
      balance: state.walletBalance,
    });
    
    setStatus('✓ Trade ' + (isWin ? 'WIN' : 'LOSS') + ': ' + direction.toUpperCase() + ' @ ' + formatPrice(entryPrice) + ' → ' + formatPrice(exitPrice) + ' (' + (isWin ? '+' : '') + formatMoney(pnl) + ')', 
               isWin ? 'up' : 'down');

    openTrade = null;
    hasTradedInWindow = true;
    if (tradeCloseTimer) {
      clearTimeout(tradeCloseTimer);
      tradeCloseTimer = null;
    }
    render();
  }

  function getPosition(direction) {
    return state.positions[direction];
  }

  function getAverageEntry(direction) {
    const pos = getPosition(direction);
    if (!pos.margin || !pos.units) return null;
    return pos.margin / pos.units;
  }

  function getUnrealizedPnl(direction) {
    const pos = getPosition(direction);
    const avg = getAverageEntry(direction);
    if (!pos.units || !avg || !Number.isFinite(state.currentPrice)) return 0;
    return direction === 'up'
      ? pos.units * (state.currentPrice - avg)
      : pos.units * (avg - state.currentPrice);
  }

  function getMarginInPlay() {
    return state.positions.up.margin + state.positions.down.margin;
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

  function setStatus(message, tone) {
    els.tradeStatus.textContent = message;
    els.tradeStatus.classList.remove('is-up', 'is-down');
    if (tone === 'up') els.tradeStatus.classList.add('is-up');
    if (tone === 'down') els.tradeStatus.classList.add('is-down');
    state.lastAction = message;
  }

  function renderVote() {
    els.voteTimeframe.textContent = activeTF.toUpperCase();
    const statusText = liveVote.locked ? 'LOCKED' : liveVote.stale ? 'WAITING (stale)' : 'WAITING';
    els.voteStatus.textContent = statusText;
    els.voteDirection.textContent = liveVote.direction ? liveVote.direction.toUpperCase() : '--';
    const windowText = liveVote.windowStart
      ? new Date(liveVote.windowStart * 1000).toLocaleTimeString()
      : '--';
    els.voteWindow.textContent = liveVote.stale ? windowText + ' (old)' : windowText;
    updateClassByValue(els.voteStatus, liveVote.locked ? 1 : -1);
    updateClassByValue(els.voteDirection, liveVote.direction === 'up' ? 1 : liveVote.direction === 'down' ? -1 : 0);
  }

  function renderPrice() {
    els.currentPrice.textContent = formatPrice(state.currentPrice);
    els.priceSource.textContent = state.priceSource;
    els.lastUpdate.textContent = state.lastPriceAt ? formatTimestamp(state.lastPriceAt) : 'No update yet';
    const delta = Number.isFinite(state.currentPrice) && Number.isFinite(state.previousPrice)
      ? state.currentPrice - state.previousPrice
      : 0;
    els.priceChange.textContent = Number.isFinite(state.previousPrice)
      ? (delta >= 0 ? '+' : '-') + '$' + Math.abs(delta).toFixed(2) + ' last tick'
      : 'Waiting for first tick';
    updateClassByValue(els.priceChange, delta);
    // Show price-to-beat (agent target) below current price if available
    if (els.priceToBeat) {
      if (Number.isFinite(state.priceToBeat)) {
        els.priceToBeat.textContent = 'Price to beat: ' + formatPrice(state.priceToBeat);
        els.priceToBeat.className = 'price-to-beat has-value';
      } else {
        els.priceToBeat.textContent = 'Price to beat: --';
        els.priceToBeat.className = 'price-to-beat';
      }
    }
  }

  function renderWallet() {
    state.walletBalance = STARTING_BALANCE + state.realizedPnl;
    const totalPnl = getTotalPnl();
    els.walletBalance.textContent = formatMoney(state.walletBalance);
    els.walletCash.textContent = formatMoney(state.cash);
    els.walletMargin.textContent = formatMoney(getMarginInPlay());
    els.walletEquity.textContent = formatMoney(getEquity());
    els.walletPnl.textContent = formatMoney(totalPnl);
    updateClassByValue(els.walletPnl, totalPnl);
  }

  function renderLastTrade() {
    els.lastTradeType.textContent = state.lastTrade.type;
    els.lastTradeDirection.textContent = state.lastTrade.direction.toUpperCase();
    els.lastTradeEntry.textContent = formatPrice(state.lastTrade.entryPrice);
    els.lastTradeResult.textContent = state.lastTrade.result;
    updateClassByValue(els.lastTradeResult, state.lastTrade.result === 'WIN' ? 1 : state.lastTrade.result === 'LOSS' ? -1 : 0);
  }

  function renderPosition(direction, refs) {
    const pos = getPosition(direction);
    const avg = getAverageEntry(direction);
    const pnl = getUnrealizedPnl(direction);
    refs.avg.textContent = avg ? formatPrice(avg) : '$--';
    refs.units.textContent = formatUnits(pos.units);
    refs.margin.textContent = formatMoney(pos.margin);
    refs.pnl.textContent = formatMoney(pnl);
    refs.card.classList.toggle('has-position', pos.margin > 0);
    updateClassByValue(refs.pnl, pnl);
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
      empty.textContent = 'No automatic trades yet. Waiting for bot vote confirmation and locked decision.';
      els.tradeHistory.appendChild(empty);
      return;
    }

    state.history.forEach(function (entry) {
      const row = document.createElement('div');
      row.className = 'paper-history-row';
      row.innerHTML = [
        '<span>' + new Date(entry.ts).toLocaleString() + '</span>',
        '<span class="paper-history-action ' + entry.action.toLowerCase() + '">' + entry.action + ' ' + entry.timeframe.toUpperCase() + '</span>',
        '<span class="paper-history-direction ' + entry.direction + '">' + entry.direction.toUpperCase() + '</span>',
        '<span>' + formatMoney(entry.amount) + '</span>',
        '<span>' + formatPrice(entry.price) + '</span>',
        '<span>' + (entry.exitPrice != null ? formatPrice(entry.exitPrice) : '--') + '</span>',
        '<span class="paper-history-result ' + entry.resultClass + '">' + entry.result + '</span>',
      ].join('');
      els.tradeHistory.appendChild(row);
    });
  }

  function render() {
    els.feedMode.textContent = state.feedMode;
    renderVote();
    renderPrice();
    renderWallet();
    renderLastTrade();
    renderPositions();
    renderHistory();
  }

  function recordTrade(action, direction, amount, entryPrice, realizedPnl, exitPrice, source = 'agent') {
    const pnl = normalizeNumber(realizedPnl, 0);
    const result = pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'OPEN';
    const sourceLabel = source === 'agent' ? '🤖' : '📊';
    state.history.unshift({
      ts: Date.now(),
      timeframe: activeTF,
      action: action.toUpperCase() + ' ' + sourceLabel,
      direction: direction,
      amount: amount,
      price: entryPrice,
      exitPrice: exitPrice != null ? exitPrice : null,
      result: pnl > 0 ? 'WIN ' + formatMoney(pnl) : pnl < 0 ? 'LOSS ' + formatMoney(pnl) : 'OPEN',
      resultClass: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'flat',
      source: source,
    });
    state.history = state.history.slice(0, MAX_HISTORY);

    state.lastTrade = {
      type: action.toUpperCase(),
      direction: direction,
      entryPrice: entryPrice,
      result: result,
      exitPrice: exitPrice != null ? exitPrice : null,
      source: source,
    };
  }

  function checkAutomaticTrading() {
    const nowSec = getNowSec();
    const currentWindowStart = getWindowStart(nowSec, activeTF);

    // Reset if we've entered a new window
    if (currentWindow !== currentWindowStart) {
      currentWindow = currentWindowStart;
      hasTradedInWindow = false;
      openTrade = null;
      if (tradeCloseTimer) {
        clearTimeout(tradeCloseTimer);
        tradeCloseTimer = null;
      }
      console.log('[VANGUARD WALLET] New window detected', {
        window: currentWindowStart,
        timeframe: activeTF,
      });
    }

    // CRITICAL: Only trade on locked signal
    const canTrade = liveVote.locked && 
                     !openTrade && 
                     !hasTradedInWindow && 
                     !liveVote.stale && 
                     (liveVote.direction === 'up' || liveVote.direction === 'down');

    if (canTrade) {
      console.log('[VANGUARD WALLET] Trading conditions met - executing locked trade (agent)');
      startLockedTrade(liveVote.direction, 'agent', FIXED_RISK);
      return;
    }

    // If agent is pending, attempt self-trade fallback using TA
    if (!liveVote.locked && liveVote.direction === 'pending' && !openTrade && !hasTradedInWindow && !liveVote.stale) {
      const auto = generateAutoSignal();
      if (auto && auto.signal) {
        const minConfidence = 60;
        if (auto.confidence >= minConfidence) {
          const bet = parseFloat(getBetAmount(auto.confidence).toFixed(2));
          console.log('[VANGUARD WALLET] Agent pending — executing SELF-TRADE', { signal: auto.signal, confidence: auto.confidence, bet });
          startLockedTrade(auto.signal, 'self', bet);
          return;
        } else {
          console.log('[VANGUARD WALLET] Auto-signal confidence too low', { signal: auto.signal, confidence: auto.confidence });
        }
      } else {
        console.log('[VANGUARD WALLET] No auto-signal generated yet');
      }
    }

    if (liveVote.locked === false) {
      // Log why we're not trading
      if (openTrade) {
        console.log('[VANGUARD WALLET] Trade already open for this window');
      } else if (hasTradedInWindow) {
        console.log('[VANGUARD WALLET] Already traded in this window (single trade per window rule)');
      } else if (liveVote.stale) {
        console.log('[VANGUARD WALLET] Signal is stale (not from current window)');
      } else if (liveVote.direction === 'pending') {
        console.log('[VANGUARD WALLET] Signal still pending');
      }
    }
  }

  function resetWallet() {
    state = createDefaultState();
    saveState();
    setStatus('VANGUARD WALLET reset to fixed $50.00 balance.', 'up');
    render();
  }

  async function fetchLiveVote() {
    try {
      const predId = TF_CONFIG[activeTF].predId;
      const url = SUPABASE_URL + '/rest/v1/live_prediction?id=eq.' + predId + '&select=*';
      const res = await fetch(url, { headers: SB });
      if (!res.ok) throw new Error('live_prediction request failed');
      const rows = await res.json();
      const pred = rows && rows[0] ? rows[0] : null;
      const direction = normalizeDirection(pred && pred.direction);
      const nowSec = getNowSec();
      const activeWindow = getWindowStart(nowSec, activeTF);
      const predWindow = pred && pred.window_start != null ? Number(pred.window_start) : null;
      
      // CRITICAL: Check if signal is locked
      const wasLocked = liveVote.locked;
      const isNowLocked = isVoteLockedForCurrentWindow(pred);
      const isStale = !!pred && predWindow != null && predWindow !== activeWindow;

      liveVote = {
        direction: direction,
        locked: isNowLocked,
        windowStart: predWindow,
        updatedAt: pred && pred.updated_at ? pred.updated_at : null,
        stale: isStale,
      };

      // If the prediction includes a BTC price target, store it as the price-to-beat
      state.priceToBeat = pred && pred.btc_price ? normalizeNumber(pred.btc_price, null) : null;

      // LOG: Signal lock state transitions
      if (!wasLocked && isNowLocked) {
        console.log('[VANGUARD WALLET] SIGNAL LOCKED', {
          timeframe: activeTF,
          direction: direction,
          window: predWindow,
          timestamp: new Date().toISOString(),
        });
        // Immediately execute the agent's final vote when it becomes locked
        if (!openTrade && !hasTradedInWindow && !isStale && (direction === 'up' || direction === 'down')) {
          console.log('[VANGUARD WALLET] SIGNAL LOCKED - executing agent trade immediately');
          startLockedTrade(direction, 'agent', FIXED_RISK);
        }
      }

      // Provide clear status about current signal state
      if (isStale) {
        setStatus('⚠ Last signal is stale (window: ' + new Date(predWindow * 1000).toLocaleTimeString() + '). Waiting for current window.', 'down');
      } else if (!isNowLocked) {
        if (direction === 'pending') {
          setStatus('⏳ ' + activeTF.toUpperCase() + ' signal pending. Waiting for agent to generate prediction...', 'down');
        } else {
          setStatus('🔄 ' + activeTF.toUpperCase() + ' signal active (' + direction.toUpperCase() + ') but not locked yet...', 'down');
        }
      }
      // If locked, status will be set by trade execution

      render();
      checkAutomaticTrading(); // Check for automatic trades after vote update
    } catch (err) {
      liveVote = { direction: 'pending', locked: false, windowStart: null, updatedAt: null, stale: false };
      setStatus('✗ Cannot fetch signal. Retrying...', 'down');
      console.error('[VANGUARD WALLET] Signal fetch error:', err);
      render();
    }
  }

  function mergePrice(price, source) {
    if (!Number.isFinite(price) || price <= 0) return;
    state.previousPrice = Number.isFinite(state.currentPrice) ? state.currentPrice : state.previousPrice;
    state.currentPrice = price;
    state.lastPriceAt = Date.now();
    state.priceSource = source;
    
    // Add to technical analysis buffer
    TA.priceBuffer.push(price);
    if (TA.priceBuffer.length > 60) TA.priceBuffer.shift(); // Keep last 60 prices
    
    saveState();
    render();
  }

  async function fetchRestPrice() {
    try {
      const res = await fetch(PRICE_REST_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('REST price request failed');
      const data = await res.json();
      mergePrice(Number(data.price), 'REST fallback');
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
        mergePrice(Number(payload.p), 'Binance WebSocket');
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

  function bindControls() {
    els.timeframeButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        activeTF = button.dataset.timeframe || '15m';
        currentWindow = null; // Reset window tracking on timeframe change
        hasTradedInWindow = false;
        fetchLiveVote();
      });
    });

    if (els.resetSession) {
      els.resetSession.addEventListener('click', resetWallet);
    }
  }

  function init() {
    bindControls();
    render();
    
    // Log wallet initialization
    console.log('[VANGUARD WALLET] Initialized', {
      capital: STARTING_BALANCE,
      riskPerTrade: FIXED_RISK,
      tradeDuration: TRADE_DURATION_MS,
      mode: 'Automatic - Locked Signal Execution',
    });
    console.log('[VANGUARD WALLET] Listening for locked signals from VANGUARD AGENT...');

    fetchRestPrice();
    fetchLiveVote();
    connectPriceSocket();
    // Sync server time then keep it refreshed
    syncServerTime();
    setInterval(syncServerTime, 60000); // refresh every minute
    setInterval(fetchRestPrice, 12000);
    setInterval(fetchLiveVote, 1000); // poll live vote every second for precise alignment
    setInterval(checkAutomaticTrading, 500); // check twice a second for timely execution
  }

  init();
})();
