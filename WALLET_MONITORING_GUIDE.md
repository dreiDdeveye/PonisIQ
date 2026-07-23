# VANGUARD WALLET - Developer Monitoring Guide

## Real-Time Console Monitoring

### Opening Browser Console
1. Open [paper-trader.html](paper-trader.html) in Chrome/Firefox
2. Press `F12` or `Ctrl+Shift+I` (Windows) / `Cmd+Shift+I` (Mac)
3. Go to **Console** tab
4. You should see `[VANGUARD WALLET]` logs streaming

---

## Signal Lock Lifecycle (Example)

### 1️⃣ Wallet Starts Up
```
[VANGUARD WALLET] Initialized {
  capital: 50,
  riskPerTrade: 1,
  tradeDuration: 15000,
  mode: "Automatic - Locked Signal Execution"
}
[VANGUARD WALLET] Listening for locked signals from VANGUARD AGENT...
```

### 2️⃣ Polling for Signal (Every 3 Seconds)
```
⏳ User sees: "15M signal pending. Waiting for agent to generate prediction..."
```

### 3️⃣ Agent Publishes Signal
```
⏳ User sees: "15M signal active (UP) but not locked yet..."
```

### 4️⃣ Signal Becomes Locked (Direction + Window Match)
```
[VANGUARD WALLET] SIGNAL LOCKED {
  timeframe: "15m",
  direction: "up",
  window: 1700000000,
  timestamp: "2026-04-15T14:30:45.123Z"
}
```

### 5️⃣ Trade Executes Immediately
```
[VANGUARD WALLET] Trading conditions met - executing locked trade

[VANGUARD WALLET] SIGNAL LOCKED → TRADE EXECUTED {
  timeframe: "15m",
  direction: "up",
  entryPrice: 45231.5,
  lockTime: "2026-04-15T14:30:46.012Z"
}

✓ User UI shows: "✓ LOCKED SIGNAL: UP trade opened at $45,231.50"
```

### 6️⃣ Trade Held for 15 Seconds
```
(No logs - trade is open)
(Price updates flowing in from WebSocket)
```

### 7️⃣ Trade Settlement
```
[VANGUARD WALLET] TRADE SETTLED {
  direction: "up",
  entry: 45231.5,
  exit: 45245.8,
  delta: "14.30",
  result: "WIN",
  pnl: 0.8,
  balance: 50.8
}

✓ User sees: "✓ Trade WIN: UP @ $45,231.50 → $45,245.80 (+$0.80)"
```

### 8️⃣ New Window - Ready for Next Signal
```
[VANGUARD WALLET] New window detected {
  window: 1700000900,
  timeframe: "15m"
}

⏳ User sees: "15M signal pending. Waiting for agent to generate prediction..."
```

---

## Debugging Guide

### Issue: No Trades Ever Execute

**Check 1: Is bot running?**
```bash
# Check if bot15m.mjs is running
ps aux | grep node

# Should see: node bot15m.mjs
```

**Check 2: Console logs show what?**
```javascript
// If console shows:
"⏳ 15M signal pending..."

// → Agent hasn't published signal yet
// Solution: Start bot or wait for next window

// If console shows:
"[VANGUARD WALLET] Signal fetch error: (error message)"

// → Supabase connection failed
// Solution: Check API keys, internet connection
```

**Check 3: Is Supabase accessible?**
```javascript
// In console, paste:
fetch('https://zrvbmzjsivxlcodsdvrb.supabase.co/rest/v1/live_prediction?id=eq.2&select=*', {
  headers: {
    'apikey': 'eyJhbGc...',
    'Authorization': 'Bearer eyJhbGc...'
  }
}).then(r => r.json()).then(d => console.log(d))
```

---

### Issue: Signal Shows "Waiting" But Not "Locked"

**Possible Causes:**

1. **Agent signal is pending**: Direction hasn't been determined yet
   - Wait for agent analysis to complete
   - Check agent logs for prediction output

2. **Window mismatch**: Signal is from old window
   - Wallet marks as "stale"
   - Wait for current window signal

