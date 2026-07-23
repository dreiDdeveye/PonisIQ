# VANGUARD WALLET SYSTEM SPECIFICATION

## Executive Overview
The VANGUARD WALLET is a **read-only execution layer** that automatically trades BTC based on locked signals from the VANGUARD AGENT. It implements strict agent-decision-maker architecture where:
- **AGENT = Decision Maker**: Generates UP/DOWN predictions
- **WALLET = Execution Layer**: Only executes trades on locked signals
- **NO Manual Controls**: Zero user trading buttons or overrides

---

## Core Behavior Architecture

### Signal Flow
```
┌──────────────────────────────────────────────────────────┐
│  VANGUARD AGENT (bot15m.mjs, bot1h.mjs, etc.)          │
│  • analyzes BTC price direction                          │
│  • generates UP/DOWN prediction                          │
│  • publishes to live_prediction table with window_start  │
│  • signal = direction + current_window = LOCKED          │
└────────────┬─────────────────────────────────────────────┘
             │ (Poll every 3 seconds)
             ▼
┌──────────────────────────────────────────────────────────┐
│  VANGUARD WALLET (vanguard-wallet.js)                   │
│  • fetches live_prediction                              │
│  • validates: direction is UP/DOWN + window_start match  │
│  • if locked: execute trade immediately                 │
│  • if NOT locked: wait (no trade)                        │
└──────────────────────────────────────────────────────────┘
             │ (Trade for 15 seconds)
             ▼
┌──────────────────────────────────────────────────────────┐
│  TRADE EXECUTION                                         │
│  1. Open: Record entry price at signal lock time        │
│  2. Hold: Monitor BTC price for TRADE_DURATION (15s)    │
│  3. Close: Record exit price, calculate WIN/LOSS        │
│  4. Record: Save to trade history + update PNL          │
└──────────────────────────────────────────────────────────┘
```

---

## Execution Rules (✅ ENFORCED)

### Rule 1: Signal Must Be Locked
```javascript
// ONLY trade when:
liveVote.locked === true

// This means:
- direction is 'UP' or 'DOWN' (not 'pending')
- window_start matches current market window
- prediction data is valid/non-null
```

### Rule 2: One Trade Per Window
```javascript
// Once traded in a window, NO MORE TRADES until new window
if (hasTradedInWindow) {
  // Block trade execution
  // Wait for new window to reset flag
}
```

### Rule 3: No Stale Signals
```javascript
// Reject signals from previous windows
if (predWindow !== currentWindow) {
  // Mark as "stale"
  // Do NOT trade
}
```

### Rule 4: Price Must Be Available
```javascript
// Never trade without current BTC price
if (!Number.isFinite(currentPrice)) {
  // Wait for price data
}
```

---

## Trade Lifecycle (15-Second Cycle)

### Phase 1: Signal Reception (Polling)
- **When**: Every 3 seconds (`setInterval(fetchLiveVote, 3000)`)
- **What**: Query `live_prediction` table for active timeframe
- **Check**: Is direction UP/DOWN? Is window current?
- **Log**: Signal lock transitions to console

### Phase 2: Lock Validation
```javascript
isVoteLockedForCurrentWindow(pred) {
  // ✅ Valid: {direction: 'up', window_start: 1234567890}
  // ❌ Invalid: {direction: 'pending', window_start: 1234567890}
  // ❌ Invalid: {direction: 'up', window_start: 1234566890} // old window
  // ❌ Invalid: null / undefined
  
  return (
    pred exists &&
    direction is 'up' or 'down' &&
    window_start === current_window
  );
}
```

### Phase 3: Trade Execution
```
Signal Locked
    ↓
startLockedTrade(direction)
    ↓
openTrade = {
  direction: 'up' or 'down',
  entryPrice: 45231.50,  // Binance WebSocket price
  startTime: 1700000000000,
  durationMs: 15000
}
    ↓
Schedule closeOpenTrade() in 15 seconds
```

### Phase 4: Trade Settlement
```
After 15 seconds (or when price stales):
  
closeOpenTrade()
    ↓
Compare:
  - entryPrice:  45231.50
  - exitPrice:   45245.80
    ↓
Determine WIN/LOSS:
  - If UP:   exitPrice > entryPrice = WIN (+$0.80 = +80% × $1)
  - If DOWN: exitPrice < entryPrice = WIN
    ↓
Update Wallet:
  - realizedPnl += $0.80
  - balance = $50.00 + $0.80 = $50.80
  - Record trade to history
  - hasTradedInWindow = true
  - Wait for next window
```

---

## UI Behavior (Read-Only)

