(function () {
  'use strict';

  var bootstrap = window.VANGUARD_AGENT_BOOTSTRAP || (window.VANGUARD_AGENT_BOOTSTRAP = {});
  var timeframes = bootstrap.timeframes || (bootstrap.timeframes = {});

  bootstrap.defaultTF = bootstrap.defaultTF || '5m';

  if (!timeframes['5m']) {
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
      initialRecord: { wins: 3266, losses: 404 },
    };
  }

  if (!timeframes['15m']) {
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
      initialRecord: { wins: 3009, losses: 531 },
    };
  }

  if (!timeframes['1h']) {
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
      initialRecord: { wins: 1857, losses: 493 },
    };
  }

  if (!window.VANGUARD_AGENT_CORE_LOADED) {
    var script = document.createElement('script');
    script.src = 'js/agent-core.js';
    document.head.appendChild(script);
  }
})();