3. **Missing window_start field**: Supabase row incomplete
   - Check bot.mjs publishLivePrediction() function
   - Ensure `window_start` is being published

**Verification:**
```javascript
// In console, check live_prediction table directly:
fetch('https://zrvbmzjsivxlcodsdvrb.supabase.co/rest/v1/live_prediction?id=eq.2&select=*', {...})
  .then(r => r.json())
  .then(d => {
    console.log('Current signal:', d[0]);
    console.log('Direction:', d[0].direction);
    console.log('Window:', new Date(d[0].window_start * 1000));
  })
```

Expected output:
```javascript
Current signal: {
  id: 2,
  direction: "up",              // ✅ Should be "up" or "down"
  window_start: 1700000900,    // ✅ Should be current 15m window
  updated_at: "2026-04-15T14:30:45.123Z",
  ptb: 45230.5,
  // ... other fields
}
```

---

### Issue: Trade Executes But Doesn't Close

**Possible Causes:**

1. **Price unavailable**: Price feed disconnected
   - Check if WebSocket shows "Feed error"
   - Should see REST fallback kick in

2. **Timer not scheduled**: closeOpenTrade() not scheduled
   - Check for JavaScript errors in console
   - Reload wallet page

3. **Open trade stuck**: Trade object not cleared
   - Check console: `openTrade` should be null after settlement
   - Type in console: `console.log(JSON.stringify(openTrade, null, 2))`

**Recovery:**
```javascript
// In console, manually trigger close:
// Navigate to paper-trader.html console and:
// (This is dev only - normally automatic)

// Check current trade state:
console.log('Open trade:', openTrade);
console.log('Current price:', state.currentPrice);
```

---

### Issue: PNL Calculation Looks Wrong

**Verify Math:**
```javascript
// Example:
// Entry: $45,231.50 (UP trade)
// Exit: $45,245.80
// Expected PNL: 
//   - Direction is UP
//   - Price went UP ($45,245.80 > $45,231.50) ✅ WIN
//   - Gain = +$14.30
//   - Payout (80% of $1) = +$0.80
//   - Balance = $50.00 + $0.80 = $50.80

// If you see:
// Entry: $45,231.50 (DOWN trade)
// Exit: $45,245.80
// PNL should be LOSS (price went UP but we predicted DOWN)
```

**Debug in Console:**
```javascript
// Check last trade:
console.log('Last trade:', state.lastTrade);

// Check wallet balance calculation:
console.log('Base balance:', 50);
console.log('Realized PNL:', state.realizedPnl);
console.log('Current balance:', 50 + state.realizedPnl);

// Check history:
console.log('Trade history:', state.history.map(h => ({
  direction: h.direction,
  entry: h.price,
  exit: h.exitPrice,
  result: h.result
})));
```

---

## Performance Metrics

### Expected Frequency
| Operation | Interval | Purpose |
|-----------|----------|---------|
| Fetch signal | 3s | Check for new locked signal |
| Fetch price (REST) | 12s | Fallback price data |
| Check auto-trade | 1s | React to signal lock instantly |
| WebSocket (real-time) | Every tick | Live price updates |

### Response Times
- **Signal -> Trade Execution**: <100ms (instant)
- **Trade Open -> Close**: 15 seconds (fixed)
- **PNL Update**: <50ms (instant)

### Success Indicators
```javascript
// Open console and verify every 15 seconds:
✅ New trade entry appears in history
✅ Balance updates with PNL
✅ "TRADE SETTLED" log appears
✅ Status shows WIN or LOSS
✅ New window detected after 15m/900-900s boundary
```

---

## Network Diagnostics

### Check Supabase Connection
```javascript
fetch('https://zrvbmzjsivxlcodsdvrb.supabase.co/rest/v1/live_prediction?id=in.(1,2,3)&select=id,direction', {
  headers: {
    'apikey': 'eyJhbGc...',
    'Authorization': 'Bearer eyJhbGc...',
    'Content-Type': 'application/json'
  }
})
.then(r => {
  console.log('Status:', r.status);
  return r.json();
})
.then(d => console.log('All signals:', d))
.catch(e => console.error('Failed:', e.message))
```

