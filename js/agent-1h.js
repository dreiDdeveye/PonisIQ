(function () {
  'use strict';

  var bootstrap = window.VANGUARD_AGENT_BOOTSTRAP || (window.VANGUARD_AGENT_BOOTSTRAP = {});
  var timeframes = bootstrap.timeframes || (bootstrap.timeframes = {});

  timeframes['1h'] = {
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
  };
})();
