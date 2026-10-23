// 埋伏分回溯验证 v2：对每只近期涨停股，统计启动前 1~8 天"埋伏分最高值"（真正的埋伏窗口）
const A = require('../lib/analyzer');
(async () => {
  const snap = await A.getMarketSnapshot(true);
  const up = snap.stocks.filter(q => (q.changePct || 0) >= 9.3).slice(0, 35);
  let total = 0, ge70 = 0, ge60 = 0, ge55 = 0, low50 = 0;
  const rows = [];
  for (const q of up) {
    try {
      const secid = A.resolveSecid(q.code);
      const kl = await A.getKline(secid, 50);
      if (!kl || kl.length < 35) continue;
      const lastIdx = kl.length - 1;
      let best = 0, bestDay = 0;
      for (let k = 1; k <= 8; k++) {                 // 涨停前第 k 天
        const sub = kl.slice(0, lastIdx - k + 1);
        if (sub.length < 25) break;
        const r = A.computeLaunchReadinessKL(sub);
        if (r.score > best) { best = r.score; bestDay = k; }
      }
      total++;
      if (best >= 70) ge70++; if (best >= 60) ge60++; if (best >= 55) ge55++; if (best < 50) low50++;
      rows.push(`${q.name}(${q.code}) 启动前最高埋伏分=${best}(第${bestDay}天前) 涨停前1天=${A.computeLaunchReadinessKL(kl.slice(0,lastIdx)).score}`);
    } catch (e) {}
  }
  console.log(`【真实回溯·埋伏窗口】采样涨停股=${total} 只`);
  console.log(`启动前8天内埋伏分峰值 ≥70: ${ge70}只(${Math.round(ge70/total*100)}%) · ≥60: ${ge60}只(${Math.round(ge60/total*100)}%) · ≥55: ${ge55}只(${Math.round(ge55/total*100)}%) · <50: ${low50}只(${Math.round(low50/total*100)}%)`);
  console.log(rows.sort((a,b)=>{const ma=a.match(/峰值=(\d+)/),mb=b.match(/峰值=(\d+)/);return (mb?+mb[1]:0)-(ma?+ma[1]:0);}).join('\n'));
})().catch(e => { console.error('ERR', e); process.exit(1); });