### Check Binance Price Feed
```javascript
// WebSocket status (should show "Live WebSocket"):
console.log('Feed mode:', state.feedMode);

// Latest price:
console.log('Current price:', state.currentPrice);
console.log('Last update:', new Date(state.lastPriceAt));

// Test REST API:
fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
  .then(r => r.json())
  .then(d => console.log('BTC Price:', d.price))
```

---

## Signal State Diagram

```
                    ┌─────────────────────┐
                    │   AGENT ANALYZING   │
                    │  (generating pred)  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ SIGNAL: PENDING     │
                    │ (direction = '')    │ ◄─── Not locked
                    └──────────┬──────────┘     (NO TRADE YET)
                               │
                    ┌──────────▼──────────┐
                    │ SIGNAL: UP/DOWN     │
                    │ (direction set)     │ ◄─── Still not locked
                    │ (wait for window)   │     (NO TRADE YET)
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
    ┌─────────────►│ SIGNAL: LOCKED      │ ◄─── LOCKED!
    │              │ (UP/DOWN + window)  │     (TRADE NOW!)
    │              └──────────┬──────────┘
    │                         │
    │              ┌──────────▼──────────┐
    │              │ TRADE EXECUTING     │
    │              │ (15 seconds)        │
    │              └──────────┬──────────┘
    │                         │
    │              ┌──────────▼──────────┐
    │              │ TRADE SETTLED       │
    │              │ (WIN or LOSS)       │
    │              └──────────┬──────────┘
    │                         │
    │              ┌──────────▼──────────┐
    │              │ NEW WINDOW          │
    │              │ (reset flag)        │
    │              └──────────┬──────────┘
    │                         │
    └─────────────────────────┘
          (wait for new signal)
```

---

## Common Log Patterns

### ✅ Healthy System (5-Minute Snapshot)
```
[VANGUARD WALLET] Initialized ...
[VANGUARD WALLET] Listening for locked signals...
⏳ 15M signal pending...
⏳ 15M signal pending...
[VANGUARD WALLET] SIGNAL LOCKED { direction: "up", ... }
[VANGUARD WALLET] Trading conditions met - executing locked trade
[VANGUARD WALLET] SIGNAL LOCKED → TRADE EXECUTED { ... }
✓ LOCKED SIGNAL: UP trade opened at $45,231.50
(15 second hold)
[VANGUARD WALLET] TRADE SETTLED { result: "WIN", pnl: 0.8, ... }
✓ Trade WIN: UP @ $45,231.50 → $45,245.80 (+$0.80)
[VANGUARD WALLET] New window detected { window: 1700000900 }
⏳ 15M signal pending...
```

### ⚠️ Warning: Stale Signal
```
[VANGUARD WALLET] SIGNAL LOCKED { direction: "up", window: 1700000000 }
⚠ Last signal is stale (window: 14:30:00). Waiting for current window.
[VANGUARD WALLET] Trade already open for this window
```

### ❌ Error: No Supabase Connection
```
[VANGUARD WALLET] Signal fetch error: Network request failed
✗ Cannot fetch signal. Retrying...
(pause 3 seconds)
[VANGUARD WALLET] Signal fetch error: ...
```

---

## Quick Verification Checklist

Run this every morning before trading:

```javascript
// 1. Check Wallet Initialized
console.log('Balance:', state.walletBalance);  // Should = $50 + PNL

// 2. Check Price Feed
console.log('Price:', state.currentPrice);     // Should be live BTC price

// 3. Check Signal Access
fetch('https://zrvbmzjsivxlcodsdvrb.supabase.co/rest/v1/live_prediction?id=eq.2&select=direction,window_start', {
  headers: { 'apikey': '...', 'Authorization': 'Bearer ...' }
}).then(r => r.json()).then(d => console.log('Live signal:', d[0]));

// 4. Check Trade History
console.log('Trades:', state.history.length);  // Should see recent trades

// 5. Expected: All 4 checks pass ✅
```

---

**Last Updated**: 2026-04-15  
**Status**: Production Ready
