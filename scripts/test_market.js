const { getLiveQuotes, getMarketView } = require('../lib/analyzer');
(async () => {
  // 1) 批量实时报价
  const codes = ['600519', '000858', '300750', '002594', '601318'];
  const { source, map } = await getLiveQuotes(codes);
  console.log('报价源:', source);
  codes.forEach(c => {
    const q = map[c];
    if (q) console.log(`  ${c} ${q.name} 价${q.price} 涨跌幅${q.changePct}% 振幅${q.amp}% 时间${q.time ? new Date(q.time).toLocaleString() : 'NA'}`);
    else console.log(`  ${c} 未取到`);
  });

  // 2) 全市场快照（首次会拉全部 ~5198 只）
  console.log('\n构建全市场快照...');
  const t0 = Date.now();
  const up = await getMarketView('up', 5);
  console.log(`快照耗时 ${Date.now() - t0}ms，覆盖 ${up.count}/${up.total} 只，源=${up.source}`);
  console.log('市场广度:', JSON.stringify(up.breadth));
  console.log('涨幅前5:', up.stocks.map(s => `${s.code}${s.name}+${s.changePct}%`).join(' | '));
  const down = await getMarketView('down', 3);
  console.log('跌幅前3:', down.stocks.map(s => `${s.code}${s.name}${s.changePct}%`).join(' | '));
})().catch(e => console.error('ERR', e.message));
