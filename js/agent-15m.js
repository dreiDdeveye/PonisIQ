(function () {
  'use strict';

  var bootstrap = window.VANGUARD_AGENT_BOOTSTRAP || (window.VANGUARD_AGENT_BOOTSTRAP = {});
  var timeframes = bootstrap.timeframes || (bootstrap.timeframes = {});

  timeframes['15m'] = {
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
  };
})();
