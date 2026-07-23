// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Ponis IQ Agent â€” Browser-side live BTC prediction dashboard
// Connects to Polymarket RTDS, Binance, and Supabase
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

(function () {
  'use strict';

  window.VANGUARD_AGENT_CORE_LOADED = true;

  // â”€â”€ Supabase config â€” direct REST API (no client SDK needed) â”€â”€
  const SUPABASE_URL = 'https://zrvbmzjsivxlcodsdvrb.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpydmJtempzaXZ4bGNvZHNkdnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTkxNTYsImV4cCI6MjA4ODEzNTE1Nn0.gBu0RL9tHBCjYmkiupziTPAsVX3s8TovUdMhjWPjiLw';
  const SB_HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // ACCESS GATE â€” Request â†’ Admin approves â†’ Code appears
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  const ACCESS_LS_KEY    = 'vg_access_code';
  const SESSION_LS_KEY   = 'vg_req_session';
  let   pollTimer        = null;

  function isUnlocked() {
    return true;
  }

  // Validate stored code against Supabase
  // Returns: 'valid' | 'revoked' | 'deleted'
  async function getCodeStatus() {
    return 'valid';
  }

  async function validateStoredCode() {
    const status = await getCodeStatus();
    return status === 'valid';
  }

  // Generate a unique session ID for this browser
  function getOrCreateSession() {
    let sid;
    try { sid = localStorage.getItem(SESSION_LS_KEY); } catch(e) {}
    if (!sid) {
      sid = 'REQ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      try { localStorage.setItem(SESSION_LS_KEY, sid); } catch(e) {}
    }
    return sid;
  }

  // Submit a request to Supabase
  async function submitRequest(note) {
    const sid = getOrCreateSession();
    const row = { session_id: sid, status: 'pending', note: note || null };
    try {
      // Upsert â€” if session already requested, update the note
      const res = await fetch(SUPABASE_URL + '/rest/v1/code_requests', {
        method: 'POST',
        headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(await res.text());
      return sid;
    } catch(e) {
      console.error('[AGENT] Request error:', e);
      throw e;
    }
  }

  // Poll Supabase every 5s to check if admin fulfilled the request
  function startPolling(sid) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async function() {
      try {
        const res = await fetch(
          SUPABASE_URL + '/rest/v1/code_requests?session_id=eq.' + encodeURIComponent(sid) + '&select=status,code',
          { headers: SB_HEADERS }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!data || data.length === 0) return;
        const req = data[0];

        if (req.status === 'fulfilled' && req.code) {
          clearInterval(pollTimer);
          showReceivedCode(req.code);
        }
      } catch(e) { /* retry next tick */ }
    }, 5000);
  }

  // Show the code that admin generated â€” user can copy & paste
  function showReceivedCode(code) {
    const reqView   = document.getElementById('agentReqView');
    const codeView  = document.getElementById('agentCodeReceivedView');
    const codeEl    = document.getElementById('agentReceivedCode');
    const inputEl   = document.getElementById('agentCodeInput');
    if (reqView)  reqView.style.display  = 'none';
    if (codeView) codeView.style.display = 'block';
    if (codeEl)   codeEl.textContent = code;
    // Auto-fill the unlock input
    if (inputEl)  inputEl.value = code;
    setAccessMsg('success', 'Your code is ready! Click Unlock to continue.');
  }

  // Claim and unlock
  async function claimCode(code) {
    const unlockBtn = document.getElementById('agentUnlockBtn');
    if (!code || code.trim() === '') { setAccessMsg('error', 'Please enter your access code.'); return; }
    unlockBtn.disabled = true;
    setAccessMsg('info', 'Verifying...');
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/access_codes?code=eq.' + encodeURIComponent(code.trim().toUpperCase()) + '&claimed=eq.false',
        { headers: SB_HEADERS }
      );
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      if (!data || data.length === 0) {
        setAccessMsg('error', 'Invalid or already used code. Request a new one below.');
        unlockBtn.disabled = false;
        // Clear old session so they can request again
        try { localStorage.removeItem(SESSION_LS_KEY); } catch(e) {}
        clearInterval(pollTimer);
        // Show request form again
        const reqView  = document.getElementById('agentReqView');
        const waitView = document.getElementById('agentWaitView');
        const codeView = document.getElementById('agentCodeReceivedView');
        const reqBtn   = document.getElementById('agentReqBtn');
        if (reqView)  reqView.style.display  = 'block';
        if (waitView) waitView.style.display = 'none';
        if (codeView) codeView.style.display = 'none';
        if (reqBtn)   { reqBtn.disabled = false; reqBtn.textContent = 'Request Access'; }
        return;
      }
      // Mark claimed
      await fetch(
        SUPABASE_URL + '/rest/v1/access_codes?code=eq.' + encodeURIComponent(code.trim().toUpperCase()),
        { method: 'PATCH', headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ claimed: true, claimed_at: new Date().toISOString() }) }
      );
      try { localStorage.setItem(ACCESS_LS_KEY, code.trim().toUpperCase()); } catch(e) {}
      // Clean up request session
      try { localStorage.removeItem(SESSION_LS_KEY); } catch(e) {}
      setAccessMsg('success', 'Access granted! Loading...');
      clearInterval(pollTimer);
      setTimeout(unlockUI, 700);
    } catch (e) {
      setAccessMsg('error', 'Error verifying code. Try again.');
      unlockBtn.disabled = false;
    }
  }

  function setAccessMsg(type, text) {
    const msg = document.getElementById('agentAccessMsg');
    if (!msg) return;
    msg.className = 'agent-access-msg ' + type;
    msg.textContent = text;
  }

  function unlockUI() {
    const gate = document.getElementById('agentAccessGate');
    const wrap = document.getElementById('agentContentWrap');
    if (gate) gate.classList.remove('visible');
    if (wrap) wrap.classList.remove('locked');
    startAgent();
  }

  function showAccessGate() {
    const gate = document.getElementById('agentAccessGate');
    const wrap = document.getElementById('agentContentWrap');
    if (gate) gate.classList.add('visible');
    if (wrap) wrap.classList.add('locked');

    const reqBtn    = document.getElementById('agentReqBtn');
    const unlockBtn = document.getElementById('agentUnlockBtn');
    const input     = document.getElementById('agentCodeInput');
    const noteInput = document.getElementById('agentReqNote');
    const copyBtn   = document.getElementById('agentCopyReceivedBtn');

    // Request button
    if (reqBtn) reqBtn.addEventListener('click', async function() {
      const note = noteInput ? noteInput.value.trim() : '';

      if (!note) {
        setAccessMsg('error', 'Please enter your name or Discord username.');
        return;
      }

      reqBtn.disabled = true;
      reqBtn.textContent = 'Checking...';
      setAccessMsg('info', 'Checking username...');

      // Check if username already exists in requests
      try {
        const checkRes = await fetch(
          SUPABASE_URL + '/rest/v1/code_requests?note=eq.' + encodeURIComponent(note) + '&select=id,status',
          { headers: SB_HEADERS }
        );
        if (checkRes.ok) {
          const existing = await checkRes.json();
          if (existing && existing.length > 0) {
            setAccessMsg('error', 'Username "' + note + '" is already taken. Please use a different name.');
            reqBtn.disabled = false;
            reqBtn.textContent = 'Request Access';
            if (noteInput) { noteInput.focus(); noteInput.select(); }
            return;
          }
        }
      } catch(e) { /* continue if check fails */ }

      reqBtn.textContent = 'Sending...';
      setAccessMsg('info', 'Sending request...');
      try {
        const sid = await submitRequest(note);
        document.getElementById('agentReqView').style.display = 'none';
        document.getElementById('agentWaitView').style.display = 'block';
        setAccessMsg('info', 'Request sent! Waiting for admin to approve...');
        startPolling(sid);
      } catch(e) {
        setAccessMsg('error', 'Failed to send request. Try again.');
        reqBtn.disabled = false;
        reqBtn.textContent = 'Request Access';
      }
    });

    // Unlock button
    if (unlockBtn) unlockBtn.addEventListener('click', function() {
      claimCode(input ? input.value : '');
    });
    if (input) input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') claimCode(input.value);
    });

    // Copy received code
    if (copyBtn) copyBtn.addEventListener('click', function() {
      const codeEl = document.getElementById('agentReceivedCode');
      if (codeEl && codeEl.textContent) {
        navigator.clipboard.writeText(codeEl.textContent).then(function() {
          copyBtn.textContent = '\u2713 Copied';
          setTimeout(function() { copyBtn.textContent = 'Copy Code'; }, 1500);
        });
      }
    });

    // Check if there's a pending session already
    let existingSid;
    try { existingSid = localStorage.getItem(SESSION_LS_KEY); } catch(e) {}
    if (existingSid) {
      // Resume polling â€” might already be fulfilled
      document.getElementById('agentReqView').style.display = 'none';
      document.getElementById('agentWaitView').style.display = 'block';
      setAccessMsg('info', 'Waiting for admin approval...');
      startPolling(existingSid);
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // TIMEFRAME CONFIG
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const globalCfg = window.VANGUARD_AGENT_BOOTSTRAP || {};
  const DEFAULT_TF_CONFIG = {
    '5m': {
      label:       '5 MIN',
      seconds:     300,
      interval:    '5m',
      source:      'vanguard',
      livePredId:  1,
      historyTable:'predictions',
      historySources: ['vanguard', 'vanguard-skip', 'vanguard-bot', 'vanguard-bot-skip'],
      timing:      { analyze: 210, lock: 195 },
      predictionMode: 'local',
      subtitle:    'Live BTC 5-minute predictions powered by AI + on-chain data.',
      modelDetail: '5-min BTC Prediction',
      slugPrefix:  'btc-updown-5m-',
    },
    '15m': {
      label:       '15 MIN',
      seconds:     900,
      interval:    '15m',
      source:      'vanguard-bot-15m',
      livePredId:  2,
      historyTable:'predictions_15m',
      historySources: ['vanguard-bot-15m', 'vanguard-bot-15m-skip'],
      timing:      { analyze: 225, lock: 180 },
      predictionMode: 'live',
      subtitle:    'Live BTC 15-minute predictions powered by AI + on-chain data.',
      modelDetail: '15-min BTC Prediction',
      slugPrefix:  'btc-updown-15m-',
    },
    '1h': {
      label:       '1 HOUR',
      seconds:     3600,
      interval:    '1h',
      source:      'vanguard-bot-1h',
      livePredId:  3,
      historyTable:'predictions_1h',
      historySources: ['vanguard-bot-1h', 'vanguard-bot-1h-skip'],
      timing:      { analyze: 720, lock: 600 },
      predictionMode: 'live',
      subtitle:    'Live BTC 1-hour predictions powered by AI + on-chain data.',
      modelDetail: '1-Hour BTC Prediction',
      slugPrefix:  'btc-updown-1h-',
    },
  };

  function mergeTimeframeConfig(defaultCfg, overrideCfg) {
    const merged = Object.assign({}, defaultCfg || {}, overrideCfg || {});
    merged.timing = Object.assign({}, (defaultCfg && defaultCfg.timing) || {}, (overrideCfg && overrideCfg.timing) || {});
    merged.historySources = Array.isArray((overrideCfg && overrideCfg.historySources))
      ? overrideCfg.historySources.slice()
      : Array.isArray((defaultCfg && defaultCfg.historySources))
        ? defaultCfg.historySources.slice()
        : [];
    return merged;
  }

  function buildTimeframeConfig(rawCfg) {
    const output = {};
    Object.keys(DEFAULT_TF_CONFIG).forEach(function(key) {
      output[key] = mergeTimeframeConfig(DEFAULT_TF_CONFIG[key], rawCfg && rawCfg[key]);
    });
    if (rawCfg) {
      Object.keys(rawCfg).forEach(function(key) {
        if (!output[key]) output[key] = mergeTimeframeConfig({}, rawCfg[key]);
      });
    }
    return output;
  }

  const TF_CONFIG = buildTimeframeConfig(globalCfg.timeframes || {});

  function getHistorySources(tf) {
    const cfg = TF_CONFIG[tf] || {};
    const sources = [];

    function addSource(value) {
      if (value && sources.indexOf(value) === -1) sources.push(value);
    }

    if (Array.isArray(cfg.historySources) && cfg.historySources.length > 0) {
      cfg.historySources.forEach(addSource);
    } else {
      addSource(cfg.source || '');
      addSource((cfg.source || '') + '-skip');
    }

    return sources;
  }

  let activeTF = globalCfg.defaultTF || '5m';

  function getWindowStart(timestampSecs, tf) {
    const targetTF = tf || activeTF;
    const winSecs = TF_CONFIG[targetTF].seconds;
    return Math.floor(timestampSecs / winSecs) * winSecs;
  }

  function getPtbCacheKey(tf, windowStart) {
    const targetTF = tf || activeTF;
    const targetWindowStart = windowStart != null
      ? windowStart
      : getWindowStart(Math.floor(Date.now() / 1000), targetTF);
    return 'vg_ptb_' + targetTF + '_' + targetWindowStart;
  }

  function getChartWindowBounds(tf) {
    const targetTF = tf || activeTF;
    const nowSecs = Math.floor(Date.now() / 1000);
    const startSecs = getWindowStart(nowSecs, targetTF);
    const windowMs = TF_CONFIG[targetTF].seconds * 1000;
    return {
      startMs: startSecs * 1000,
      endMs: (startSecs * 1000) + windowMs,
    };
  }

  function parseStoredBool(value) {
    if (value === true || value === 'true' || value === 't' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 'f' || value === 0 || value === '0') return false;
    return null;
  }

  function getHistorySnapshot(predictions) {
    if (!predictions || predictions.length === 0) return 'empty';
    return predictions.slice(0, 100).map(function(p) {
      return [
        Number(p.ts) || 0,
        p.source || '',
        p.ptb == null ? 'null' : p.ptb,
        p.end_price == null ? 'null' : p.end_price,
        parseStoredBool(p.over),
      ].join(':');
    }).join('|');
  }

  // Switch timeframe â€” resets all window state and refreshes
  function switchTimeframe(tf) {
    if (tf === activeTF) return;
    activeTF = tf;
    const cfg = TF_CONFIG[tf];

    // Sync lock state for this timeframe
    syncLockFromTF();

    // Update tab UI
    document.querySelectorAll('.agent-tf-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tf === tf);
    });

    // Update subtitle and model detail
    const sub = document.getElementById('agentSubtitle');
    const det = document.getElementById('agentModelDetail');
    if (sub) sub.textContent = cfg.subtitle;
    if (det) det.textContent = cfg.modelDetail;

    // Reset all window-level state
    state.priceToBeat        = null;
    state.currentWindowStart = 0;
    state.upPct              = null;
    state.downPct            = null;
    state.wins               = 0;
    state.losses             = 0;
    state.history            = [];
    lastHistorySnapshot      = '';

    // Sync lock state from the new TF (keeps existing lock if already voted)
    syncLockFromTF();
    setPredictionFinalState(false);
    if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'none';
    if (els.ptb)            els.ptb.textContent              = '--';
    if (els.countdown)      els.countdown.textContent        = '--:--';
    if (els.finalCountdown) els.finalCountdown.textContent   = '--:--';
    if (els.wins)           els.wins.textContent             = '--';
    if (els.losses)         els.losses.textContent           = '--';
    if (els.winRate)        els.winRate.textContent          = '--%';
    if (els.total)          els.total.textContent            = '--';

    // Reset streak displays
    if (els.allWinStreak)  els.allWinStreak.textContent  = '--';
    if (els.currWinStreak) els.currWinStreak.textContent = '--';
    if (els.allLossStreak) els.allLossStreak.textContent = '--';
    if (els.currLossStreak)els.currLossStreak.textContent= '--';

    // Reset model perf
    if (els.accuracy)  els.accuracy.textContent  = '--';
    if (els.precision) els.precision.textContent = '--';
    if (els.f1)        els.f1.textContent        = '--';
    if (els.rocAuc)    els.rocAuc.textContent    = '--';
    if (els.tp)        els.tp.textContent        = '--';
    if (els.tn)        els.tn.textContent        = '--';
    if (els.fp)        els.fp.textContent        = '--';
    if (els.fn)        els.fn.textContent        = '--';
    if (els.recall)    els.recall.textContent    = '--';

    // Clear history list
    if (els.historyList) els.historyList.innerHTML = '<div class="agent-history-empty">Loading...</div>';

    chartPoints = [];
    if (els.chartHigh) els.chartHigh.textContent = '--';
    if (els.chartLow) els.chartLow.textContent = '--';
    if (els.chartChange) els.chartChange.textContent = '--';
    loadChartHistory();

    // Refresh with new timeframe data
    refresh();
    console.log('[AGENT] Switched to timeframe:', tf);
  }

  const state = {
    btcPrice: null,
    priceSource: null,
    priceToBeat: null,
    currentWindowStart: 0,
    upPct: null,
    downPct: null,
    timeLeft: 0,
    wins: 0,
    losses: 0,
    ta: null,
    history: [],
    connected: false,
  };
  state.wsMsgCount = 0;

  // â”€â”€ DOM refs â”€â”€
  const $ = (id) => document.getElementById(id);
  const els = {
    statusDot: $('agentStatusDot'),
    statusText: $('agentStatusText'),
    btcPrice: $('agentBtcPrice'),
    priceSource: $('agentPriceSource'),
    priceChange: $('agentPriceChange'),
    ptbDistanceStatus: $('agentPtbDistanceStatus'),
    ptbDistanceValue: $('agentPtbDistanceValue'),
    ptbDistancePct: $('agentPtbDistancePct'),
    countdown: $('agentCountdown'),
    ptb: $('agentPtb'),
    call: $('agentCall'),
    callText: $('agentCallText'),
    predLiveStage: $('agentPredLiveStage'),
    oddsOver: $('agentOddsOver'),
    oddsUnder: $('agentOddsUnder'),
    oddsOverPct: $('agentOddsOverPct'),
    finalAnalyzing: $('agentFinalAnalyzing'),
    oddsUnderPct: $('agentOddsUnderPct'),
    wins: $('agentWins'),
    losses: $('agentLosses'),
    winRate: $('agentWinRate'),
    total: $('agentTotal'),
    rsi: $('agentRsi'),
    macd: $('agentMacd'),
    ema: $('agentEma'),
    vwap: $('agentVwap'),
    vol: $('agentVol'),
    historyList: $('agentHistoryList'),
    wsCount: $('wsCount'),
    allWinStreak: $('allWinStreak'),
    currWinStreak: $('currWinStreak'),
    allLossStreak: $('allLossStreak'),
    currLossStreak: $('currLossStreak'),
    accuracy: $('agentAccuracy'),
    precision: $('agentPrecision'),
    f1: $('agentF1'),
    rocAuc: $('agentRocAuc'),
    tp: $('agentTP'),
    tn: $('agentTN'),
    fp: $('agentFP'),
    fn: $('agentFN'),
    recall: $('agentRecall'),
    finalPred: $('agentFinalPred'),
    finalIcon: $('agentFinalIcon'),
    finalConf: $('agentFinalConf'),
    finalCall: $('agentFinalCall'),
    finalCountdown: $('agentFinalCountdown'),
    finalStatus: $('agentFinalStatus'),
    finalPrice: $('agentFinalPrice'),
    finalSignals: $('agentFinalSignals'),
    chart: $('agentChart'),
    chartTooltip: $('agentChartTooltip'),
    chartHigh: $('agentChartHigh'),
    chartLow: $('agentChartLow'),
    chartChange: $('agentChartChange'),
    wsIndicator: $('wsIndicator'),
    wsDot: $('wsDot'),
    wsText: $('wsText'),
    helpTrigger: $('agentHelpTrigger'),
    helpBackdrop: $('agentHelpBackdrop'),
    helpPanel: $('agentHelpPanel'),
    helpClose: $('agentHelpClose'),
  };

  const kagamiEls = {
    messages: $('kagamiMessages'),
    form: $('kagamiForm'),
    input: $('kagamiInput'),
    send: $('kagamiSend'),
    tfSwitcher: $('kagamiTfSwitcher'),
    sync: $('kagamiContextSync'),
    tf: $('kagamiContextTf'),
    mode: $('kagamiContextMode'),
    price: $('kagamiContextPrice'),
    ptb: $('kagamiContextPtb'),
    spread: $('kagamiContextSpread'),
    countdown: $('kagamiContextCountdown'),
    signal: $('kagamiContextSignal'),
    volatility: $('kagamiContextVolatility'),
    wr: $('kagamiContextWr'),
    technical: $('kagamiContextTechnical'),
  };
  let kagamiInitialized = false;
  let kagamiContextTimer = null;

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isPonisIQFinalState() {
    return !!(els.finalPred &&
      els.finalPred.style.display !== 'none' &&
      els.finalPred.classList.contains('is-visible'));
  }

  function getPonisIQSnapshot() {
    const price = state.btcPrice;
    const ptb = state.priceToBeat;
    const diff = (price != null && ptb != null) ? (price - ptb) : null;
    const diffPct = (diff != null && ptb) ? ((diff / ptb) * 100) : null;
    const finalState = isPonisIQFinalState();
    const overText = els.oddsOverPct ? els.oddsOverPct.textContent.trim() : 'UP --';
    const underText = els.oddsUnderPct ? els.oddsUnderPct.textContent.trim() : 'DOWN --';
    const volBadgeEl = document.getElementById('volLevelBadge');
    const volAtrEl = document.getElementById('volAtr');
    const volBbEl = document.getElementById('volBb');
    const volZEl = document.getElementById('volZ');
    const tfLabel = TF_CONFIG[activeTF] ? TF_CONFIG[activeTF].label : activeTF.toUpperCase();
    const technicalParts = [];

    if (els.rsi && els.rsi.textContent && els.rsi.textContent !== '--') technicalParts.push('RSI ' + els.rsi.textContent.trim());
    if (els.macd && els.macd.textContent && els.macd.textContent !== '--') technicalParts.push('MACD ' + els.macd.textContent.trim());
    if (els.ema && els.ema.textContent && els.ema.textContent !== '--') technicalParts.push('EMA ' + els.ema.textContent.trim());

    return {
      timeframe: activeTF,
      timeframeLabel: tfLabel,
      finalState: finalState,
      mode: finalState ? 'Final Vote' : 'Live Bias',
      price: price,
      ptb: ptb,
      diff: diff,
      diffPct: diffPct,
      countdown: (finalState && els.finalCountdown ? els.finalCountdown.textContent : els.countdown ? els.countdown.textContent : '--:--') || '--:--',
      signal: finalState
        ? (els.finalCall ? els.finalCall.textContent.trim() : '--')
        : (els.callText ? els.callText.textContent.trim() : '--'),
      confidence: finalState
        ? (els.finalConf ? els.finalConf.textContent.trim() : '--')
        : (overText + ' / ' + underText),
      marketState: finalState
        ? (els.finalStatus ? els.finalStatus.textContent.trim() : '--')
        : 'Live confidence split',
      finalSignals: finalState && els.finalSignals ? els.finalSignals.textContent.trim() : '',
      upOdds: overText,
      downOdds: underText,
      volatilityLevel: volBadgeEl ? volBadgeEl.textContent.trim() : '--',
      volatilityStats: {
        atr: volAtrEl ? volAtrEl.textContent.trim() : '--',
        bb: volBbEl ? volBbEl.textContent.trim() : '--',
        volZ: volZEl ? volZEl.textContent.trim() : '--',
      },
      wins: els.wins ? els.wins.textContent.trim() : '--',
      losses: els.losses ? els.losses.textContent.trim() : '--',
      winRate: els.winRate ? els.winRate.textContent.trim() : '--',
      total: els.total ? els.total.textContent.trim() : '--',
      allWinStreak: els.allWinStreak ? els.allWinStreak.textContent.trim() : '--',
      currWinStreak: els.currWinStreak ? els.currWinStreak.textContent.trim() : '--',
      allLossStreak: els.allLossStreak ? els.allLossStreak.textContent.trim() : '--',
      currLossStreak: els.currLossStreak ? els.currLossStreak.textContent.trim() : '--',
      rsi: els.rsi ? els.rsi.textContent.trim() : '--',
      macd: els.macd ? els.macd.textContent.trim() : '--',
      ema: els.ema ? els.ema.textContent.trim() : '--',
      vwap: els.vwap ? els.vwap.textContent.trim() : '--',
      vol: els.vol ? els.vol.textContent.trim() : '--',
      technicalSummary: technicalParts.length ? technicalParts.join(' | ') : '--',
    };
  }

  function appendPonisIQMessage(role, text) {
    if (!kagamiEls.messages) return;
    const bubble = document.createElement('div');
    const ts = new Date();
    bubble.className = 'kagami-bubble kagami-bubble-' + role;
    bubble.innerHTML =
      '<div class="kagami-bubble-meta">' +
        '<span class="kagami-bubble-role">' + (role === 'user' ? 'Operator' : 'PonisIQ') + '</span>' +
        '<span>' + ts.getHours().toString().padStart(2, '0') + ':' + ts.getMinutes().toString().padStart(2, '0') + '</span>' +
      '</div>' +
      '<div class="kagami-bubble-text">' + escapeHtml(text) + '</div>';
    kagamiEls.messages.appendChild(bubble);
    kagamiEls.messages.scrollTop = kagamiEls.messages.scrollHeight;
  }

  function buildPonisIQResponse(prompt) {
    const q = (prompt || '').toLowerCase();
    const snap = getPonisIQSnapshot();
    const priceText = formatPrice(snap.price);
    const ptbText = formatPrice(snap.ptb);
    const spreadText = snap.diff == null
      ? '--'
      : ((snap.diff >= 0 ? '+' : '-') + '$' + Math.abs(snap.diff).toFixed(2) + ' (' + (snap.diffPct >= 0 ? '+' : '-') + Math.abs(snap.diffPct).toFixed(2) + '%)');
    const liveSummary = snap.finalState
      ? (snap.signal + ' | ' + (snap.confidence || '--') + ' | ' + (snap.marketState || '--'))
      : (snap.signal + ' | ' + snap.upOdds + ' / ' + snap.downOdds);

    if (!snap.price && !snap.ptb && snap.signal === 'WAITING...') {
      return 'The dashboard is still loading live data. Wait for BTC, PTB, and the current call to populate, then ask again.';
    }

    if (
      q.includes('current') ||
      q.includes('prediction') ||
      q.includes('call') ||
      q.includes('summarize') ||
      q.includes('status')
    ) {
      return 'Active window: ' + snap.timeframeLabel + '.\n' +
        'Mode: ' + snap.mode + '.\n' +
        'Signal: ' + liveSummary + '.\n' +
        'BTC: ' + priceText + ' | PTB: ' + ptbText + '.\n' +
        'Spread vs PTB: ' + spreadText + '.\n' +
        'Countdown: ' + snap.countdown + '.';
    }

    if (q.includes('ptb') || q.includes('price to beat') || q.includes('different timeframe') || q.includes('why is ptb') || q.includes('15m') || q.includes('1h')) {
      return 'PTB is locked at the start of each market window, so 5m, 15m, and 1h do not usually share the same value.\n' +
        'Current ' + snap.timeframeLabel + ' PTB: ' + ptbText + '.\n' +
        'Current BTC: ' + priceText + '.\n' +
        'Spread: ' + spreadText + '.\n' +
        'Use the timeframe buttons here or in Ponis IQ Agent to compare windows directly.';
    }

    if (q.includes('time') || q.includes('countdown') || q.includes('lock') || q.includes('final vote')) {
      return 'Current window: ' + snap.timeframeLabel + '.\n' +
        'Mode: ' + snap.mode + '.\n' +
        'Countdown: ' + snap.countdown + '.\n' +
        (snap.finalState
          ? 'The vote is already locked. Market state: ' + snap.marketState + '.'
          : 'The live bias can still move until the lock threshold is hit.');
    }

    if (q.includes('volatility') || q.includes('atr') || q.includes('bb width') || q.includes('vol z')) {
      return 'Volatility level is ' + snap.volatilityLevel + '.\n' +
        'ATR: ' + snap.volatilityStats.atr + '.\n' +
        'BB Width: ' + snap.volatilityStats.bb + '.\n' +
        'Vol Z: ' + snap.volatilityStats.volZ + '.\n' +
        'Higher ATR and BB Width mean wider price travel. Vol Z tells you whether current volume is above or below its recent baseline.';
    }

    if (q.includes('wr') || q.includes('win rate') || q.includes('streak') || q.includes('track record') || q.includes('wins') || q.includes('losses')) {
      return 'Track record for the active timeframe:\n' +
        'Wins: ' + snap.wins + ' | Losses: ' + snap.losses + ' | WR: ' + snap.winRate + ' | Total: ' + snap.total + '.\n' +
        'Current win streak: ' + snap.currWinStreak + ' | Current loss streak: ' + snap.currLossStreak + '.\n' +
        'WR is wins divided by settled wins plus settled losses. Skip rows do not count.';
    }

    if (q.includes('technical') || q.includes('rsi') || q.includes('macd') || q.includes('ema') || q.includes('vwap') || q.includes('chart')) {
      return 'Technical snapshot for ' + snap.timeframeLabel + ':\n' +
        'RSI: ' + snap.rsi + '.\n' +
        'MACD: ' + snap.macd + '.\n' +
        'EMA: ' + snap.ema + '.\n' +
        'VWAP: ' + snap.vwap + '.\n' +
        'Volume state: ' + snap.vol + '.\n' +
        'The chart is scoped to the active market window, so it resets with each new timeframe window.';
    }

    if (q.includes('share') || q.includes('x ') || q === 'x' || q.includes('post')) {
      return 'Use the share button on the page to build the Ponis IQ share card.\n' +
        'The share card uses the active timeframe, PTB, BTC price, volatility, confidence, and result state.\n' +
        'X text can be prefilled automatically, but browsers still cannot attach the generated image directly into X without user paste/upload.';
    }

    return 'I can explain the current call, PTB logic, lock timing, volatility, WR, and the technical snapshot.\n' +
      'Try: "Summarize the current prediction", "Why is PTB different on 15m?", or "Explain the volatility meter."';
  }

  function updatekagamiContext() {
    if (!kagamiEls.tf) return;
    const snap = getPonisIQSnapshot();
    const diffText = snap.diff == null
      ? '--'
      : ((snap.diff >= 0 ? 'UP ' : 'DOWN ') + '$' + Math.abs(snap.diff).toFixed(2) + ' | ' + (snap.diffPct >= 0 ? '+' : '-') + Math.abs(snap.diffPct).toFixed(2) + '%');

    kagamiEls.tf.textContent = snap.timeframeLabel;
    kagamiEls.mode.textContent = snap.mode;
    kagamiEls.price.textContent = formatPrice(snap.price);
    kagamiEls.ptb.textContent = formatPrice(snap.ptb);
    kagamiEls.spread.textContent = diffText;
    kagamiEls.countdown.textContent = snap.countdown || '--:--';
    kagamiEls.signal.textContent = snap.signal || '--';
    kagamiEls.volatility.textContent = snap.volatilityLevel || '--';
    kagamiEls.wr.textContent = snap.winRate === '--' ? '--' : (snap.winRate + ' | ' + snap.wins + 'W');
    kagamiEls.technical.textContent = snap.technicalSummary;
    if (kagamiEls.sync) {
      const now = new Date();
      kagamiEls.sync.textContent = 'Live ' +
        now.getHours().toString().padStart(2, '0') + ':' +
        now.getMinutes().toString().padStart(2, '0') + ':' +
        now.getSeconds().toString().padStart(2, '0');
    }

    if (kagamiEls.tfSwitcher) {
      kagamiEls.tfSwitcher.querySelectorAll('[data-kagami-tf]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.kagamiTf === activeTF);
      });
    }
  }

  function handlePonisIQPrompt(prompt) {
    const text = (prompt || '').trim();
    if (!text) return;
    appendPonisIQMessage('user', text);
    if (kagamiEls.input) {
      kagamiEls.input.value = '';
      kagamiEls.input.style.height = '52px';
    }
    window.setTimeout(function() {
      appendPonisIQMessage('bot', buildPonisIQResponse(text));
      updatekagamiContext();
    }, 140);
  }

  function initPonisIQ() {
    if (kagamiInitialized || !kagamiEls.messages || !kagamiEls.form) return;
    kagamiInitialized = true;

    appendPonisIQMessage('bot', 'PonisIQ is live. Ask about the active timeframe, PTB, volatility, technical snapshot, or WR.');
    appendPonisIQMessage('bot', 'Use the quick prompts or switch between 5M, 15M, and 1H here to inspect the current Ponis IQ state.');
    updatekagamiContext();

    kagamiEls.form.addEventListener('submit', function(event) {
      event.preventDefault();
      handlePonisIQPrompt(kagamiEls.input ? kagamiEls.input.value : '');
    });

    if (kagamiEls.input) {
      const resizeInput = function() {
        kagamiEls.input.style.height = 'auto';
        kagamiEls.input.style.height = Math.min(kagamiEls.input.scrollHeight, 140) + 'px';
      };
      resizeInput();
      kagamiEls.input.addEventListener('input', resizeInput);
      kagamiEls.input.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          handlePonisIQPrompt(kagamiEls.input.value);
        }
      });
    }

    document.querySelectorAll('[data-kagami-prompt]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        handlePonisIQPrompt(btn.dataset.kagamiPrompt || '');
      });
    });

    if (kagamiEls.tfSwitcher) {
      kagamiEls.tfSwitcher.querySelectorAll('[data-kagami-tf]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          const targetTf = btn.dataset.kagamiTf;
          if (!targetTf || targetTf === activeTF) return;
          switchTimeframe(targetTf);
          updatekagamiContext();
          appendPonisIQMessage('bot', 'Switched PonisIQ context to ' + (TF_CONFIG[targetTf] ? TF_CONFIG[targetTf].label : targetTf.toUpperCase()) + '.');
        });
      });
    }

    kagamiContextTimer = setInterval(updatekagamiContext, 1000);
  }

  function setAgentHelpOpen(isOpen) {
    if (!els.helpTrigger || !els.helpPanel) return;
    els.helpTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (els.helpBackdrop) els.helpBackdrop.hidden = !isOpen;
    els.helpPanel.hidden = !isOpen;
    document.body.classList.toggle('agent-help-open', !!isOpen);
  }

  function initAgentHelp() {
    if (!els.helpTrigger || !els.helpPanel) return;

    els.helpTrigger.addEventListener('click', function(event) {
      event.stopPropagation();
      const isOpen = els.helpTrigger.getAttribute('aria-expanded') === 'true';
      setAgentHelpOpen(!isOpen);
    });

    if (els.helpClose) {
      els.helpClose.addEventListener('click', function() {
        setAgentHelpOpen(false);
      });
    }

    if (els.helpBackdrop) {
      els.helpBackdrop.addEventListener('click', function() {
        setAgentHelpOpen(false);
      });
    }

    document.addEventListener('click', function(event) {
      if (els.helpPanel.hidden) return;
      if (els.helpBackdrop && els.helpBackdrop.contains(event.target)) return;
      if (els.helpPanel.contains(event.target) || els.helpTrigger.contains(event.target)) return;
      setAgentHelpOpen(false);
    });

    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') setAgentHelpOpen(false);
    });
  }

  function setPredictionFinalState(showFinal) {
    if (!els.finalPred) return;
    const card = els.finalPred.closest('.agent-card-prediction');
    if (showFinal) {
      if (card) card.classList.add('show-final');
      if (els.predLiveStage) els.predLiveStage.classList.add('is-faded');
      els.finalPred.style.display = 'block';
      requestAnimationFrame(function() {
        if (els.finalPred) els.finalPred.classList.add('is-visible');
      });
      return;
    }

    if (card) card.classList.remove('show-final');
    if (els.predLiveStage) els.predLiveStage.classList.remove('is-faded');
    els.finalPred.classList.remove('is-visible');
    els.finalPred.style.display = 'none';
  }

  // â”€â”€ Chart state â€” continuous rolling buffer, persisted to Supabase â”€â”€
  let chartPoints = []; // [{time, price}]
  const CHART_DURATION = (Math.max.apply(null, Object.keys(TF_CONFIG).map(function(key) {
    return TF_CONFIG[key].seconds;
  })) * 1000) + (60 * 1000); // keep enough data for the largest timeframe window
  let lastChartSave = 0; // throttle saves to every 10 seconds

  let finalPredLocked    = false;
  let finalPredWindow    = 0;
  let finalPredDirection = null;
  let finalPredPTB       = null;

  // Per-timeframe lock â€” so switching tabs never clobbers a locked prediction
  const tfLockState = Object.keys(TF_CONFIG).reduce(function(acc, key) {
    acc[key] = { locked: false, window: 0, direction: null, ptb: null };
    return acc;
  }, {});

  function getActiveWindowStart() {
    return getWindowStart(Math.floor(Date.now() / 1000), activeTF);
  }

  function isLocked() {
    const lock = tfLockState[activeTF];
    return !!lock.locked && lock.window === getActiveWindowStart();
  }

  function setLocked(dir, ptb)  {
    const windowStart = getActiveWindowStart();
    tfLockState[activeTF].locked    = true;
    tfLockState[activeTF].window    = windowStart;
    tfLockState[activeTF].direction = dir;
    tfLockState[activeTF].ptb       = ptb;
    finalPredLocked    = true;
    finalPredWindow    = windowStart;
    finalPredDirection = dir;
    finalPredPTB       = ptb;
    // Fire push notification
    const confEl = document.getElementById('agentFinalConf');
    const conf   = confEl ? confEl.textContent : '--';
    sendPredictionNotif(dir === 'up' ? 'UP' : dir === 'down' ? 'DOWN' : 'SKIP', conf, activeTF.toUpperCase());
  }
  function resetLock() {
    tfLockState[activeTF].locked    = false;
    tfLockState[activeTF].window    = 0;
    tfLockState[activeTF].direction = null;
    tfLockState[activeTF].ptb       = null;
    finalPredLocked    = false;
    finalPredWindow    = 0;
    finalPredDirection = null;
    finalPredPTB       = null;
  }
  function syncLockFromTF() {
    const s = tfLockState[activeTF];
    finalPredLocked    = s.locked;
    finalPredWindow    = s.window;
    finalPredDirection = s.direction;
    finalPredPTB       = s.ptb;
  }

  // Chainlink price snapshots for PTB â€” capture at window boundaries
  let chainlinkSnapshotPrice = null;
  let chainlinkSnapshotWindow = 0;

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // TA INDICATOR CALCULATIONS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  function ema(data, period) {
    const k = 2 / (period + 1);
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  }

  function rsi(closes, period) {
    period = period || 14;
    const gains = [], losses = [];
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result = new Array(period).fill(null);
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    }
    return result;
  }

  function macd(closes) {
    const emaFast = ema(closes, 12);
    const emaSlow = ema(closes, 26);
    const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
    const signalLine = ema(macdLine, 9);
    const histogram = macdLine.map((v, i) => v - signalLine[i]);
    return { macd: macdLine, signal: signalLine, histogram };
  }

  function vwap(highs, lows, closes, volumes) {
    let cumVol = 0, cumTP = 0;
    return closes.map((c, i) => {
      const tp = (highs[i] + lows[i] + c) / 3;
      cumVol += volumes[i];
      cumTP += tp * volumes[i];
      return cumVol > 0 ? cumTP / cumVol : c;
    });
  }

  function volumeZScore(volumes, period) {
    period = period || 20;
    return volumes.map((v, i) => {
      if (i < period) return 0;
      const slice = volumes.slice(i - period, i);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const std = Math.sqrt(slice.reduce((sum, x) => sum + (x - mean) ** 2, 0) / period);
      return std > 0 ? (v - mean) / std : 0;
    });
  }

  function computeTA(candles) {
    if (!candles || candles.length < 30) return null;
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const vols = candles.map(c => c.volume);
    const last = candles.length - 1;

    const ema9 = ema(closes, 9);
    const ema21 = ema(closes, 21);
    const ema50 = ema(closes, 50);
    const rsi14 = rsi(closes, 14);
    const macdData = macd(closes);
    const vwapData = vwap(highs, lows, closes, vols);
    const volZ = volumeZScore(vols, 20);

    const aligned = ema9[last] > ema21[last] && ema21[last] > ema50[last] ? 'BULLISH' :
                    ema9[last] < ema21[last] && ema21[last] < ema50[last] ? 'BEARISH' : 'MIXED';

    // Momentum direction: is RSI rising or falling?
    const rsiPrev = rsi14[last - 1];
    const rsiDelta = (rsi14[last] != null && rsiPrev != null) ? rsi14[last] - rsiPrev : 0;

    // MACD histogram trend (expanding or contracting?)
    const macdHistPrev = macdData.histogram[last - 1];
    const macdHistDelta = macdData.histogram[last] - macdHistPrev;

    // Price returns over recent candles
    const ret1 = ((closes[last] - closes[last - 1]) / closes[last - 1]) * 100;
    const ret3 = last >= 3 ? ((closes[last] - closes[last - 3]) / closes[last - 3]) * 100 : 0;

    // Recent candle bodies: how many of last 3 are bullish vs bearish
    let recentBullCandles = 0;
    let recentBearCandles = 0;
    for (let i = last; i >= Math.max(0, last - 2); i--) {
      if (candles[i].close > candles[i].open) recentBullCandles++;
      else recentBearCandles++;
    }

    // EMA slopes (rate of change)
    const ema9Slope = last >= 3 ? ((ema9[last] - ema9[last - 3]) / ema9[last - 3]) * 100 : 0;

    return {
      price: closes[last],
      rsi: rsi14[last],
      rsiDelta: rsiDelta,
      macdHist: macdData.histogram[last],
      macdHistDelta: macdHistDelta,
      macdCrossing: Math.sign(macdData.histogram[last]) !== Math.sign(macdData.histogram[last - 1]),
      emaAligned: aligned,
      ema9Slope: ema9Slope,
      vwapDist: ((closes[last] - vwapData[last]) / vwapData[last] * 100),
      volZScore: volZ[last],
      ret1: ret1,
      ret3: ret3,
      recentBullCandles: recentBullCandles,
      recentBearCandles: recentBearCandles,
    };
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // DATA FETCHING
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  async function fetchCandles() {
    try {
      const interval = TF_CONFIG[activeTF].interval;
      const url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=' + interval + '&limit=100';
      const res = await fetch(url);
      if (!res.ok) return null;
      const raw = await res.json();
      return raw.map(c => ({
        time: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
      }));
    } catch (e) {
      console.error('[AGENT] Binance error:', e.message);
      return null;
    }
  }

  // CORS proxies to try (Polymarket blocks browser requests)
  const CORS_PROXIES = [
    function(u) { return 'https://corsproxy.io/?' + encodeURIComponent(u); },
    function(u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); },
    function(u) { return 'https://thingproxy.freeboard.io/fetch/' + u; },
  ];

  // Fetch with timeout (prevents hanging)
  function fetchWithTimeout(url, ms) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, ms);
    return fetch(url, { signal: controller.signal }).finally(function() { clearTimeout(timer); });
  }

  async function fetchWithProxy(targetUrl) {
    for (const proxy of CORS_PROXIES) {
      try {
        const res = await fetchWithTimeout(proxy(targetUrl), 8000);
        if (res.ok) return await res.json();
      } catch (e) { /* try next proxy */ }
    }
    return null;
  }

  async function fetchPolymarket() {
    try {
      const cfg      = TF_CONFIG[activeTF];
      const now      = Math.floor(Date.now() / 1000);
      const interval = cfg.seconds;
      const currentStart = getWindowStart(now, activeTF);
      const timestamps   = [currentStart, currentStart + interval, currentStart - interval];
      const cacheKey     = getPtbCacheKey(activeTF, currentStart);

      let bestMarket = null, bestTs = 0;

      for (const ts of timestamps) {
        const slug      = cfg.slugPrefix + ts;
        const targetUrl = 'https://gamma-api.polymarket.com/markets?slug=' + slug;
        const data      = await fetchWithProxy(targetUrl);
        if (!data || data.length === 0) continue;
        const market = data[0];
        if (market.closed && !market.acceptingOrders) continue;
        if (!bestMarket || ts === currentStart) {
          bestMarket = market; bestTs = ts;
          if (ts === currentStart) break;
        }
      }

      if (!bestMarket) return null;

      const gammaOdds = JSON.parse(bestMarket.outcomePrices || '[]');
      const upPct     = (parseFloat(gammaOdds[0] || 0) * 100).toFixed(1);
      const downPct   = (parseFloat(gammaOdds[1] || 0) * 100).toFixed(1);

      let startingPrice = null, ptbSrc = null;
      if (bestTs === currentStart && bestMarket.startPrice) {
        startingPrice = parseFloat(bestMarket.startPrice);
        if (startingPrice > 0) {
          ptbSrc = 'polymarket';
          try { sessionStorage.setItem(cacheKey, startingPrice.toString()); } catch(e) {}
          console.log('[AGENT][' + activeTF + '] PTB from Polymarket:', startingPrice);
        } else { startingPrice = null; }
      }

      if (!startingPrice) {
        try {
          const saved = sessionStorage.getItem(cacheKey);
          if (saved) { startingPrice = parseFloat(saved); ptbSrc = 'polymarket-cached'; }
        } catch(e) {}
      }

      return {
        startingPrice, ptbSource: ptbSrc, upPct, downPct,
        timeLeft: Math.max(0, (bestTs + interval) - now),
        startTimestamp: bestTs, endTimestamp: bestTs + interval,
      };
    } catch (e) {
      console.error('[AGENT] Polymarket error:', e.message);
    }
    return null;
  }

  // â”€â”€ Supabase REST: fetch history â”€â”€
  async function fetchHistory() {
    try {
      // Each timeframe has its own table
      const table    = (TF_CONFIG[activeTF] && TF_CONFIG[activeTF].historyTable) || 'predictions';
      const allowedSources = getHistorySources(activeTF);
      const pageSize = 1000;
      let data = [];

      for (let page = 0; ; page++) {
        const offset = page * pageSize;
        const url = SUPABASE_URL + '/rest/v1/' + table + '?select=*&order=ts.desc&limit=' + pageSize + '&offset=' + offset;
        const res = await fetch(url, { headers: SB_HEADERS });
        if (!res.ok) {
          console.error('[AGENT] History fetch failed:', res.status);
          return [];
        }
        const chunk = await res.json();
        if (!chunk || chunk.length === 0) break;
        data = data.concat(chunk);
        if (chunk.length < pageSize) break;
      }

      if (!data || data.length === 0) return [];

      const filtered = data.filter(function(p) {
        const rowSource = p && p.source ? String(p.source) : '';
        return allowedSources.indexOf(rowSource) !== -1;
      });

      if (filtered.length === 0) return [];

      // Dedup by ts â€” real prediction (with end_price) beats skip
      const byTs = {};
      for (const p of filtered) {
        const ts = Number(p.ts);
        if (!byTs[ts]) {
          byTs[ts] = p;
        } else {
          // Real prediction (has end_price) always beats a skip for same window
          const existing = byTs[ts];
          const pIsReal  = p.end_price != null && !isSkipEntry(p);
          const exIsReal = existing.end_price != null && !isSkipEntry(existing);
          if (pIsReal && !exIsReal) byTs[ts] = p; // replace skip with real
        }
      }
      const deduped = Object.values(byTs).sort((a, b) => b.ts - a.ts);
      console.log('[AGENT][' + activeTF + '] Loaded ' + deduped.length + ' predictions from ' + table + ' for sources ' + allowedSources.join(', '));
      return deduped;
    } catch (e) {
      console.error('[AGENT] History error:', e.message);
      return [];
    }
  }

  // â”€â”€ Supabase REST: fetch stats â”€â”€
  async function fetchStats() {
    try {
      const url = SUPABASE_URL + '/rest/v1/prediction_stats?select=*&limit=1';
      const res = await fetch(url, { headers: SB_HEADERS });
      if (!res.ok) {
        console.warn('[AGENT] Stats fetch failed:', res.status);
        return null;
      }
      const data = await res.json();
      if (data && data.length > 0) {
        console.log('[AGENT] Stats from Supabase:', JSON.stringify(data[0]));
        return data[0];
      }
    } catch (e) {
      console.error('[AGENT] Stats error:', e.message);
    }
    return null;
  }

  // â”€â”€ Supabase REST: save prediction â”€â”€
  async function savePrediction(windowStart, ptb, endPrice, predictedOver) {
    const actualOver = endPrice > ptb;
    const correct = predictedOver === actualOver;

    const row = {
      ts: windowStart,
      ptb: ptb,
      end_price: endPrice,
      over: correct,
      source:      'vanguard',
    };

    try {
      const url = SUPABASE_URL + '/rest/v1/predictions';
      const res = await fetch(url, {
        method: 'POST',
        headers: SB_HEADERS,
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error('[AGENT] Save prediction error:', res.status, text);
      } else {
        console.log('[AGENT] Prediction saved:', JSON.stringify(row));
      }
    } catch (e) {
      console.error('[AGENT] Save prediction exception:', e.message);
    }
  }

  // â”€â”€ PTB fallback chain (when Polymarket startPrice unavailable) â”€â”€
  // Priority: Chainlink snapshot > Binance 1m candle at exact window start > Binance 5m candle open
  async function fetchPTBFallback() {
    var now = Math.floor(Date.now() / 1000);
    var cfg = TF_CONFIG[activeTF];
    var windowStart = getWindowStart(now, activeTF);

    // Method 1: Chainlink snapshot captured at window boundary (same oracle Polymarket uses)
    if (chainlinkSnapshotPrice && chainlinkSnapshotWindow === windowStart) {
      console.log('[AGENT] PTB from Chainlink snapshot:', chainlinkSnapshotPrice);
      return chainlinkSnapshotPrice;
    }

    // Method 2: Binance 1m candle at exact window start (precise)
    try {
      var startMs = windowStart * 1000;
      var res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=' + startMs + '&limit=1');
      if (res.ok) {
        var data = await res.json();
        if (data && data.length > 0) {
          var openPrice = parseFloat(data[0][1]);
          if (openPrice > 0) {
            console.log('[AGENT] PTB from Binance 1m candle:', openPrice);
            return openPrice;
          }
        }
      }
    } catch (e) {
      console.error('[AGENT] Binance 1m PTB error:', e.message);
    }

    // Method 3: Open of the active timeframe candle at the exact window start
    try {
      var res2 = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=' + cfg.interval + '&startTime=' + (windowStart * 1000) + '&limit=1');
      if (res2.ok) {
        var data2 = await res2.json();
        if (data2 && data2.length > 0) {
          var openPrice2 = parseFloat(data2[0][1]);
          if (openPrice2 > 0) {
            console.log('[AGENT] PTB from Binance ' + cfg.interval + ' candle open:', openPrice2);
            return openPrice2;
          }
        }
      }
    } catch (e) {
      console.error('[AGENT] Binance timeframe PTB error:', e.message);
    }

    return null;
  }

  // â”€â”€ Compute track record from history â€” skips excluded â”€â”€
  function isSkipEntry(p) {
    if (!p.source) return false;
    return p.source.endsWith('-skip') || p.source === 'vanguard-skip';
  }

  function computeTrackRecord(predictions) {
    let wins = 0, losses = 0;
    for (const p of predictions) {
      if (isSkipEntry(p)) continue;
      if (p.end_price === null || p.end_price === undefined || p.ptb === null || p.ptb === undefined) continue;
      const correct = parseStoredBool(p.over);
      if (correct === null) continue;
      if (correct) wins++;
      else losses++;
    }
    return { wins, losses };
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // WEBSOCKET â€” Live BTC price from Polymarket
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  let rtdsWs = null;
  let rtdsReconnectTimer = null;

  function connectRTDS() {
    if (rtdsWs && rtdsWs.readyState <= 1) return;

    try {
      rtdsWs = new WebSocket('wss://ws-live-data.polymarket.com');

      rtdsWs.onopen = function () {
        console.log('[AGENT] RTDS connected');
        setStatus('connected', 'LIVE');
        setWsIndicator('connected', 'CONNECTED');

        rtdsWs.send(JSON.stringify({
          action: 'subscribe',
          subscriptions: [{
            topic: 'crypto_prices_chainlink',
            type: '*',
            filters: '{"symbol":"btc/usd"}'
          }]
        }));
      };

      rtdsWs.onmessage = function (event) {
        try {
          const msg = JSON.parse(event.data);

          // Handle history dump
          if (msg.payload && msg.payload.data && Array.isArray(msg.payload.data)) {
            const history = msg.payload.data;
            if (history.length > 0) {
              const latest = history[history.length - 1];
              state.btcPrice = latest.value;
              state.priceSource = 'chainlink';
              state.connected = true;
              updatePriceUI();
            }
            return;
          }

              // Handle streaming updates
              if (msg.topic === 'crypto_prices_chainlink' && msg.payload && msg.payload.value) {
            state.btcPrice = msg.payload.value;
            state.priceSource = 'chainlink';
            state.connected = true;

                // count WS messages for indicator
                state.wsMsgCount = (state.wsMsgCount || 0) + 1;
                if (els.wsCount) els.wsCount.textContent = state.wsMsgCount;

            // Snapshot Chainlink price at window boundary for accurate PTB
            var now = Math.floor(Date.now() / 1000);
            var windowStart = getWindowStart(now, activeTF);
            var sinceBoundary = now - windowStart;
            if (sinceBoundary <= 5 && chainlinkSnapshotWindow !== windowStart) {
              chainlinkSnapshotPrice = msg.payload.value;
              chainlinkSnapshotWindow = windowStart;
              console.log('[AGENT] Chainlink PTB snapshot at boundary:', chainlinkSnapshotPrice);
            }
            updatePriceUI();
            addChartPoint(msg.payload.value);
          }
        } catch (e) { /* ignore parse errors */ }
      };

      rtdsWs.onerror = function () {
        console.log('[AGENT] RTDS error â€” will retry');
        setStatus('error', 'ERROR');
        setWsIndicator('error', 'ERROR');
      };

      rtdsWs.onclose = function () {
        console.log('[AGENT] RTDS closed â€” reconnecting in 5s');
        setStatus('reconnecting', 'RECONNECTING...');
        setWsIndicator('reconnecting', 'RECONNECTING');
        state.connected = false;
        clearTimeout(rtdsReconnectTimer);
        rtdsReconnectTimer = setTimeout(connectRTDS, 5000);
      };
    } catch (e) {
      console.error('[AGENT] WS connect failed:', e.message);
      setStatus('error', 'OFFLINE');
      setWsIndicator('error', 'OFFLINE');
      clearTimeout(rtdsReconnectTimer);
      rtdsReconnectTimer = setTimeout(connectRTDS, 10000);
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // UI UPDATE FUNCTIONS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  function setStatus(type, text) {
    if (!els.statusDot || !els.statusText) return;
    els.statusDot.className = 'agent-status-dot ' + type;
    els.statusText.textContent = text;
  }

  // Persistent WS indicator updated only on WebSocket events
  function setWsIndicator(state, text) {
    if (!els.wsIndicator || !els.wsDot || !els.wsText) return;
    els.wsDot.className = 'ws-dot ' + state; // e.g. 'connected', 'reconnecting', 'error'
    els.wsText.textContent = 'WS: ' + (text || state.toUpperCase());
  }

  function formatPrice(n) {
    if (n == null) return '--';
    const num = typeof n === 'number' ? n : parseFloat(n);
    if (isNaN(num)) return '--';
    return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  let prevPrice = null;
  function updatePriceUI() {
    if (!els.btcPrice) return;
    const p = state.btcPrice;
    if (p == null) return;

    els.btcPrice.textContent = formatPrice(p);
    if (els.priceSource) els.priceSource.textContent = (state.priceSource || '--').toUpperCase();

    // Flash green/red on price change (no forced reflow)
    if (prevPrice !== null && p !== prevPrice) {
      const dir = p > prevPrice ? 'up' : 'down';
      const el = els.btcPrice;
      el.classList.remove('flash-up', 'flash-down');
      requestAnimationFrame(function() {
        el.classList.add('flash-' + dir);
      });
    }

    // Show difference from PTB
    if (state.priceToBeat && els.priceChange) {
      const diff = p - state.priceToBeat;
      const sign = diff >= 0 ? '+' : '';
      const dir = diff >= 0 ? 'above' : 'below';
      els.priceChange.textContent = sign + '$' + Math.abs(diff).toFixed(2) + ' vs PTB';
      els.priceChange.className = 'agent-price-change ' + dir;
      if (els.ptbDistanceStatus) {
        els.ptbDistanceStatus.textContent = (dir === 'above' ? 'ABOVE PTB' : 'BELOW PTB');
        els.ptbDistanceStatus.className = 'agent-ptb-distance-status ' + dir;
      }
      if (els.ptbDistanceValue) {
        els.ptbDistanceValue.textContent = (dir === 'above' ? 'UP ' : 'DOWN ') + '$' + Math.abs(diff).toFixed(2);
      }
      if (els.ptbDistancePct) {
        const pct = state.priceToBeat ? ((diff / state.priceToBeat) * 100) : 0;
        els.ptbDistancePct.textContent = sign + Math.abs(pct).toFixed(2) + '%';
      }
    } else {
      if (els.priceChange) {
        els.priceChange.textContent = '--';
        els.priceChange.className = 'agent-price-change';
      }
      if (els.ptbDistanceStatus) {
        els.ptbDistanceStatus.textContent = '--';
        els.ptbDistanceStatus.className = 'agent-ptb-distance-status';
      }
      if (els.ptbDistanceValue) els.ptbDistanceValue.textContent = '--';
      if (els.ptbDistancePct) els.ptbDistancePct.textContent = '--';
    }

    prevPrice = p;
  }

  let ptbSource = '';

  function updatePredictionUI(polyData) {
    if (!polyData) {
      console.warn('[AGENT] No Polymarket data');
      return;
    }

    // PTB from Polymarket startPrice (authoritative â€” used for settlement)
    if (polyData.startingPrice) {
      const ptbNum = typeof polyData.startingPrice === 'number' ? polyData.startingPrice : parseFloat(polyData.startingPrice);
      state.priceToBeat = ptbNum;
      ptbSource = polyData.ptbSource || 'polymarket';
      if (els.ptb) els.ptb.textContent = formatPrice(ptbNum);
    }

    state.upPct = polyData.upPct;
    state.downPct = polyData.downPct;
    state.timeLeft = polyData.timeLeft;

    // Odds bar
    const up = parseFloat(polyData.upPct) || 50;
    const down = parseFloat(polyData.downPct) || 50;
    if (els.oddsOver) els.oddsOver.style.width = up + '%';
    if (els.oddsUnder) els.oddsUnder.style.width = down + '%';
    if (els.oddsOverPct) els.oddsOverPct.textContent = 'UP ' + polyData.upPct + '%';
    if (els.oddsUnderPct) els.oddsUnderPct.textContent = 'DOWN ' + polyData.downPct + '%';
  }

  function updateCallUI() {
    if (!els.call) return;

    // Live analysis based on current signals
    let bullScore = 0;
    let bearScore = 0;

    // Price vs PTB
    if (state.btcPrice && state.priceToBeat) {
      const diff = state.btcPrice - state.priceToBeat;
      if (diff > 0) bullScore += 2;
      else bearScore += 2;
    }

    // RSI
    if (state.ta && state.ta.rsi != null) {
      if (state.ta.rsi > 55) bullScore += 1;
      else if (state.ta.rsi < 45) bearScore += 1;
    }

    // MACD
    if (state.ta && state.ta.macdHist != null) {
      if (state.ta.macdHist > 0) bullScore += 1;
      else bearScore += 1;
    }

    // EMA alignment
    if (state.ta && state.ta.emaAligned === 'BULLISH') bullScore += 1;
    else if (state.ta && state.ta.emaAligned === 'BEARISH') bearScore += 1;

    // Market odds
    if (state.upPct && state.downPct) {
      const up = parseFloat(state.upPct);
      const down = parseFloat(state.downPct);
      if (up > 55) bullScore += 1;
      else if (down > 55) bearScore += 1;
    }

    if (bullScore === 0 && bearScore === 0) {
      if (els.callText) els.callText.textContent = 'ANALYZING...';
      els.call.className = 'agent-call call-neutral';
      return;
    }

    if (bullScore > bearScore) {
      if (els.callText) els.callText.textContent = 'UP';
      els.call.className = 'agent-call call-up';
    } else if (bearScore > bullScore) {
      if (els.callText) els.callText.textContent = 'DOWN';
      els.call.className = 'agent-call call-down';
    } else {
      if (els.callText) els.callText.textContent = 'NEUTRAL';
      els.call.className = 'agent-call call-neutral';
    }
  }

  function updateStatsUI(record) {
    if (!record) return;
    state.wins = record.wins || 0;
    state.losses = record.losses || 0;
    const total = state.wins + state.losses;
    const wr = total > 0 ? ((state.wins / total) * 100).toFixed(2) : '0.00';

    if (els.wins) els.wins.textContent = state.wins;
    if (els.losses) els.losses.textContent = state.losses;
    if (els.winRate) els.winRate.textContent = wr + '%';
    if (els.total) els.total.textContent = total;
  }

  function updateTAUI(ta) {
    if (!ta) return;
    state.ta = ta;

    if (ta.rsi != null) {
      const rsiVal = ta.rsi.toFixed(1);
      const rsiTag = ta.rsi > 70 ? ' OB' : ta.rsi < 30 ? ' OS' : '';
      if (els.rsi) {
        els.rsi.textContent = rsiVal + rsiTag;
        els.rsi.className = 'agent-ta-val ' + (ta.rsi > 55 ? 'bullish' : ta.rsi < 45 ? 'bearish' : 'neutral');
      }
    }

    if (ta.macdHist != null) {
      const cross = ta.macdCrossing ? ' X' : '';
      if (els.macd) {
        els.macd.textContent = ta.macdHist.toFixed(1) + cross;
        els.macd.className = 'agent-ta-val ' + (ta.macdHist > 0 ? 'bullish' : 'bearish');
      }
    }

    if (els.ema) {
      els.ema.textContent = ta.emaAligned;
      els.ema.className = 'agent-ta-val ' + (ta.emaAligned === 'BULLISH' ? 'bullish' : ta.emaAligned === 'BEARISH' ? 'bearish' : 'neutral');
    }

    if (ta.vwapDist != null && els.vwap) {
      const sign = ta.vwapDist >= 0 ? '+' : '';
      els.vwap.textContent = sign + ta.vwapDist.toFixed(3) + '%';
      els.vwap.className = 'agent-ta-val ' + (ta.vwapDist > 0 ? 'bullish' : 'bearish');
    }

    if (ta.volZScore != null && els.vol) {
      const tag = ta.volZScore > 2 ? ' SPIKE' : ta.volZScore < -1 ? ' DRY' : '';
      els.vol.textContent = ta.volZScore.toFixed(2) + tag;
      els.vol.className = 'agent-ta-val ' + (ta.volZScore > 1 ? 'bullish' : ta.volZScore < -1 ? 'bearish' : 'neutral');
    }
  }

  var lastHistorySnapshot = '';

  function updateHistoryUI(predictions) {
    if (!els.historyList) return;
    if (!predictions || predictions.length === 0) {
      state.history = [];
      if (lastHistorySnapshot !== 'empty') {
        els.historyList.innerHTML = '<div class="agent-history-empty">No predictions yet</div>';
        lastHistorySnapshot = 'empty';
      }
      computeModelPerf([]);
      updateHistoryStatsUI([]);
      return;
    }

    // Skip DOM rebuild if data hasn't changed
    var snapshot = getHistorySnapshot(predictions);
    if (snapshot === lastHistorySnapshot) return;
    lastHistorySnapshot = snapshot;

    state.history = predictions;

    // Build in a DocumentFragment to avoid repeated reflows
    var frag = document.createDocumentFragment();
    for (var i = 0; i < predictions.length; i++) {
      var p = predictions[i];
      if (!p.ts) continue;

      var time = new Date(p.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var row = document.createElement('div');

      // â”€â”€ SKIP row â”€â”€
      if (isSkipEntry(p)) {
        row.className = 'agent-history-item skip';
        row.innerHTML =
          '<span class="agent-history-time">' + time + '</span>' +
          '<span class="agent-history-ptb">' + (p.ptb ? formatPrice(p.ptb) : '--') + '</span>' +
          '<span class="agent-history-dir" style="color:rgba(168,184,176,0.5)">--</span>' +
          '<span class="agent-history-end">--</span>' +
          '<span class="agent-history-result skip">SKIP</span>';
        frag.appendChild(row);
        continue;
      }

      if (p.ptb == null || p.end_price == null) {
        // Prediction made but window not settled yet â€” show as PENDING
        row.className = 'agent-history-item';
        row.innerHTML =
          '<span class="agent-history-time">' + time + '</span>' +
          '<span class="agent-history-ptb">' + (p.ptb ? formatPrice(p.ptb) : '--') + '</span>' +
          '<span class="agent-history-dir" style="color:rgba(200,220,210,0.5)">--</span>' +
          '<span class="agent-history-end" style="color:rgba(200,220,210,0.4)">--</span>' +
          '<span class="agent-history-result" style="color:rgba(200,220,210,0.4);font-size:0.7rem;letter-spacing:0.1em;">PENDING</span>';
        frag.appendChild(row);
        continue;
      }

      var correct = parseStoredBool(p.over);
      if (correct === null) {
        row.className = 'agent-history-item';
        row.innerHTML =
          '<span class="agent-history-time">' + time + '</span>' +
          '<span class="agent-history-ptb">' + formatPrice(p.ptb) + '</span>' +
          '<span class="agent-history-dir" style="color:rgba(200,220,210,0.5)">--</span>' +
          '<span class="agent-history-end">' + formatPrice(p.end_price) + '</span>' +
          '<span class="agent-history-result" style="color:rgba(200,220,210,0.4);font-size:0.7rem;letter-spacing:0.1em;">UNSETTLED</span>';
        frag.appendChild(row);
        continue;
      }

      var ptb = formatPrice(p.ptb);
      var end = formatPrice(p.end_price);

      var actualOver = p.end_price > p.ptb;
      var predictedOver = correct ? actualOver : !actualOver;

      var dir = predictedOver ? 'UP' : 'DOWN';
      var result = correct ? 'WIN' : 'LOSS';
      var resultClass = correct ? 'win' : 'loss';

      row.className = 'agent-history-item';
      row.innerHTML =
        '<span class="agent-history-time">' + time + '</span>' +
        '<span class="agent-history-ptb">' + ptb + '</span>' +
        '<span class="agent-history-dir ' + dir.toLowerCase() + '">' + dir + '</span>' +
        '<span class="agent-history-end">' + end + '</span>' +
        '<span class="agent-history-result ' + resultClass + '">' + result + '</span>';
      frag.appendChild(row);
    }
    els.historyList.innerHTML = '';
    els.historyList.appendChild(frag);

    // Compute model performance from history
    computeModelPerf(predictions);

    // Update history meta (streaks)
    try { updateHistoryStatsUI(predictions); } catch (e) { console.error('[AGENT] Streaks update error:', e); }
  }

  function updateHistoryStatsUI(predictions) {
    if (!predictions || predictions.length === 0) {
      if (els.allWinStreak) els.allWinStreak.textContent = '0';
      if (els.currWinStreak) els.currWinStreak.textContent = '0';
      if (els.allLossStreak) els.allLossStreak.textContent = '0';
      if (els.currLossStreak) els.currLossStreak.textContent = '0';
      return;
    }
    // normalize and sort ascending by ts
    const arr = predictions.slice()
      .filter(p => p &&
        !isSkipEntry(p) &&
        parseStoredBool(p.over) !== null
      )
      .map(p => ({ ts: Number(p.ts), over: parseStoredBool(p.over) }))
      .sort((a, b) => a.ts - b.ts);
    if (arr.length === 0) {
      if (els.allWinStreak) els.allWinStreak.textContent = '0';
      if (els.currWinStreak) els.currWinStreak.textContent = '0';
      if (els.allLossStreak) els.allLossStreak.textContent = '0';
      if (els.currLossStreak) els.currLossStreak.textContent = '0';
      return;
    }
    // compute overall longest win/loss streaks
    let maxWin = 0, maxLoss = 0, cur = 0, curType = null;
    for (const p of arr) {
      if (p.over) {
        if (curType === 'win') cur++; else { curType = 'win'; cur = 1; }
        if (cur > maxWin) maxWin = cur;
      } else {
        if (curType === 'loss') cur++; else { curType = 'loss'; cur = 1; }
        if (cur > maxLoss) maxLoss = cur;
      }
    }
    // compute current trailing streak
    let currWin = 0, currLoss = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].over) { if (currLoss) break; currWin++; } else { if (currWin) break; currLoss++; }
    }
    // update DOM
    if (els.allWinStreak) els.allWinStreak.textContent = maxWin;
    if (els.currWinStreak) els.currWinStreak.textContent = currWin;
    if (els.allLossStreak) els.allLossStreak.textContent = maxLoss;
    if (els.currLossStreak) els.currLossStreak.textContent = currLoss;
  }

  function computeModelPerf(rows) {
    if (!rows || rows.length === 0) {
      if (els.accuracy) els.accuracy.textContent = '--';
      if (els.precision) els.precision.textContent = '--';
      if (els.f1) els.f1.textContent = '--';
      if (els.rocAuc) els.rocAuc.textContent = '--';
      if (els.tp) els.tp.textContent = '0';
      if (els.tn) els.tn.textContent = '0';
      if (els.fp) els.fp.textContent = '0';
      if (els.fn) els.fn.textContent = '0';
      if (els.recall) els.recall.textContent = '--';
      return;
    }

    let tp = 0, tn = 0, fp = 0, fn = 0;
    for (const r of rows) {
      if (isSkipEntry(r)) continue;
      if (r.ptb == null || r.end_price == null) continue;
      const correct = parseStoredBool(r.over);
      if (correct === null) continue;
      const actualOver = r.end_price > r.ptb;

      if (correct && actualOver) tp++;
      else if (correct && !actualOver) tn++;
      else if (!correct && !actualOver) fp++;
      else if (!correct && actualOver) fn++;
    }

    const total = tp + tn + fp + fn;
    const accuracy = total > 0 ? ((tp + tn) / total) * 100 : null;
    const precision = (tp + fp) > 0 ? (tp / (tp + fp)) * 100 : null;
    const recall = (tp + fn) > 0 ? (tp / (tp + fn)) * 100 : null;
    const f1 = (precision != null && recall != null && (precision + recall) > 0)
      ? 2 * (precision * recall) / (precision + recall) : null;
    const tpr = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const fpr = (fp + tn) > 0 ? fp / (fp + tn) : 0;
    const rocAuc = total > 0 ? ((1 + tpr - fpr) / 2) * 100 : null;

    if (els.accuracy) els.accuracy.textContent = accuracy != null ? accuracy.toFixed(1) + '%' : '--';
    if (els.precision) els.precision.textContent = precision != null ? precision.toFixed(1) + '%' : '--';
    if (els.f1) els.f1.textContent = f1 != null ? f1.toFixed(1) + '%' : '--';
    if (els.rocAuc) els.rocAuc.textContent = rocAuc != null ? rocAuc.toFixed(1) + '%' : '--';
    if (els.tp) els.tp.textContent = tp;
    if (els.tn) els.tn.textContent = tn;
    if (els.fp) els.fp.textContent = fp;
    if (els.fn) els.fn.textContent = fn;
    if (els.recall) els.recall.textContent = recall != null ? recall.toFixed(1) + '%' : '--';
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // BTC PRICE CHART (canvas)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  var chartRenderPending = false;
  var lastChartRender = 0;
  var CHART_RENDER_INTERVAL = 1000; // render at most once per second
  var chartAnim = null;
  var chartAnimRaf = null;
  var CHART_ANIM_DURATION = 420;

  function traceSmoothChartPath(ctx, points, xFn, yFn) {
    if (!points || points.length === 0) return;
    if (points.length === 1) {
      ctx.moveTo(xFn(points[0].time), yFn(points[0].price));
      return;
    }

    var firstX = xFn(points[0].time);
    var firstY = yFn(points[0].price);
    ctx.moveTo(firstX, firstY);

    if (points.length === 2) {
      ctx.lineTo(xFn(points[1].time), yFn(points[1].price));
      return;
    }

    for (var i = 1; i < points.length - 1; i++) {
      var currentX = xFn(points[i].time);
      var currentY = yFn(points[i].price);
      var nextX = xFn(points[i + 1].time);
      var nextY = yFn(points[i + 1].price);
      var midX = (currentX + nextX) / 2;
      var midY = (currentY + nextY) / 2;
      ctx.quadraticCurveTo(currentX, currentY, midX, midY);
    }

    var last = points[points.length - 1];
    var prev = points[points.length - 2];
    ctx.quadraticCurveTo(xFn(prev.time), yFn(prev.price), xFn(last.time), yFn(last.price));
  }

  function getSmoothedChartPoints(points) {
    if (!points || points.length < 3) return points;
    var smoothed = points.map(function(point) {
      return { time: point.time, price: point.price };
    });

    for (var i = 1; i < points.length - 1; i++) {
      var prev = points[i - 1].price;
      var curr = points[i].price;
      var next = points[i + 1].price;
      smoothed[i].price = (prev * 0.15) + (curr * 0.7) + (next * 0.15);
    }

    return smoothed;
  }

  function startChartAnimation(fromPoint, toPoint) {
    if (!fromPoint || !toPoint || !window.requestAnimationFrame) {
      renderChart();
      return;
    }

    chartAnim = {
      start: (window.performance && performance.now) ? performance.now() : Date.now(),
      from: { time: fromPoint.time, price: fromPoint.price },
      to: { time: toPoint.time, price: toPoint.price },
    };

    if (chartAnimRaf) {
      try { cancelAnimationFrame(chartAnimRaf); } catch (e) {}
      chartAnimRaf = null;
    }

    function step() {
      renderChart();
      if (!chartAnim) {
        chartAnimRaf = null;
        return;
      }
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      var progress = (now - chartAnim.start) / CHART_ANIM_DURATION;
      if (progress >= 1) {
        chartAnim = null;
        chartAnimRaf = null;
        renderChart();
        return;
      }
      chartAnimRaf = requestAnimationFrame(step);
    }

    chartAnimRaf = requestAnimationFrame(step);
  }

  function addChartPoint(price) {
    if (!price) return;
    var now = Date.now();
    var prevPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : null;
    chartPoints.push({ time: now, price: price });

    // Trim old points beyond 30 minutes
    var cutoff = now - CHART_DURATION;
    while (chartPoints.length > 0 && chartPoints[0].time < cutoff) {
      chartPoints.shift();
    }

    // Save to Supabase every 10 seconds
    if (now - lastChartSave >= 10000) {
      lastChartSave = now;
      saveChartPoint(now, price);
    }

    // Animate the newest point so the chart does not tick hard on each update
    if (prevPoint) {
      lastChartRender = now;
      chartRenderPending = false;
      startChartAnimation(prevPoint, chartPoints[chartPoints.length - 1]);
    } else if (!chartRenderPending && now - lastChartRender >= CHART_RENDER_INTERVAL) {
      chartRenderPending = true;
      requestAnimationFrame(function() {
        renderChart();
        lastChartRender = Date.now();
        chartRenderPending = false;
      });
    }
  }

  function saveChartPoint(ts, price) {
    var url = SUPABASE_URL + '/rest/v1/chart_prices';
    fetch(url, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify({ ts: ts, price: price }),
    }).catch(function() {});
  }

  async function loadChartHistory() {
    try {
      var bounds = getChartWindowBounds(activeTF);
      var cutoff = Math.max(Date.now() - CHART_DURATION, bounds.startMs - 60000);
      var url = SUPABASE_URL + '/rest/v1/chart_prices?select=ts,price&ts=gte.' + cutoff + '&order=ts.asc&limit=500';
      var res = await fetch(url, { headers: SB_HEADERS });
      if (!res.ok) return;
      var data = await res.json();
      if (data && data.length > 0) {
        chartPoints = data.map(function(d) { return { time: d.ts, price: d.price }; });
        console.log('[AGENT] Loaded ' + data.length + ' chart points from Supabase');
        renderChart();
      }
    } catch (e) {
      console.error('[AGENT] Chart history error:', e.message);
    }
  }

  var chartCtx = null;
  var chartW = 0;
  var chartH = 0;
  var chartDpr = 1;

  function renderChart() {
    if (!els.chart || chartPoints.length < 1) return;

    var canvas = els.chart;
    if (!chartCtx) chartCtx = canvas.getContext('2d');
    var ctx = chartCtx;
    var dpr = window.devicePixelRatio || 1;

    // Only read layout and resize canvas when dimensions actually change
    var parent = canvas.parentElement;
    var newW = parent.clientWidth;
    var newH = parent.clientHeight;
    if (newW !== chartW || newH !== chartH || dpr !== chartDpr) {
      chartW = newW;
      chartH = newH;
      chartDpr = dpr;
      canvas.width = newW * dpr;
      canvas.height = newH * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var W = chartW;
    var H = chartH;

    var pad = { top: 16, bottom: 24, left: 0, right: 60 };
    var chartW = W - pad.left - pad.right;
    var chartH = H - pad.top - pad.bottom;

    var bounds = getChartWindowBounds(activeTF);
    var nowMs = Date.now();
    var startMs = bounds.startMs;
    var endMs = bounds.endMs;

    var visiblePoints = chartPoints.filter(function(p) {
      return p.time >= startMs && p.time <= Math.min(nowMs, endMs);
    });

    var priorPoint = null;
    for (var p = chartPoints.length - 1; p >= 0; p--) {
      if (chartPoints[p].time < startMs) {
        priorPoint = chartPoints[p];
        break;
      }
    }
    if (priorPoint && (visiblePoints.length === 0 || visiblePoints[0].time > startMs)) {
      visiblePoints.unshift({ time: startMs, price: priorPoint.price });
    }
    if (state.btcPrice && (visiblePoints.length === 0 || visiblePoints[visiblePoints.length - 1].time < nowMs)) {
      visiblePoints.push({ time: Math.min(nowMs, endMs), price: state.btcPrice });
    }
    if (chartAnim && visiblePoints.length > 0) {
      var animNow = (window.performance && performance.now) ? performance.now() : Date.now();
      var animProgress = Math.min(1, (animNow - chartAnim.start) / CHART_ANIM_DURATION);
      var eased = 1 - Math.pow(1 - animProgress, 3);
      var lastIdx = visiblePoints.length - 1;
      if (visiblePoints[lastIdx].time === chartAnim.to.time) {
        visiblePoints[lastIdx] = {
          time: chartAnim.from.time + ((chartAnim.to.time - chartAnim.from.time) * eased),
          price: chartAnim.from.price + ((chartAnim.to.price - chartAnim.from.price) * eased),
        };
      }
      if (animProgress >= 1) chartAnim = null;
    }
    if (visiblePoints.length < 2) return;

    var drawPoints = getSmoothedChartPoints(visiblePoints);

    var prices = visiblePoints.map(function(p) { return p.price; });
    var high = Math.max.apply(null, prices);
    var low = Math.min.apply(null, prices);

    // Include PTB in range
    if (state.priceToBeat) {
      high = Math.max(high, state.priceToBeat);
      low = Math.min(low, state.priceToBeat);
    }

    var range = high - low || 1;
    high += range * 0.08;
    low -= range * 0.08;
    range = high - low;

    // X axis = current active timeframe window
    var span = endMs - startMs || 1;

    function x(timeMs) { return pad.left + ((timeMs - startMs) / span) * chartW; }
    function y(v) { return pad.top + (1 - (v - low) / range) * chartH; }

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Grid lines + price labels
    ctx.strokeStyle = 'rgba(76, 201, 138, 0.06)';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = pad.top + (g / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(W - pad.right, gy);
      ctx.stroke();
      var gPrice = high - (g / 4) * range;
      ctx.fillStyle = 'rgba(168, 184, 176, 0.5)';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('$' + gPrice.toFixed(0), W - pad.right + 6, gy + 3);
    }

    // Window guide lines
    ctx.strokeStyle = 'rgba(76, 201, 138, 0.1)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    for (var g2 = 1; g2 < 4; g2++) {
      var bx = x(startMs + (span * g2 / 4));
      ctx.beginPath();
      ctx.moveTo(bx, pad.top);
      ctx.lineTo(bx, H - pad.bottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // PTB line
    if (state.priceToBeat && state.priceToBeat >= low && state.priceToBeat <= high) {
      var ptbY = y(state.priceToBeat);
      ctx.strokeStyle = 'rgba(201, 168, 76, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, ptbY);
      ctx.lineTo(W - pad.right, ptbY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(201, 168, 76, 0.8)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('PTB $' + state.priceToBeat.toFixed(0), W - pad.right + 6, ptbY - 4);
    }

    // Color: green if above PTB, red if below
    var lastPrice = prices[prices.length - 1];
    var isUp = state.priceToBeat ? lastPrice >= state.priceToBeat : lastPrice >= prices[0];
    var lineColor = isUp ? 'rgba(76, 201, 138, 0.9)' : 'rgba(201, 76, 76, 0.9)';

    // Gradient fill
    var gradient = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    gradient.addColorStop(0, isUp ? 'rgba(76, 201, 138, 0.15)' : 'rgba(201, 76, 76, 0.15)');
    gradient.addColorStop(1, isUp ? 'rgba(76, 201, 138, 0)' : 'rgba(201, 76, 76, 0)');

    ctx.beginPath();
    traceSmoothChartPath(ctx, drawPoints, x, y);
    ctx.lineTo(x(drawPoints[drawPoints.length - 1].time), H - pad.bottom);
    ctx.lineTo(x(drawPoints[0].time), H - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Price line
    ctx.beginPath();
    traceSmoothChartPath(ctx, drawPoints, x, y);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Current price dot
    var lastPt = visiblePoints[visiblePoints.length - 1];
    var lx = x(lastPt.time);
    var ly = y(lastPt.price);
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx, ly, 8, 0, Math.PI * 2);
    ctx.strokeStyle = isUp ? 'rgba(76, 201, 138, 0.25)' : 'rgba(201, 76, 76, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Current price label
    ctx.fillStyle = lineColor;
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('$' + lastPrice.toFixed(2), W - pad.right + 6, ly + 4);

    // Time labels along bottom (every 5 min)
    ctx.fillStyle = 'rgba(168, 184, 176, 0.4)';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    for (var step = 0; step <= 4; step++) {
      var tMs = startMs + (span * step / 4);
      var tx = x(tMs);
      if (tx > pad.left + 4 && tx < W - pad.right + 4) {
        var t = new Date(tMs);
        var label = t.getHours() + ':' + (t.getMinutes() < 10 ? '0' : '') + t.getMinutes();
        ctx.fillText(label, tx, H - 4);
      }
    }

    // Stats
    if (els.chartHigh) els.chartHigh.textContent = '$' + Math.max.apply(null, prices).toFixed(2);
    if (els.chartLow) els.chartLow.textContent = '$' + Math.min.apply(null, prices).toFixed(2);
    if (els.chartChange) {
      var change = lastPrice - prices[0];
      var changePct = prices[0] ? (change / prices[0] * 100) : 0;
      var sign = change >= 0 ? '+' : '';
      els.chartChange.textContent = sign + '$' + Math.abs(change).toFixed(2) + ' (' + sign + changePct.toFixed(2) + '%)';
      els.chartChange.className = change >= 0 ? 'bullish' : 'bearish';
    }

    // Tooltip on hover
    canvas.onmousemove = function(e) {
      var br = canvas.getBoundingClientRect();
      var mx = e.clientX - br.left;
      var hoverTime = startMs + ((mx - pad.left) / chartW) * span;
      var best = visiblePoints[0], bestDiff = Infinity;
      for (var j = 0; j < visiblePoints.length; j++) {
        var d = Math.abs(visiblePoints[j].time - hoverTime);
        if (d < bestDiff) { bestDiff = d; best = visiblePoints[j]; }
      }
      var t = new Date(best.time);
      var ts = t.getHours() + ':' + (t.getMinutes() < 10 ? '0' : '') + t.getMinutes() + ':' + (t.getSeconds() < 10 ? '0' : '') + t.getSeconds();
      els.chartTooltip.innerHTML = ts + '<br>$' + best.price.toFixed(2);
      els.chartTooltip.style.display = 'block';
      els.chartTooltip.style.left = Math.min(mx + 12, W - 100) + 'px';
      els.chartTooltip.style.top = (y(best.price) - 30) + 'px';
    };
    canvas.onmouseleave = function() {
      els.chartTooltip.style.display = 'none';
    };
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // SMART FINAL PREDICTION ENGINE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Ponis IQ SNIPER ENGINE
  // High-probability setups only â€” fires 1:30 into window
  // Output: LONG / SHORT / NO TRADE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  function analyzeFinalPrediction(candles) {
    if (!els.finalPred || isLocked()) return;

    const ta    = state.ta;
    const price = state.btcPrice;
    const ptb   = state.priceToBeat;

    // â”€â”€ Require minimum data â”€â”€
    if (!price || !candles || candles.length < 20) {
      showNoTrade('NO DATA', 'Insufficient data for analysis.');
      return;
    }

    const signals   = [];
    const warnings  = [];
    let bullScore   = 0;
    let bearScore   = 0;
    let noTradeScore = 0;  // accumulates reasons to skip

    const last    = candles.length - 1;
    const curr    = candles[last];
    const prev    = candles[last - 1];
    const currBull = curr.close > curr.open;
    const prevBull = prev.close > prev.open;
    const currRange = (curr.high - curr.low) || 1;
    const prevRange = (prev.high - prev.low) || 1;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 1 â€” MARKET CONDITION FILTER
    // Classify environment before anything else
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // Volatility: ATR-like measure using last 5 candle ranges
    const ranges5   = candles.slice(-5).map(c => c.high - c.low);
    const avgRange5 = ranges5.reduce((a, b) => a + b, 0) / 5;
    const ranges20  = candles.slice(-20).map(c => c.high - c.low);
    const avgRange20 = ranges20.reduce((a, b) => a + b, 0) / 20;
    const volRatioEnv = avgRange5 / (avgRange20 || 1);

    // Trend: slope of closes over 10 and 20 candles
    const c10 = candles.slice(-10).map(c => c.close);
    const c20 = candles.slice(-20).map(c => c.close);
    const slope10 = (c10[9] - c10[0]) / c10[0] * 100;
    const slope20 = (c20[19] - c20[0]) / c20[0] * 100;
    const trendStrength = Math.abs(slope10);

    // Choppiness: how often closes flip direction
    let dirFlips = 0;
    for (let i = last - 8; i <= last - 1; i++) {
      const b1 = candles[i].close > candles[i].open;
      const b2 = candles[i+1].close > candles[i+1].open;
      if (b1 !== b2) dirFlips++;
    }
    const choppy = dirFlips >= 5; // flips 5+ of 8 transitions = ranging/choppy

    // Volume: 5c vs 20c
    const avgVol5  = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
    const avgVol20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    const volEnvRatio = avgVol5 / (avgVol20 || 1);

    // Classify
    let marketCondition;
    if (volEnvRatio < 0.5 || avgVol5 < avgVol20 * 0.5) {
      marketCondition = 'LOW LIQUIDITY';
    } else if (volRatioEnv > 2.5 || currRange > avgRange20 * 2.5) {
      marketCondition = 'HIGH VOLATILITY';
    } else if (choppy || trendStrength < 0.02) {
      marketCondition = 'RANGING';
    } else {
      marketCondition = 'TRENDING';
    }

    signals.push('ENV:' + marketCondition);

    // Apply market condition rules
    if (marketCondition === 'LOW LIQUIDITY') {
      noTradeScore += 6;
      warnings.push('Low liquidity â€” no trade rule');
    }
    if (marketCondition === 'HIGH VOLATILITY') {
      noTradeScore += 3;
      warnings.push('High volatility â€” need breakout confirm');
    }
    if (marketCondition === 'RANGING') {
      noTradeScore += 2;
      warnings.push('Ranging/choppy â€” low edge');
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 2 â€” MARKET STRUCTURE
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // Break of Structure (BOS) â€” is the current candle breaking a recent swing?
    const swing5High = Math.max(...candles.slice(-6, -1).map(c => c.high));
    const swing5Low  = Math.min(...candles.slice(-6, -1).map(c => c.low));
    const bosUp   = curr.close > swing5High;  // bullish BOS
    const bosDown = curr.close < swing5Low;   // bearish BOS

    if (bosUp)   { bullScore += 2.5; signals.push('BOSâ†‘'); }
    if (bosDown) { bearScore += 2.5; signals.push('BOSâ†“'); }

    // Higher highs / lower lows over last 6 candles
    const s = candles.slice(-6);
    const hh = s[5].high > s[4].high && s[4].high > s[3].high;
    const hl = s[5].low  > s[4].low  && s[4].low  > s[3].low;
    const lh = s[5].high < s[4].high && s[4].high < s[3].high;
    const ll = s[5].low  < s[4].low  && s[4].low  < s[3].low;

    if (hh && hl)      { bullScore += 2;   signals.push('HH/HL'); }
    else if (lh && ll) { bearScore += 2;   signals.push('LH/LL'); }
    else if (hh || hl) { bullScore += 0.5; }
    else if (lh || ll) { bearScore += 0.5; }
    else               { noTradeScore += 1; warnings.push('No clear structure'); }

    // Trend slope agreement
    if (Math.sign(slope10) === Math.sign(slope20)) {
      if (slope10 > 0.03)  { bullScore += 1.5; signals.push('TRENDâ†‘ ALIGNED'); }
      if (slope10 < -0.03) { bearScore += 1.5; signals.push('TRENDâ†“ ALIGNED'); }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 3 â€” KEY LEVELS & LIQUIDITY ZONES
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    const h20 = Math.max(...candles.slice(-20).map(c => c.high));
    const l20 = Math.min(...candles.slice(-20).map(c => c.low));
    const m20 = (h20 + l20) / 2;

    // Equal highs/lows = liquidity zones (stop hunts likely here)
    const highs = candles.slice(-20).map(c => c.high);
    const lows  = candles.slice(-20).map(c => c.low);
    const equalHighs = highs.filter(h => Math.abs(h - h20) / h20 < 0.001).length >= 3;
    const equalLows  = lows.filter(l => Math.abs(l - l20) / l20 < 0.001).length >= 3;

    if (equalHighs && price > h20 * 0.999) { bearScore += 1.5; signals.push('EQUAL HIGHS LIQZONE'); }
    if (equalLows  && price < l20 * 1.001) { bullScore += 1.5; signals.push('EQUAL LOWS LIQZONE'); }

    // Previous highs/lows as S/R
    if (price > h20 * 1.001) { bullScore += 2; signals.push('20C BREAKOUTâ†‘'); }
    if (price < l20 * 0.999) { bearScore += 2; signals.push('20C BREAKDOWNâ†“'); }
    if ((h20 - price) / price * 100 < 0.05 && price <= h20) { bearScore += 1.5; signals.push('AT 20C RESIST'); }
    if ((price - l20) / price * 100 < 0.05 && price >= l20) { bullScore += 1.5; signals.push('AT 20C SUPPORT'); }
    if (price > m20) { bullScore += 0.5; } else { bearScore += 0.5; }

    // PTB as critical level
    if (ptb) {
      const diff = price - ptb;
      const pct  = (diff / ptb) * 100;
      if (Math.abs(pct) > 0.1) {
        if (diff > 0) { bullScore += 5; signals.push('PTB +' + pct.toFixed(3) + '% SAFE'); }
        else          { bearScore += 5; signals.push('PTB ' + pct.toFixed(3) + '% SAFE'); }
      } else if (Math.abs(pct) > 0.03) {
        if (diff > 0) { bullScore += 3; signals.push('PTB +' + pct.toFixed(3) + '%'); }
        else          { bearScore += 3; signals.push('PTB ' + pct.toFixed(3) + '%'); }
      } else if (Math.abs(pct) > 0.01) {
        if (diff > 0) { bullScore += 1; signals.push('PTB +' + pct.toFixed(3) + '% THIN'); }
        else          { bearScore += 1; signals.push('PTB ' + pct.toFixed(3) + '% THIN'); }
      } else {
        noTradeScore += 2;
        warnings.push('Price at PTB â€” coin flip zone');
        signals.push('PTB FLAT');
      }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 4 â€” SMART MONEY CONCEPTS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // Liquidity grab (stop hunt): price spike beyond swing then reversal
    const wickAbove = curr.high > swing5High && curr.close < swing5High; // wick above, closed below
    const wickBelow = curr.low  < swing5Low  && curr.close > swing5Low;  // wick below, closed above
    if (wickAbove) { bearScore += 2; signals.push('LIQ GRAB HIGHâ†’SHORT'); }
    if (wickBelow) { bullScore += 2; signals.push('LIQ GRAB LOWâ†’LONG'); }

    // Fair Value Gap (FVG): gap between candle[i-2].high and candle[i].low (bullish)
    // or candle[i-2].low and candle[i].high (bearish)
    if (last >= 2) {
      const c0 = candles[last - 2];
      const c2 = curr;
      const bullFVG = c0.high < c2.low;   // gap up = bullish imbalance
      const bearFVG = c0.low  > c2.high;  // gap down = bearish imbalance
      if (bullFVG && price >= c0.high && price <= c2.low) { bullScore += 2; signals.push('BULL FVG'); }
      if (bearFVG && price <= c0.low  && price >= c2.high){ bearScore += 2; signals.push('BEAR FVG'); }
    }

    // Order block: last strong opposite-direction candle before current move
    // Bullish OB: last bearish candle before current bull run
    // Bearish OB: last bullish candle before current bear run
    let lastBearIdx = -1, lastBullIdx = -1;
    for (let i = last - 1; i >= Math.max(0, last - 8); i--) {
      if (lastBearIdx === -1 && candles[i].close < candles[i].open) lastBearIdx = i;
      if (lastBullIdx === -1 && candles[i].close > candles[i].open) lastBullIdx = i;
    }
    // Price trading into bullish order block
    if (lastBearIdx > -1 && currBull) {
      const ob = candles[lastBearIdx];
      if (price >= ob.low && price <= ob.high) { bullScore += 1.5; signals.push('BULL ORDER BLOCK'); }
    }
    // Price trading into bearish order block
    if (lastBullIdx > -1 && !currBull) {
      const ob = candles[lastBullIdx];
      if (price >= ob.low && price <= ob.high) { bearScore += 1.5; signals.push('BEAR ORDER BLOCK'); }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 5 â€” CANDLESTICK PATTERNS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(curr.close - curr.open);
    const pUp = (prev.high - Math.max(prev.open, prev.close)) / prevRange;
    const pLo = (Math.min(prev.open, prev.close) - prev.low) / prevRange;
    const cUp = (curr.high - Math.max(curr.open, curr.close)) / currRange;
    const cLo = (Math.min(curr.open, curr.close) - curr.low) / currRange;

    // Engulfing (strong reversal)
    if (currBull && !prevBull && curr.open <= prev.close && curr.close >= prev.open && currBody > prevBody * 1.1)
      { bullScore += 3; signals.push('BULL ENGULF'); }
    if (!currBull && prevBull && curr.open >= prev.close && curr.close <= prev.open && currBody > prevBody * 1.1)
      { bearScore += 3; signals.push('BEAR ENGULF'); }

    // Hammer / Shooting star
    if (pLo > 0.6 && pUp < 0.2) { bullScore += 1.5; signals.push('HAMMER'); }
    if (pUp > 0.6 && pLo < 0.2) { bearScore += 1.5; signals.push('SHOOT STAR'); }

    // Wick rejection = strong
    if (cUp > 0.65) { bearScore += 2; signals.push('UPPER WICK REJECT'); }
    if (cLo > 0.65) { bullScore += 2; signals.push('LOWER WICK REJECT'); }

    // Doji on prev = follow current
    if (prevBody / prevRange < 0.15) {
      if (currBull) { bullScore += 1; signals.push('DOJIâ†’BULL'); }
      else          { bearScore += 1; signals.push('DOJIâ†’BEAR'); }
    }

    // Candle too large = late entry risk
    if (currRange > avgRange20 * 2) {
      noTradeScore += 2;
      warnings.push('Candle too large â€” late entry risk');
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 6 â€” INDICATORS (confirmation only)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // VWAP bias
    if (ta && ta.vwapDist != null) {
      if (ta.vwapDist > 0.05)       { bullScore += 1.5; signals.push('ABOVE VWAP'); }
      else if (ta.vwapDist < -0.05) { bearScore += 1.5; signals.push('BELOW VWAP'); }
    }

    // EMA alignment
    if (ta && ta.emaAligned) {
      if (ta.emaAligned === 'BULLISH')      { bullScore += 1; signals.push('EMA BULL STACK'); }
      else if (ta.emaAligned === 'BEARISH') { bearScore += 1; signals.push('EMA BEAR STACK'); }
      else { noTradeScore += 0.5; }
      if (ta.ema9Slope > 0.01)       { bullScore += 0.5; }
      else if (ta.ema9Slope < -0.01) { bearScore += 0.5; }
    }

    // RSI â€” divergence logic, not just extremes
    if (ta && ta.rsi != null) {
      const rsiVal = ta.rsi;
      // Regular divergence: price HH but RSI LH = bearish div
      if (hh && ta.rsiDelta < -1) { bearScore += 2; signals.push('BEAR RSI DIV'); }
      // Regular divergence: price LL but RSI HL = bullish div
      if (ll && ta.rsiDelta > 1)  { bullScore += 2; signals.push('BULL RSI DIV'); }
      // Extremes
      if (rsiVal > 75)           { bearScore += 2; signals.push('RSI OB ' + rsiVal.toFixed(0)); }
      else if (rsiVal < 25)      { bullScore += 2; signals.push('RSI OS ' + rsiVal.toFixed(0)); }
      else if (ta.rsiDelta > 2)  { bullScore += 0.5; }
      else if (ta.rsiDelta < -2) { bearScore += 0.5; }
    }

    // MACD
    if (ta && ta.macdHist != null) {
      if (ta.macdCrossing) {
        if (ta.macdHist > 0) { bullScore += 1.5; signals.push('MACD BULL X'); }
        else                 { bearScore += 1.5; signals.push('MACD BEAR X'); }
      } else {
        if (ta.macdHist > 0 && ta.macdHistDelta > 0)      { bullScore += 0.5; }
        else if (ta.macdHist < 0 && ta.macdHistDelta < 0) { bearScore += 0.5; }
        else if (ta.macdHist > 0 && ta.macdHistDelta < 0) { bearScore += 0.5; signals.push('MACD FADING'); noTradeScore += 0.5; }
        else if (ta.macdHist < 0 && ta.macdHistDelta > 0) { bullScore += 0.5; }
      }
    }

    // Volume confirmation
    if (ta && ta.volZScore != null) {
      if (ta.volZScore > 2) {
        if (ta.ret1 > 0) { bullScore += 1.5; signals.push('VOL SPIKE BULL'); }
        else             { bearScore += 1.5; signals.push('VOL SPIKE BEAR'); }
      } else if (ta.volZScore < -1.5) {
        noTradeScore += 1.5;
        warnings.push('Volume drying up â€” low conviction');
        signals.push('VOL DRY');
      }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 7 â€” SENTIMENT & POSITIONING (Polymarket)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    if (state.upPct && state.downPct) {
      const up = parseFloat(state.upPct);
      const dn = parseFloat(state.downPct);

      // Contrarian logic: crowd too one-sided = fade them
      if (up > 75) {
        // Crowd heavily long â†’ contrarian SHORT signal
        bearScore += 1.5;
        signals.push('CROWD LONG ' + up + '%â†’CONTRA SHORT');
      } else if (dn > 75) {
        bullScore += 1.5;
        signals.push('CROWD SHORT ' + dn + '%â†’CONTRA LONG');
      } else if (up > 60) {
        bullScore += 2;
        signals.push('MKT UP ' + up + '%');
      } else if (dn > 60) {
        bearScore += 2;
        signals.push('MKT DOWN ' + dn + '%');
      } else if (up > 52) {
        bullScore += 1;
        signals.push('MKT LEAN UP');
      } else if (dn > 52) {
        bearScore += 1;
        signals.push('MKT LEAN DOWN');
      } else {
        noTradeScore += 1;
        warnings.push('Market split â€” no edge from sentiment');
      }
    }

    // Momentum exhaustion check
    if (ta) {
      // Weighted momentum
      const r1 = (candles[last].close   - candles[last-1].close) / candles[last-1].close * 100;
      const r2 = (candles[last-1].close - candles[last-2].close) / candles[last-2].close * 100;
      const r3 = (candles[last-2].close - candles[last-3].close) / candles[last-3].close * 100;
      const wm = (r1 * 3 + r2 * 2 + r3) / 6;
      if (wm > 0.05)       { bullScore += 1.5; signals.push('MOM +' + wm.toFixed(3) + '%'); }
      else if (wm < -0.05) { bearScore += 1.5; signals.push('MOM ' + wm.toFixed(3) + '%'); }

      // Streak exhaustion
      let streak = 0, streakDir = null;
      for (let i = last; i >= Math.max(0, last - 7); i--) {
        const b = candles[i].close > candles[i].open;
        if (streakDir === null) streakDir = b;
        if (b !== streakDir) break;
        streak++;
      }
      if (streak >= 5) {
        if (streakDir) { bearScore += 2; signals.push(streak + ' BULL STREAK EXHAUSTION'); }
        else           { bullScore += 2; signals.push(streak + ' BEAR STREAK EXHAUSTION'); }
        warnings.push('Streak exhaustion â€” mean reversion risk');
      }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 8 â€” CONFLICT CHECK
    // If signals are significantly mixed â†’ NO TRADE
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    const totalScore  = bullScore + bearScore;
    const margin      = Math.abs(bullScore - bearScore);
    const confPct     = totalScore > 0 ? (Math.max(bullScore, bearScore) / totalScore * 100) : 50;

    // Conflicting signals check
    if (bullScore > 0 && bearScore > 0) {
      const conflictRatio = Math.min(bullScore, bearScore) / Math.max(bullScore, bearScore);
      if (conflictRatio > 0.7) {
        noTradeScore += 3;
        warnings.push('Signals heavily conflicting (' + (conflictRatio * 100).toFixed(0) + '% conflict)');
      } else if (conflictRatio > 0.5) {
        noTradeScore += 1.5;
        warnings.push('Mixed signals â€” reduced confidence');
      }
    }

    // Risk:Reward check â€” only trade if clear edge
    if (margin < 2) {
      noTradeScore += 2;
      warnings.push('Insufficient signal edge (margin ' + margin.toFixed(1) + ')');
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 9 â€” FINAL DECISION
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    const isLong   = bullScore > bearScore;
    const direction = bullScore > bearScore ? 'UP' : 'DOWN';

    // NO TRADE conditions
    const noTrade = noTradeScore >= 4 || margin < 1.5 || confPct < 57;

    let confLabel, confLevel;
    if (margin >= 6)      { confLabel = 'HIGH';   confLevel = 'high'; }
    else if (margin >= 3) { confLabel = 'MEDIUM'; confLevel = 'medium'; }
    else                  { confLabel = 'LOW';    confLevel = 'low'; }

    // Entry / SL / TP calculation
    const entryZone = price ? '$' + price.toFixed(2) : '--';
    const slDist    = ptb ? Math.abs(price - ptb) * 1.2 : (price * 0.001);
    const tpDist    = slDist * 2;  // minimum 1:2 R:R
    const sl = price ? '$' + (isLong ? price - slDist : price + slDist).toFixed(2) : '--';
    const tp = price ? '$' + (isLong ? price + tpDist : price - tpDist).toFixed(2) : '--';

    console.log('[AGENT] SNIPER: ' + (noTrade ? 'NO TRADE' : direction) +
      ' | Env:' + marketCondition + ' | Conf:' + confLabel +
      ' | Bull:' + bullScore.toFixed(1) + ' Bear:' + bearScore.toFixed(1) +
      ' | NoTrade:' + noTradeScore.toFixed(1) +
      '\n[AGENT] Signals: ' + signals.join(' Â· ') +
      (warnings.length ? '\n[AGENT] Warnings: ' + warnings.join(' Â· ') : ''));

    if (noTrade) {
      showNoTrade(marketCondition, warnings.join(' Â· ') || 'No high-probability setup detected.');
      setLocked(null, ptb);
      return;
    }

    // â”€â”€ Render prediction â”€â”€
    setPredictionFinalState(true);
    els.finalPred.style.display = 'block';
    els.finalPred.className     = 'agent-final-pred pred-' + (isLong ? 'up' : 'down');
    if (els.finalIcon)    els.finalIcon.textContent    = isLong ? '\u{1F7E2}' : '\u{1F534}';
    if (els.finalCall)    els.finalCall.textContent    = isLong ? 'UP' : 'DOWN';
    if (els.finalConf) {
      els.finalConf.textContent = confLabel + ' ' + confPct.toFixed(0) + '%';
      els.finalConf.className   = 'agent-final-conf ' + confLevel;
    }
    if (els.finalStatus)  els.finalStatus.textContent  = marketCondition + ' Â· LOCKED';
    if (els.finalPrice)   els.finalPrice.textContent   = entryZone;
    if (els.finalSignals) els.finalSignals.textContent =
      'Entry: ' + entryZone + ' | SL: ' + sl + ' | TP: ' + tp +
      ' Â· ' + signals.join(' Â· ');

    setLocked(isLong ? 'up' : 'down', ptb);
  }

  // â”€â”€ Show NO TRADE state â”€â”€
  function showNoTrade(condition, reason) {
    if (!els.finalPred) return;
    setPredictionFinalState(true);
    els.finalPred.style.display = 'block';
    els.finalPred.className     = 'agent-final-pred pred-neutral';
    if (els.finalIcon)    els.finalIcon.textContent    = '\u26D4';
    if (els.finalCall)    els.finalCall.textContent    = 'NO TRADE';
    if (els.finalConf) {
      els.finalConf.textContent = 'SKIP';
      els.finalConf.className   = 'agent-final-conf low';
    }
    if (els.finalStatus)  els.finalStatus.textContent  = condition || 'NO EDGE';
    if (els.finalPrice)   els.finalPrice.textContent   = state.btcPrice ? formatPrice(state.btcPrice) : '--';
    if (els.finalSignals) els.finalSignals.textContent = reason || 'No high-probability setup.';
    console.log('[AGENT] NO TRADE â€” ' + (condition || '') + ': ' + (reason || ''));

    // Save skip to Supabase so it appears in history
    saveSkip(condition, reason);
  }

  // â”€â”€ Save a SKIP entry to Supabase predictions â”€â”€
  async function saveSkip(condition, reason) {
    const table       = (TF_CONFIG[activeTF] && TF_CONFIG[activeTF].historyTable) || 'predictions';
    const winSecs     = TF_CONFIG[activeTF].seconds;
    const now         = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / winSecs) * winSecs;
    const row = {
      ts:        windowStart,
      ptb:       state.priceToBeat || null,
      end_price: null,
      over:      null,
      source:    TF_CONFIG[activeTF].source + '-skip',
    };
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
        method: 'POST',
        headers: {
          ...SB_HEADERS,
          'Prefer': 'resolution=ignore-duplicates', // ignore if already exists
        },
        body: JSON.stringify(row),
      });
      // 201 = created, 200 = ok, both fine. Ignore 409 duplicate conflicts.
      if (!res.ok && res.status !== 409) {
        const txt = await res.text();
        if (res.status === 400 && txt.indexOf('23502') !== -1) {
          console.warn('[AGENT] Skip save failed: the ' + table + ' table still requires non-null settled fields. Skip rows use null ptb/end_price/over, so you need to run scripts/fix-prediction-skip-schema.sql in Supabase.', txt);
        } else {
          console.warn('[AGENT] Skip save failed:', res.status, txt);
        }
      } else {
        console.log('[AGENT][' + activeTF + '] Skip saved for window', windowStart, 'source:', row.source);
        lastHistorySnapshot = '';
        try { await refreshHistory(); } catch (e) {}
      }
    } catch (e) {
      console.error('[AGENT] Skip save error:', e.message);
    }
  }


  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // FETCH LIVE PREDICTION FROM BOT (single source of truth)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  let lastPredFetch = 0;

  async function fetchLivePrediction() {
    var now = Date.now();
    if (now - lastPredFetch < 5000) return;
    lastPredFetch = now;

    try {
      var predId = TF_CONFIG[activeTF].livePredId;
      var url    = SUPABASE_URL + '/rest/v1/live_prediction?id=eq.' + predId + '&select=*';
      var res    = await fetch(url, { headers: SB_HEADERS });
      if (!res.ok) return;
      var data = await res.json();
      if (!data || data.length === 0) return;

      var pred = data[0];
      var activeWindowStart = getActiveWindowStart();
      var predWindowStart = pred.window_start != null ? Number(pred.window_start) : null;
      var predUpdatedMs = pred.updated_at ? Date.parse(pred.updated_at) : NaN;
      var isCurrentWindow = false;

      if (predWindowStart != null && !Number.isNaN(predWindowStart)) {
        isCurrentWindow = predWindowStart === activeWindowStart;
      } else if (!Number.isNaN(predUpdatedMs)) {
        isCurrentWindow = predUpdatedMs >= (activeWindowStart * 1000);
      } else {
        isCurrentWindow = true;
      }

      if (!isCurrentWindow) {
        if (isLocked()) return;
        setPredictionFinalState(false);
        if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'flex';
        return;
      }

      if (pred.direction === 'pending' || !pred.direction) {
        if (isLocked()) return;
        setPredictionFinalState(false);
        if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'flex';
        return;
      }

      if (isLocked()) return;

      // Bot has a prediction â€” display it
      var isUp = pred.direction === 'over' || pred.direction === 'up';
      setPredictionFinalState(true);
      setLocked(pred.direction, pred.ptb ? parseFloat(pred.ptb) : null);

      if (els.finalPred) {
        els.finalPred.style.display = 'block';
        els.finalPred.className = 'agent-final-pred pred-' + (isUp ? 'up' : 'down');
      }
      if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'none';
      if (els.finalIcon) els.finalIcon.textContent = isUp ? '\u{1F7E2}' : '\u{1F534}';
      if (els.finalCall) els.finalCall.textContent = isUp ? 'UP' : 'DOWN';
      if (els.finalConf) {
        els.finalConf.textContent = (pred.confidence || 'MED') + ' ' + (pred.conf_pct ? pred.conf_pct.toFixed(0) + '%' : '--');
        var confLevel = pred.confidence === 'HIGH' ? 'high' : pred.confidence === 'LOW' ? 'low' : 'medium';
        els.finalConf.className = 'agent-final-conf ' + confLevel;
      }
      if (els.finalStatus) els.finalStatus.textContent = 'LOCKED IN';
      if (els.finalPrice) els.finalPrice.textContent = pred.btc_price ? formatPrice(pred.btc_price) : '--';
      if (els.finalSignals) els.finalSignals.textContent = pred.signals || ('Bull: ' + (pred.bull_score || 0).toFixed(1) + ' Â· Bear: ' + (pred.bear_score || 0).toFixed(1));

    } catch (e) {
      // Silently fail â€” will retry in 5s
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // COUNTDOWN TIMER
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  function updateCountdown() {
    if (!els.countdown) return;
    const cfg        = TF_CONFIG[activeTF];
    const winSecs    = cfg.seconds;
    const now        = Math.floor(Date.now() / 1000);
    const windowEnd  = (Math.floor(now / winSecs) + 1) * winSecs;
    const windowStart = windowEnd - winSecs;
    const left       = windowEnd - now;
    const mins       = Math.floor(left / 60);
    const secs       = left % 60;
    var countdownText = mins + ':' + (secs < 10 ? '0' : '') + secs;
    els.countdown.textContent = countdownText;
    if (els.finalCountdown) els.finalCountdown.textContent = countdownText;

    // New window detected â€” reset prediction state
    if (state.currentWindowStart !== windowStart) {
      state.currentWindowStart = windowStart;
      state.priceToBeat  = null;
      ptbSource          = '';
      resetLock();
      setPredictionFinalState(false);
      setTimeout(refresh, 500);
    }

    // Prediction timing
    const timing           = (TF_CONFIG[activeTF] && TF_CONFIG[activeTF].timing) || DEFAULT_TF_CONFIG['5m'].timing;
    const analyzeThreshold = timing.analyze;
    const lockThreshold    = timing.lock;

    if (left > analyzeThreshold) {
      setPredictionFinalState(false);
      if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'none';
      if (isLocked()) resetLock(); // reset if we somehow got here locked
    } else if (left > lockThreshold && left <= analyzeThreshold) {
      setPredictionFinalState(false);
      if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'flex';
    } else {
      if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'none';
      if (!isLocked()) {
        if ((TF_CONFIG[activeTF] && TF_CONFIG[activeTF].predictionMode) === 'local') {
          analyzeFinalPrediction(window._lastCandles || null);
        } else {
          fetchLivePrediction();
        }
      }
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // MAIN LOOP
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  let refreshing = false;
  async function refreshHistory() {
    try {
      var history = await fetchHistory();
      var snapshot = getHistorySnapshot(history);
      if (!history || snapshot === lastHistorySnapshot) return;
      updateHistoryUI(history);
      var record = computeTrackRecord(history);
      updateStatsUI(record);
    } catch (e) {}
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;

    // Fetch critical data (Supabase + Binance â€” reliable, fast)
    try {
      const [candles, history] = await Promise.all([
        fetchCandles(),
        fetchHistory(),
      ]);

      console.log('[AGENT] Refresh â€” candles:', candles ? candles.length : 0,
        '| history:', history ? history.length : 0);

      // TA from candles
      try {
        const ta = computeTA(candles);
        updateTAUI(ta);
        window._lastCandles = candles; // store for sniper engine
        updateVolatilityMeter(candles);
      } catch (e) { console.error('[AGENT] TA error:', e); }

      // Chart â€” re-render with latest PTB (price points fed by WebSocket)
      renderChart();

      // If we don't have WS price yet, use candle close
      if (!state.btcPrice && candles && candles.length > 0) {
        state.btcPrice = candles[candles.length - 1].close;
        state.priceSource = 'binance';
        updatePriceUI();
      }

      // History (renders predictions + model perf)
      try {
        console.log('[AGENT] Rendering history...', 'els.historyList:', !!els.historyList);
        updateHistoryUI(history);
        updateOddsAccuracy(history);
        console.log('[AGENT] History rendered OK');
      } catch (e) { console.error('[AGENT] History render error:', e); }

      // Track record â€” always compute fresh from history data
      try {
        if (history && history.length > 0) {
          const record = computeTrackRecord(history);
          console.log('[AGENT] Track record from history:', record.wins, 'W', record.losses, 'L', '/', history.length, 'total');
          updateStatsUI(record);
        }
      } catch (e) { console.error('[AGENT] Stats render error:', e); }

      // Update price vs PTB display
      updatePriceUI();

      // Live prediction call
      updateCallUI();

    } catch (e) {
      console.error('[AGENT] Refresh error:', e.message);
      refreshing = false;
      return;
    }

    // PTB: Check sessionStorage cache FIRST (survives refresh)
    var now = Math.floor(Date.now() / 1000);
    var currentStart = getWindowStart(now, activeTF);
    var cacheKey = getPtbCacheKey(activeTF, currentStart);
    try {
      var cachedPtb = sessionStorage.getItem(cacheKey);
      if (cachedPtb) {
        var cachedVal = parseFloat(cachedPtb);
        if (cachedVal > 0) {
          state.priceToBeat = cachedVal;
          ptbSource = 'polymarket-cached';
          if (els.ptb) els.ptb.textContent = formatPrice(cachedVal);
          console.log('[AGENT] PTB from session cache (instant):', cachedVal);
          updatePriceUI();
          updateCallUI();
          renderChart();
        }
      }
    } catch (e) {}

    // Then try Polymarket for fresh data + odds (won't override cached PTB unless it has authoritative startPrice)
    try {
      const polyData = await fetchPolymarket();
      updatePredictionUI(polyData);
      updatePriceUI();
      updateCallUI();
      renderChart();
    } catch (e) {
      console.warn('[AGENT] Polymarket failed:', e.message);
    }

    // Only use Binance fallback if we STILL have no PTB at all
    if (!state.priceToBeat) {
      try {
        const ptb = await fetchPTBFallback();
        if (ptb) {
          state.priceToBeat = ptb;
          ptbSource = 'binance';
          if (els.ptb) els.ptb.textContent = formatPrice(ptb);
          // Cache it so even Binance PTB survives refresh
          try { sessionStorage.setItem(cacheKey, ptb.toString()); } catch(e) {}
          console.log('[AGENT] PTB from Binance fallback:', ptb);
          updatePriceUI();
          updateCallUI();
          renderChart();
        }
      } catch (e2) { console.error('[AGENT] PTB fallback error:', e2.message); }
    }

    // For 15m and 1h â€” also fetch the bot's live prediction from Supabase
    if ((TF_CONFIG[activeTF] && TF_CONFIG[activeTF].predictionMode) !== 'local') {
      try { await fetchLivePrediction(); } catch(e) {}
    }

    refreshing = false;
  }

  // â”€â”€ Init â”€â”€
  function init() {
    if (!els.btcPrice) return;

    // Inject SKIP row style
    const skipStyle = document.createElement('style');
    skipStyle.textContent = '.agent-history-result.skip { color: rgba(168,184,176,0.45); font-size: 0.72rem; letter-spacing: 0.08em; } .agent-history-item.skip { opacity: 0.55; }';
    document.head.appendChild(skipStyle);

    unlockUI();
  }

  // â”€â”€ Send ping to admin â”€â”€
  async function pingAdmin() {
    let code;
    try { code = localStorage.getItem(ACCESS_LS_KEY); } catch(e) {}
    if (!code) return;
    const pingBtn = document.getElementById('agentPingBtn');
    if (pingBtn) { pingBtn.disabled = true; pingBtn.textContent = 'Pinging...'; }
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/access_codes?code=eq.' + encodeURIComponent(code),
        {
          method: 'PATCH',
          headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ pinged: true, pinged_at: new Date().toISOString() }),
        }
      );
      if (!res.ok) throw new Error(res.status);
      if (pingBtn) {
        pingBtn.textContent = '\u2713 Admin Pinged!';
        pingBtn.style.borderColor = 'rgba(76,201,138,0.4)';
        pingBtn.style.color = '#4cc98a';
      }
    } catch(e) {
      console.error('[AGENT] Ping failed:', e);
      if (pingBtn) { pingBtn.disabled = false; pingBtn.textContent = '\u{1F514} Ping Admin'; }
    }
  }

  let agentStarted = false;

  function startAgent() {
    if (agentStarted) return;
    agentStarted = true;
    setStatus('connecting', 'CONNECTING...');
    setWsIndicator('reconnecting', 'CONNECTING');
    loadChartHistory();
    connectRTDS();
    refresh();
    setInterval(refresh, 30000);
    setInterval(refreshHistory, 15000);
    setInterval(updateCountdown, 1000);
    setInterval(updateConfluence, 15000);
    updateCountdown();
    updateConfluence();

    // Init new features
    initAgentHelp();
    initPonisIQ();
    initShareBtn();
    initNotifBtn();
    initChat();

    // â”€â”€ Timeframe tab switcher â”€â”€
    document.querySelectorAll('.agent-tf-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchTimeframe(btn.dataset.tf);
      });
    });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // #42 MULTI-TF CONFLUENCE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  async function updateConfluence() {
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/live_prediction?id=in.(1,2,3)&select=id,direction,confidence,conf_pct',
        { headers: SB_HEADERS }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (!data || data.length === 0) return;

      const map = {};
      data.forEach(p => { map[p.id] = p; });

      const tfs = [
        { id: 1, key: '5m',  elDir: 'conf5m',  elConf: 'conf5mConf' },
        { id: 2, key: '15m', elDir: 'conf15m', elConf: 'conf15mConf' },
        { id: 3, key: '1h',  elDir: 'conf1h',  elConf: 'conf1hConf' },
      ];

      const dirs = [];
      tfs.forEach(tf => {
        const pred = map[tf.id];
        const elDir  = document.getElementById(tf.elDir);
        const elConf = document.getElementById(tf.elConf);
        if (!pred || pred.direction === 'pending' || !pred.direction) {
          if (elDir)  { elDir.textContent = '--'; elDir.className = 'confluence-dir'; }
          if (elConf) elConf.textContent = '--';
          dirs.push(null);
        } else {
          const isUp = pred.direction === 'up' || pred.direction === 'over';
          const dir  = pred.direction === null ? 'SKIP' : (isUp ? 'UP' : 'DOWN');
          if (elDir)  { elDir.textContent = dir; elDir.className = 'confluence-dir ' + (dir === 'UP' ? 'up' : dir === 'DOWN' ? 'down' : 'skip'); }
          if (elConf) elConf.textContent = pred.conf_pct ? pred.conf_pct.toFixed(0) + '%' : '--';
          dirs.push(isUp ? 'up' : 'down');
        }
      });

      const validDirs  = dirs.filter(d => d !== null);
      const allUp      = validDirs.length === 3 && validDirs.every(d => d === 'up');
      const allDown    = validDirs.length === 3 && validDirs.every(d => d === 'down');
      const allAgree   = allUp || allDown;
      const score      = validDirs.length === 0 ? '--' :
        Math.round((validDirs.filter(d => d === 'up').length / validDirs.length) * 100) + '% UP';

      const badge = document.getElementById('confluenceScore');
      if (badge) {
        badge.textContent  = allAgree ? (allUp ? '\u{1F525} ALL UP' : '\u{1F525} ALL DOWN') : score;
        badge.className    = 'confluence-score-badge ' + (allAgree ? 'agree' : 'split');
      }

      const alert = document.getElementById('confluenceAlert');
      const alertText = document.getElementById('confluenceAlertText');
      if (alert) {
        if (allAgree) {
          alert.style.display = 'flex';
          alert.className = 'confluence-alert' + (allDown ? ' bearish' : '');
          if (alertText) alertText.textContent = allUp ? '\u{1F525} All 3 timeframes agree: UP - strong signal!' : '\u{1F525} All 3 timeframes agree: DOWN - strong signal!';
        } else {
          alert.style.display = 'none';
        }
      }
    } catch(e) { console.error('[AGENT] Confluence error:', e.message); }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // #43 VOLATILITY METER
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  function updateVolatilityMeter(candles) {
    if (!candles || candles.length < 20) return;
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);
    const vols   = candles.map(c => c.volume);
    const last   = candles.length - 1;

    // ATR %
    const ranges = candles.slice(-14).map((c, i, arr) => {
      if (i === 0) return c.high - c.low;
      return Math.max(c.high - c.low, Math.abs(c.high - arr[i-1].close), Math.abs(c.low - arr[i-1].close));
    });
    const atrVal = ranges.reduce((a,b) => a+b, 0) / ranges.length;
    const atrPct = (atrVal / closes[last]) * 100;

    // BB Width
    const slice20 = closes.slice(-20);
    const mean20  = slice20.reduce((a,b) => a+b, 0) / 20;
    const std20   = Math.sqrt(slice20.reduce((s,x) => s + (x-mean20)**2, 0) / 20);
    const bbWidth = std20 > 0 ? ((4 * std20) / mean20) * 100 : 0;

    // Vol Z
    const volSlice = vols.slice(-20);
    const volMean  = volSlice.reduce((a,b) => a+b, 0) / 20;
    const volStd   = Math.sqrt(volSlice.reduce((s,x) => s + (x-volMean)**2, 0) / 20);
    const volZ     = volStd > 0 ? (vols[last] - volMean) / volStd : 0;

    // Level
    let level, pct;
    if (atrPct < 0.08)       { level = 'LOW';     pct = 15; }
    else if (atrPct < 0.15)  { level = 'MEDIUM';  pct = 40; }
    else if (atrPct < 0.30)  { level = 'HIGH';    pct = 70; }
    else                     { level = 'EXTREME'; pct = 95; }

    const badge = document.getElementById('volLevelBadge');
    const fill  = document.getElementById('volMeterFill');
    if (badge) { badge.textContent = level; badge.className = 'vol-level-badge ' + level.toLowerCase(); }
    if (fill)  fill.style.width = pct + '%';

    const atrEl = document.getElementById('volAtr');
    const bbEl  = document.getElementById('volBb');
    const zEl   = document.getElementById('volZ');
    if (atrEl) atrEl.textContent = atrPct.toFixed(3) + '%';
    if (bbEl)  bbEl.textContent  = bbWidth.toFixed(3) + '%';
    if (zEl)   zEl.textContent   = volZ.toFixed(2);
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // #10 MARKET ODDS ACCURACY
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  function updateOddsAccuracy(predictions) {
    if (!predictions || predictions.length === 0) return;
    const settled = predictions.filter(p =>
      !isSkipEntry(p) &&
      p.over !== null && p.over !== undefined &&
      p.end_price != null && p.ptb != null
    ).slice(0, 100);

    if (settled.length === 0) return;

    let crowdCorrect = 0, crowdWrong = 0;
    settled.forEach(p => {
      const actualOver = p.end_price > p.ptb;
      // We don't store Polymarket odds per prediction, so use over field as proxy
      const over = parseStoredBool(p.over);
      if (over === null) return;
      if (over === actualOver) crowdCorrect++; else crowdWrong++;
    });

    const crowdRate = settled.length > 0 ? ((crowdCorrect / settled.length) * 100).toFixed(1) : '--';
    const botWins   = settled.filter(p => {
      return parseStoredBool(p.over) === true;
    }).length;
    const botRate = settled.length > 0 ? ((botWins / settled.length) * 100).toFixed(1) : '--';
    const vsBot   = parseFloat(botRate) > parseFloat(crowdRate) ? 'BOT WINS' : 'CROWD WINS';

    const el1 = document.getElementById('oddsAccCorrect');
    const el2 = document.getElementById('oddsAccWrong');
    const el3 = document.getElementById('oddsAccRate');
    const el4 = document.getElementById('oddsVsBot');
    if (el1) el1.textContent = crowdCorrect;
    if (el2) el2.textContent = crowdWrong;
    if (el3) el3.textContent = crowdRate + '%';
    if (el4) { el4.textContent = vsBot; el4.style.color = vsBot.includes('BOT') ? '#4cc98a' : '#e8c55a'; }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PREDICTION SHARE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const VG_SHARE_TIMEZONE = 'America/New_York'; // US time (ET)

  function formatShareUsTime(d) {
    try {
      const t = new Intl.DateTimeFormat('en-US', {
        timeZone: VG_SHARE_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(d);
      return t + ' ET';
    } catch (e) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  function buildShareText(data) {
    const tf    = data.tf || '--';
    const dir   = data.dir || '--';
    const ptb   = data.ptb || '--';
    const price = data.price || '--';
    const conf  = data.conf || '--';
    const vol   = data.vol || '--';
    const time  = data.timeStr || '--';
    const result = data.result || '--';

    return `Ponis IQ AI â€” ${tf} BTC Prediction\n` +
      `Volatility: ${vol}\n` +
      `Direction: ${dir}\n` +
      `PTB: ${ptb} | BTC: ${price}\n` +
      `Confidence: ${conf} | Window: ${time}\n` +
      `Result: ${result}\n` +
      `#Bitcoin #BTC #CryptoTrading`;
  }

  function getShareResultData() {
    const history = Array.isArray(state.history) ? state.history : [];
    const primarySource = TF_CONFIG[activeTF] ? TF_CONFIG[activeTF].source : '';
    const preferredSources = ['vanguard', primarySource].filter(Boolean);

    const rows = history
      .filter(function(prediction) {
        return prediction && !isSkipEntry(prediction);
      })
      .slice()
      .sort(function(a, b) {
        return (Number(b.ts) || 0) - (Number(a.ts) || 0);
      });

    if (rows.length === 0) {
      return { label: '--', className: '' };
    }

    const latestTs = Number(rows[0].ts) || 0;
    const sameWindowRows = rows
      .filter(function(prediction) {
        return (Number(prediction.ts) || 0) === latestTs;
      })
      .sort(function(a, b) {
        const aSettled = a.ptb != null && a.end_price != null;
        const bSettled = b.ptb != null && b.end_price != null;
        if (aSettled !== bSettled) return aSettled ? -1 : 1;

        const aSourceRank = preferredSources.indexOf(a.source || '');
        const bSourceRank = preferredSources.indexOf(b.source || '');
        const aRank = aSourceRank === -1 ? 99 : aSourceRank;
        const bRank = bSourceRank === -1 ? 99 : bSourceRank;
        return aRank - bRank;
      });

    const prediction = sameWindowRows[0];
    if (!prediction) {
      return { label: '--', className: '' };
    }

    if (prediction.ptb == null || prediction.end_price == null) {
      return { label: 'PENDING', className: 'pending' };
    }

    const correct = parseStoredBool(prediction.over);
    if (correct === null) {
      return { label: 'UNSETTLED', className: 'unsettled' };
    }

    return {
      label: correct ? 'WIN' : 'LOSS',
      className: correct ? 'win' : 'loss',
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { try { URL.revokeObjectURL(url); } catch(e) {} }, 2000);
  }

  async function copyPngToClipboard(blob) {
    try {
      if (!blob) return false;
      if (!navigator.clipboard || !window.ClipboardItem) return false;
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      return true;
    } catch (e) {
      return false;
    }
  }

  function formatConfidenceDisplay(raw) {
    const s = (raw || '').toString().trim();
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return s || '--';
    const pct = parseFloat(m[1]);
    if (isNaN(pct)) return s || '--';
    const label = pct >= 70 ? 'HIGH' : pct >= 55 ? 'MED' : 'LOW';
    return label + ' ' + Math.round(pct) + '%';
  }

  function drawRoundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawImageCover(ctx, img, x, y, w, h) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(w / iw, h / ih);
    const sw = iw * scale;
    const sh = ih * scale;
    const sx = x + (w - sw) / 2;
    const sy = y + (h - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh);
  }

  function loadImage(src) {
    return new Promise(function(resolve, reject) {
      const img = new Image();
      img.onload = function() { resolve(img); };
      img.onerror = function() { reject(new Error('Failed to load ' + src)); };
      img.src = src;
    });
  }

  async function renderShareCardPng(data) {
    const W = 1200, H = 675; // X-friendly 16:9
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#05080c');
    bg.addColorStop(0.5, '#0a1410');
    bg.addColorStop(1, '#05080c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    let bgImg = null;
    try {
      bgImg = await loadImage('public/bg.png');
      ctx.save();
      ctx.globalAlpha = 0.18;
      drawImageCover(ctx, bgImg, 0, 0, W, H);
      ctx.restore();
    } catch (e) {}

    const cardX = 90, cardY = 75, cardW = W - 180, cardH = H - 150;
    ctx.save();
    drawRoundRect(ctx, cardX, cardY, cardW, cardH, 18);
    ctx.fillStyle = 'rgba(8,14,12,0.74)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(76,201,138,0.18)';
    ctx.stroke();
    ctx.restore();

    // Subtle background inside the card
    if (bgImg) {
      ctx.save();
      drawRoundRect(ctx, cardX, cardY, cardW, cardH, 18);
      ctx.clip();
      ctx.globalAlpha = 0.22;
      drawImageCover(ctx, bgImg, cardX, cardY, cardW, cardH);
      ctx.globalAlpha = 1;
      const overlay = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
      overlay.addColorStop(0, 'rgba(0,0,0,0.30)');
      overlay.addColorStop(0.55, 'rgba(0,0,0,0.12)');
      overlay.addColorStop(1, 'rgba(0,0,0,0.34)');
      ctx.fillStyle = overlay;
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.restore();
    }

    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch(e) {}

    const pad = 64;
    const x0 = cardX + pad;
    const y0 = cardY + pad;

    let logoW = 0;
    try {
      const logo = await loadImage('public/favicon.png');
      const lh = 40;
      const lw = Math.round(lh * ((logo.naturalWidth || 1) / (logo.naturalHeight || 1)));
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.drawImage(logo, x0, y0 - 34, lw, lh);
      ctx.restore();
      logoW = lw + 18;
    } catch(e) { logoW = 0; }

    ctx.fillStyle = 'rgba(200,220,210,0.9)';
    ctx.font = '700 34px "Chakra Petch", sans-serif';
    ctx.fillText('Ponis IQ', x0, y0);

    const tf = (data.tf || '--').toString();
    ctx.font = '700 22px "JetBrains Mono", monospace';
    const tfW = Math.ceil(ctx.measureText(tf).width);
    const tfPadX = 18, tfH = 40;
    const tfX = cardX + cardW - pad - (tfW + tfPadX * 2);
    const tfY = y0 - 32;
    ctx.save();
    drawRoundRect(ctx, tfX, tfY, tfW + tfPadX * 2, tfH, 8);
    ctx.fillStyle = 'rgba(76,201,138,0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(76,201,138,0.30)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#4cc98a';
    ctx.fillText(tf, tfX + tfPadX, tfY + 28);
    ctx.restore();

    const vol = (data.vol || '--').toString();
    const dir = (data.dir || '--').toString();
    const mainY = y0 + 110;

    ctx.save();
    ctx.font = '700 18px "JetBrains Mono", monospace';
    const volText = (vol + ' VOLATILITY').toUpperCase();
    const volW = Math.ceil(ctx.measureText(volText).width);
    const volBoxW = volW + 26;
    const volBoxH = 34;
    const volX = x0;
    const volY = mainY - 40;
    drawRoundRect(ctx, volX, volY, volBoxW, volBoxH, 8);

    let volStroke = 'rgba(232,197,90,0.28)';
    let volFill   = 'rgba(232,197,90,0.10)';
    let volColor  = 'rgba(232,197,90,0.92)';
    if (vol === 'LOW') {
      volStroke = 'rgba(76,201,138,0.30)';
      volFill   = 'rgba(76,201,138,0.10)';
      volColor  = 'rgba(76,201,138,0.92)';
    }
    if (vol === 'HIGH' || vol === 'EXTREME') {
      volStroke = 'rgba(224,85,85,0.30)';
      volFill   = 'rgba(224,85,85,0.10)';
      volColor  = 'rgba(224,85,85,0.92)';
    }

    ctx.fillStyle = volFill;
    ctx.fill();
    ctx.strokeStyle = volStroke;
    ctx.stroke();
    ctx.fillStyle = volColor;
    ctx.fillText(volText, volX + 13, volY + 23);
    ctx.restore();

    ctx.save();
    ctx.font = '700 120px "Chakra Petch", sans-serif';
    ctx.fillStyle = (dir === 'DOWN') ? '#e05555' : '#4cc98a';
    ctx.fillText(dir, x0, mainY + 120);
    ctx.restore();

    const metaX = x0 + 520;
    const metaY = mainY + 10;
    const rowH = 52;
    const rows = [
      { k: 'PTB',        v: data.ptb || '--' },
      { k: 'BTC',        v: data.price || '--' },
      { k: 'CONFIDENCE', v: data.conf || '--' },
      { k: 'WINDOW',     v: data.timeStr || '--' },
      { k: 'RESULT',     v: data.result || '--' },
    ];

    ctx.save();
    ctx.font = '600 24px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(200,220,210,0.65)';
    rows.forEach(function(r, idx) {
      const yy = metaY + idx * rowH;
      ctx.fillText(r.k, metaX, yy);
      const val = (r.v || '--').toString();
      ctx.fillStyle = 'rgba(200,220,210,0.92)';
      const vw = ctx.measureText(val).width;
      ctx.fillText(val, cardX + cardW - pad - vw, yy);
      ctx.fillStyle = 'rgba(200,220,210,0.65)';
    });
    ctx.restore();

    ctx.save();
    ctx.font = '700 18px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(200,220,210,0.28)';
    ctx.fillText('AI-POWERED PREDICTION', x0, cardY + cardH - 44);
    ctx.restore();

    const blob = await new Promise(function(resolve) {
      canvas.toBlob(function(b) { resolve(b); }, 'image/png');
    });
    return blob;
  }

  function openShareModal() {
    const modal    = document.getElementById('shareModal');
    if (!modal) return;

    // Populate card data
    const tf       = activeTF.toUpperCase();
    const lock     = tfLockState[activeTF];
    const dir      = lock.locked ? (lock.direction === 'up' ? 'UP' : lock.direction === 'down' ? 'DOWN' : 'SKIP') : '--';
    const ptb      = state.priceToBeat ? formatPrice(state.priceToBeat) : '--';
    const price    = state.btcPrice    ? formatPrice(state.btcPrice)    : '--';
    const confEl   = document.getElementById('agentFinalConf');
    const confRaw  = confEl ? confEl.textContent : '--';
    const conf     = formatConfidenceDisplay(confRaw);
    const now      = new Date();
    const timeStr  = formatShareUsTime(now);
    const volBadge = document.getElementById('volLevelBadge');
    const vol      = volBadge ? (volBadge.textContent || '--').trim() : '--';
    const result   = getShareResultData();

    const dirEl = document.getElementById('shareCardDir');
    if (dirEl) { dirEl.textContent = dir; dirEl.className = 'share-card-dir' + (dir === 'DOWN' ? ' down' : ''); }
    const tfEl = document.getElementById('shareCardTf'); if (tfEl) tfEl.textContent = tf;
    const ptbEl = document.getElementById('shareCardPtb'); if (ptbEl) ptbEl.textContent = ptb;
    const priceEl = document.getElementById('shareCardPrice'); if (priceEl) priceEl.textContent = price;
    const confCardEl = document.getElementById('shareCardConf'); if (confCardEl) confCardEl.textContent = conf;
    const timeEl = document.getElementById('shareCardTime'); if (timeEl) timeEl.textContent = timeStr;
    const volEl = document.getElementById('shareCardVol');
    if (volEl) {
      volEl.textContent = (vol || '--') + ' VOLATILITY';
      volEl.className = 'share-card-vol ' + (vol || '').toLowerCase();
    }
    const resultEl = document.getElementById('shareCardResult');
    if (resultEl) {
      resultEl.textContent = result.label;
      resultEl.className = 'share-card-val share-card-result' + (result.className ? ' ' + result.className : '');
    }

    window.__vg_share_data = { tf, dir, ptb, price, conf, timeStr, vol, result: result.label };

    modal.style.display = 'flex';

    // Twitter share
    const twitterBtn = document.getElementById('shareTwitterBtn');
    if (twitterBtn) {
      twitterBtn.onclick = async function() {
        const data = window.__vg_share_data || { tf, dir, ptb, price, conf, timeStr: timeStr, vol: (typeof vol !== 'undefined' ? vol : '--'), result: result.label };
        const shareText = buildShareText(data);

        let blob = null;
        try { blob = await renderShareCardPng(data); } catch(e) {}

        let copied = false;
        if (blob) {
          copied = await copyPngToClipboard(blob);
          if (!copied) {
            // Fallback: download in-browser (still avoids OS share sheet)
            downloadBlob(blob, `ponis-iq-${(data.tf || 'tf').toLowerCase()}-${Date.now()}.png`);
          }
        }

        window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText), '_blank');


        try {
          twitterBtn.innerHTML = (copied ?
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> X Opened — Text Filled' :
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> X Opened — Attach Image'
          );
          setTimeout(function() {
            twitterBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> Open X + Copy Image';
          }, 2500);
        } catch(e) {}
      };
    }

    // Copy text
    const copyBtn = document.getElementById('shareCopyBtn');
    if (copyBtn) {
      copyBtn.onclick = function() {
        const data = window.__vg_share_data || { tf, dir, ptb, price, conf, timeStr: timeStr, vol: (typeof vol !== 'undefined' ? vol : '--'), result: result.label };
        const shareText = buildShareText(data);
        navigator.clipboard.writeText(shareText).then(function() {
          copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
          setTimeout(function() {
            copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Text';
          }, 2000);
        });
      };
    }
  }

  function initShareBtn() {
    const btn   = document.getElementById('sharePredBtn');
    const modal = document.getElementById('shareModal');
    const close = document.getElementById('shareModalClose');
    if (btn)   btn.addEventListener('click', openShareModal);
    if (close) close.addEventListener('click', function() { if (modal) modal.style.display = 'none'; });
    if (modal) modal.addEventListener('click', function(e) { if (e.target === modal) modal.style.display = 'none'; });
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // BROWSER PUSH NOTIFICATIONS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  let notifEnabled = false;

  async function requestNotifPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }

  function sendPredictionNotif(dir, conf, tf) {
    if (!notifEnabled || Notification.permission !== 'granted') return;
    const icon  = dir === 'UP' ? '\u25B2' : dir === 'DOWN' ? '\u25BC' : '-';
    try {
      new Notification('Ponis IQ ' + tf + ' Prediction Locked', {
        body: icon + ' ' + dir + ' â€” Confidence: ' + conf + '\nBTC: ' + (state.btcPrice ? formatPrice(state.btcPrice) : '--'),
        icon: 'public/favicon.png',
        tag:  'ponis-iq-pred-' + tf,
        silent: false,
      });
    } catch(e) {}
  }

  function initNotifBtn() {
    const btn = document.getElementById('notifBtn');
    if (!btn) return;
    btn.addEventListener('click', async function() {
      if (!notifEnabled) {
        const granted = await requestNotifPermission();
        if (granted) {
          notifEnabled = true;
          btn.classList.add('active');
          document.getElementById('notifIconOn').style.display  = 'block';
          document.getElementById('notifIconOff').style.display = 'none';
          // Confirm notification
          new Notification('Ponis IQ Alerts Enabled', {
            body: 'You will be notified when predictions lock.',
            icon: 'public/favicon.png',
            tag:  'ponis-iq-notif-test',
          });
        } else {
          alert('Notification permission denied. Please enable it in your browser settings.');
        }
      } else {
        notifEnabled = false;
        btn.classList.remove('active');
        document.getElementById('notifIconOn').style.display  = 'none';
        document.getElementById('notifIconOff').style.display = 'block';
      }
    });
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // #18 FULLSCREEN
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // COMMUNITY CHAT
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  let chatOpen   = false;
  let chatLastTs = null;
  let chatUser   = null;
  let chatPollTimer = null;
  let chatUnreadCount = 0;

  function getChatUser() {
    if (chatUser) return chatUser;
    try {
      let u = localStorage.getItem('vg_chat_user');
      if (!u) {
        u = prompt('Enter your chat username:');
        if (!u || u.trim() === '') u = 'Anon' + Math.floor(Math.random() * 9999);
        u = u.trim().slice(0, 20);
        localStorage.setItem('vg_chat_user', u);
      }
      chatUser = u;
    } catch(e) { chatUser = 'Anon'; }
    return chatUser;
  }

  function formatChatTime(ts) {
    const d = new Date(ts);
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  }

  function appendChatMessage(msg, scroll) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const loading = container.querySelector('.chat-loading');
    if (loading) loading.remove();

    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML =
      '<div class="chat-msg-header">' +
        '<span class="chat-msg-user">' + msg.username.replace(/</g,'&lt;') + '</span>' +
        '<span class="chat-msg-time">' + formatChatTime(msg.created_at) + '</span>' +
      '</div>' +
      '<div class="chat-msg-text">' + msg.message.replace(/</g,'&lt;') + '</div>';
    container.appendChild(div);
    if (scroll) container.scrollTop = container.scrollHeight;
  }

  async function loadChatMessages() {
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/chat_messages?select=*&order=created_at.asc&limit=50',
        { headers: SB_HEADERS }
      );
      if (!res.ok) return;
      const data = await res.json();
      const container = document.getElementById('chatMessages');
      if (!container) return;
      container.innerHTML = '';
      if (!data || data.length === 0) {
        container.innerHTML = '<div class="chat-loading">No messages yet. Say hello!</div>';
        return;
      }
      data.forEach(m => appendChatMessage(m, false));
      container.scrollTop = container.scrollHeight;
      if (data.length > 0) chatLastTs = data[data.length-1].created_at;
    } catch(e) {}
  }

  async function pollNewChatMessages() {
    if (!chatLastTs) return;
    try {
      const url = SUPABASE_URL + '/rest/v1/chat_messages?select=*&order=created_at.asc&created_at=gt.' + encodeURIComponent(chatLastTs);
      const res = await fetch(url, { headers: SB_HEADERS });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || data.length === 0) return;
      data.forEach(m => {
        appendChatMessage(m, chatOpen);
        if (!chatOpen) {
          chatUnreadCount++;
          const badge = document.getElementById('chatUnread');
          if (badge) { badge.textContent = chatUnreadCount; badge.style.display = 'inline'; }
        }
      });
      chatLastTs = data[data.length-1].created_at;
    } catch(e) {}
  }

  async function sendChatMessage(msg) {
    if (!msg || msg.trim() === '') return;
    const user = getChatUser();
    const row  = { username: user, message: msg.trim().slice(0, 200) };
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/chat_messages', {
        method: 'POST',
        headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify(row),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.length > 0) {
        appendChatMessage(data[0], true);
        chatLastTs = data[0].created_at;
      }
    } catch(e) {}
  }

  function initChat() {
    const toggle = document.getElementById('chatToggle');
    const panel  = document.getElementById('chatPanel');
    const close  = document.getElementById('chatClose');
    const input  = document.getElementById('chatInput');
    const send   = document.getElementById('chatSend');
    if (!toggle || !panel) return;

    toggle.addEventListener('click', function() {
      chatOpen = !chatOpen;
      panel.style.display = chatOpen ? 'flex' : 'none';
      if (chatOpen) {
        chatUnreadCount = 0;
        const badge = document.getElementById('chatUnread');
        if (badge) badge.style.display = 'none';
        loadChatMessages();
        if (!chatPollTimer) chatPollTimer = setInterval(pollNewChatMessages, 5000);
      }
    });

    if (close) close.addEventListener('click', function() {
      chatOpen = false;
      panel.style.display = 'none';
    });

    if (send) send.addEventListener('click', async function() {
      const msg = input ? input.value.trim() : '';
      if (!msg) return;
      input.value = '';
      await sendChatMessage(msg);
    });

    if (input) input.addEventListener('keydown', async function(e) {
      if (e.key === 'Enter') {
        const msg = input.value.trim();
        if (!msg) return;
        input.value = '';
        await sendChatMessage(msg);
      }
    });
  }

})();