### Display Elements
✅ **Current Price** (real-time from Binance WebSocket)
✅ **Wallet Balance** ($50 fixed base + cumulative PNL)
✅ **Active Positions** (UP/DOWN position tracking)
✅ **Trade History** (last 24 trades with W/L)
✅ **Last Trade Details** (entry/exit/result)
✅ **Timeframe Toggle** (5M, 15M, 1H - view switching)
✅ **Reset Wallet Button** (admin: clear history)

### Forbidden Elements
❌ **NO BUY Button** (agent makes buy decision)
❌ **NO SELL Button** (agent makes sell decision)
❌ **NO Manual Position Entry** (automatic only)
❌ **NO Risk Adjustment** (fixed $1 per trade)
❌ **NO Signal Override** (wallet never ignores locked signal)

---

## Configuration Constants

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `STARTING_BALANCE` | $50.00 | Fixed wallet capital |
| `FIXED_RISK` | $1.00 | Risk per trade |
| `WIN_MULTIPLIER` | 0.80 | Win payout (80% of risk) |
| `LOSS_MULTIPLIER` | 1.00 | Loss (100% of risk) |
| `TRADE_DURATION_MS` | 15000 | How long each trade stays open |
| `MAX_HISTORY` | 24 | Max trades displayed |
| `POLL_INTERVAL` | 3000 | Signal fetch frequency (ms) |

---

## System Constraints

### Price Source
- **Primary**: Binance WebSocket (real-time)
- **Fallback**: Binance REST API (every 12 seconds)
- **Requirement**: Never execute trade without valid price

### Window Tracking
- **5M**: 300-second windows
- **15M**: 900-second windows  
- **1H**: 3600-second windows
- Each represents one market cycle

### Trade Safety
- Only one active trade per window
- Trade automatically closes after 15 seconds
- New window resets `hasTradedInWindow` flag
- Stale signals are rejected

### Data Validation
- All numbers normalized (non-finite = fallback)
- Directions normalized ('over'→'up', 'under'→'down')
- Positions validated (min 0)
- History items capped at MAX_HISTORY

---

## Logging & Diagnostics

### Console Logs (Automatic)
```javascript
[VANGUARD WALLET] Initialized
[VANGUARD WALLET] Listening for locked signals from VANGUARD AGENT
[VANGUARD WALLET] SIGNAL LOCKED → TRADE EXECUTED
[VANGUARD WALLET] TRADE SETTLED
[VANGUARD WALLET] New window detected
[VANGUARD WALLET] Signal fetch error
```

### Signal States
1. **WAITING**: Signal pending (direction not yet determined)
2. **WAITING (stale)**: Old window prediction (will be ignored)
3. **LOCKED**: Ready to trade (direction UP/DOWN + current window)

### Trade States
1. **OPEN**: Trade active (waiting 15 seconds)
2. **WIN**: Exit price favorable (in console + UI)
3. **LOSS**: Exit price unfavorable (in console + UI)

---

## Compliance Checklist

- [x] **Agent decides, wallet executes** - No override capability
- [x] **Locked signals only** - Validates direction + window
- [x] **No manual trading** - Zero BUY/SELL buttons
- [x] **Fixed capital** - Always $50.00 base
- [x] **Automatic execution** - No user intervention needed
- [x] **Trade history** - Last 24 recorded
- [x] **Real-time pricing** - Binance WebSocket + REST fallback
- [x] **PNL tracking** - Realized + unrealized
- [x] **Single trade/window** - Prevents double-dipping
- [x] **Window validation** - Rejects stale signals
- [x] **Clear status** - User always knows wallet state

---

## Deployment Notes

### For Production
1. Ensure bot.mjs is running and publishing signals
2. Confirm Supabase connectivity
3. Verify Binance API keys (public, no auth needed)
4. Check browser console for initialization logs
5. Monitor trade execution in console for 2-3 trades

### Testing
1. Check browser console for `[VANGUARD WALLET]` logs
2. Verify signal lock transitions appear
3. Monitor trade open/close cycle (15 seconds)
4. Confirm PNL updates after each trade
5. Test timeframe switching (5M/15M/1H)

### Troubleshooting
| Issue | Check |
|-------|-------|
| No trades executing | Is bot running? Check live_prediction table |
| Signal says "pending" | Bot hasn't generated prediction yet |
| Trade never closes | Check browser console for price errors |
| Stale signal warning | Window has passed, wait for next window |
| PNL not updating | Check math: win/loss = (exit - entry direction) |

---

## Files Modified

- **vanguard-wallet.js**: Signal validation, logging, trade execution
  - Enhanced `isVoteLockedForCurrentWindow()` 
  - Added signal lock transition logging
  - Added trading conditions logging
  - Improved status messages

- **paper-trader.html**: No changes (UI already compliant)

- **bot15m.mjs**: No changes (already publishing correctly)

---

**Version**: 1.0 (Production Ready)  
**Updated**: 2026-04-15  
**Author**: Vanguard Engineering  
