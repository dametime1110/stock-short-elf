// 真实数据验证：analyze 返回 accumulation / dailyScores / score
const { analyze } = require('../lib/analyzer');
(async () => {
  const codes = process.argv.slice(2).length ? process.argv.slice(2) : ['600519', '000001', '300750'];
  for (const code of codes) {
    try {
      const t0 = Date.now();
      const j = await analyze(code);
      const a = j.accumulation || {};
      const dims = j.scoreDims || {};
      console.log(`\n===== ${j.name}(${code}) ${(Date.now() - t0)}ms =====`);
      console.log(`现价 ${j.snapshot.price} 涨跌 ${j.snapshot.changePct}% | 综合评分 ${j.score}(${j.grade}) | 吸筹维度 ${dims.acc ?? '-'}`);
      console.log(`吸筹：phase=${a.phase} accScore=${a.accScore} pos=${a.pos}`);
      console.log(`特征：${(a.signals || []).map(s => `${s.hit ? '✓' : '✗'}${s.t}`).join(' ')}`);
      console.log(`5日球：${(j.dailyScores || []).map(d => `${d.date?.slice(4)}:${d.score}`).join(' ')}`);
      console.log(`策略摘录：${(j.heuristic?.strategy || '').slice(0, 120).replace(/\n/g, ' / ')}`);
    } catch (e) {
      console.log(`${code} 失败: ${e.message}`);
    }
  }
})();
