(function () {
  'use strict';

  var bootstrap = window.VANGUARD_AGENT_BOOTSTRAP || (window.VANGUARD_AGENT_BOOTSTRAP = {});
  var timeframes = bootstrap.timeframes || (bootstrap.timeframes = {});

  bootstrap.defaultTF = bootstrap.defaultTF || '5m';
  timeframes['5m'] = {
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
  };
})();
