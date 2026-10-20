// 主力吸筹识别模型 · 合成K线测试（2026-10-20）
const { computeAccumulation, computeAccumulationKL, computeDailyScoreAt, computeDeepScore } = require('../lib/analyzer');

// 生成K线工具：base=基准价, days=天数, fn(i, prevClose) -> {o,h,l,c,v}
function genKL(days, fn, startDate = '20260801') {
  const kl = [];
  let prev = 10;
  for (let i = 0; i < days; i++) {
    const r = fn(i, prev, kl);
    kl.push({ date: `2026${String(8 + Math.floor(i / 30)).padStart(2, '0')}${String((i % 30) + 1).padStart(2, '0')}`, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v });
    prev = r.c;
  }
  return kl;
}
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ============ A. 教科书式吸筹：低位横盘30天 + 量能阶梯 + 小阳/下影 ============
// 前60天从12元跌到10元（制造低位），后30天10元附近横盘，量从10000手指数级放到24000手左右
const klA = genKL(90, (i, prev) => {
  if (i < 60) { const c = 12 - (12 - 10) * (i / 60); return { o: prev, h: Math.max(prev, c) * 1.005, l: Math.min(prev, c) * 0.995, c, v: 10000 }; }
  const c = 10 + Math.sin(i / 3) * 0.12 + (i - 60) * 0.005;             // 横盘微升
  const v = Math.round(10000 * Math.pow(1.035, i - 60));                // 指数级温和放量
  const o = c - 0.03;
  return { o, h: Math.max(o, c) + 0.05, l: Math.min(o, c) - 0.08, c, v }; // 带下影
});
const accA = computeAccumulationKL(klA);
console.log('A. 教科书式吸筹（低位横盘+阶梯放量+下影小阳）');
check('phase=accumulating', accA.phase === 'accumulating', `实际=${accA.phase}`);
check('accScore>=70', accA.accScore >= 70, `实际=${accA.accScore}`);
check('低位命中', accA.signals.find(s => s.t === '低位').hit, `pos=${accA.pos}`);

// ============ B. 低位横盘但缩量：无量不涨不跌 ============
const klB = genKL(90, (i, prev) => {
  if (i < 60) { const c = 12 - (12 - 10) * (i / 60); return { o: prev, h: Math.max(prev, c) * 1.004, l: Math.min(prev, c) * 0.996, c, v: 10000 }; }
  const c = 10 + Math.sin(i / 4) * 0.05;
  const v = 10000 - (i - 60) * 100;                                      // 缩量
  return { o: c, h: c + 0.03, l: c - 0.03, c, v };
});
const accB = computeAccumulationKL(klB);
console.log('B. 低位横盘但持续缩量（无人问津）');
check('phase!=accumulating', accB.phase !== 'accumulating', `实际=${accB.phase} score=${accB.accScore}`);
check('accScore明显低于A', accB.accScore < accA.accScore - 15, `B=${accB.accScore} vs A=${accA.accScore}`);

// ============ C. 已经三连板启动：模型不应再叫"吸筹中" ============
const klC = genKL(70, (i, prev) => {
  if (i < 60) { const c = 10 + Math.sin(i / 4) * 0.06; return { o: c, h: c + 0.05, l: c - 0.05, c, v: 10000 }; }
  const c = i === 60 ? 10.5 : i === 61 ? 11.5 : i >= 62 ? prev * 1.1 : prev;   // 启动三连板
  return { o: prev, h: Math.max(prev, c) * 1.01, l: Math.min(prev, c) * 0.99, c, v: 40000 };
});
const accC = computeAccumulationKL(klC);
console.log('C. 已三连板启动（追高风险，不是潜伏）');
check('phase=launched', accC.phase === 'launched', `实际=${accC.phase} score=${accC.accScore}`);

// ============ D. 高位放量滞涨：派发风险 ============
const klD = genKL(90, (i, prev) => {
  const c = 10 + i * 0.06;                                                // 单边上行到高位
  const v = i > 75 ? 30000 : 10000;                                       // 高位突然爆量
  return { o: c, h: c + 0.06, l: c - 0.02, c, v };
});
const accD = computeAccumulationKL(klD);
console.log('D. 高位放量滞涨（派发风险）');
check('phase=topping', accD.phase === 'topping', `实际=${accD.phase} score=${accD.accScore} pos=${accD.pos}`);

// ============ E. 震荡下行随机走势：不应误报 ============
const klE = genKL(90, (i, prev) => {
  const c = prev * (1 + (Math.sin(i * 12.9898) * 0.01));
  return { o: prev, h: Math.max(prev, c) * 1.008, l: Math.min(prev, c) * 0.992, c, v: 10000 + Math.abs(Math.sin(i * 5)) * 3000 };
});
const accE = computeAccumulationKL(klE);
console.log('E. 随机震荡（不应误报吸筹）');
check('phase不在accumulating', accE.phase !== 'accumulating', `实际=${accE.phase} score=${accE.accScore}`);

// ============ F. 吸筹→启动连续过程：历史日复算应反映分数爬坡 ============
// 前55天吸筹（横盘微升+温和放量），后5天启动大涨
const klF = genKL(60, (i, prev) => {
  if (i < 55) { const c = 10 + Math.sin(i / 3) * 0.1 + i * 0.004; const v = 10000 + i * 150; return { o: c - 0.02, h: c + 0.05, l: c - 0.08, c, v }; }
  const c = prev * (i < 58 ? 1.03 : 1.095);
  return { o: prev, h: c * 1.005, l: prev * 0.995, c, v: 35000 };
});
const dailyF = [];
for (let i = 50; i < 60; i++) dailyF.push(computeDailyScoreAt(klF, i));
console.log('F. 吸筹→启动的每日评分爬坡（第55天前潜伏，第56-59天启动）');
check('潜伏期(54)评分 < 启动期(59)评分', dailyF[4].score < dailyF[9].score, `d54=${dailyF[4].score} d59=${dailyF[9].score}`);
check('启动期评分>=75', dailyF[9].score >= 75, `d59=${dailyF[9].score}`);
check('潜伏期评分>=45(不再是低分)', dailyF[4].score >= 45, `d54=${dailyF[4].score}`);

// ============ G. 吸筹期深度评分加成：把"洗盘个位数分"拉回关注区 ============
const accG = { accScore: 78, phase: 'accumulating', signals: [] };
const deepQuiet = computeDeepScore({
  snapshot: { price: 10, prevClose: 10, changePct: -1.5, pe: 15, pb: 1.5 },
  cyq: { profitRatio: 25, avgCost: 10.2 },
  flow: { mainNetInflow: null, mainNetInflow5d: null, trend: [] },
  tech: { signal: '死叉', zeroAxis: '零轴下' },
  rsi: 28,
  klines: klA,
  acc: accG
});
const deepNoAcc = computeDeepScore({
  snapshot: { price: 10, prevClose: 10, changePct: -1.5, pe: 15, pb: 1.5 },
  cyq: { profitRatio: 25, avgCost: 10.2 },
  flow: { mainNetInflow: null, mainNetInflow5d: null, trend: [] },
  tech: { signal: '死叉', zeroAxis: '零轴下' },
  rsi: 28,
  klines: klA,
  acc: null
});
console.log('G. 深度评分吸筹加成（同一只洗盘股，有/无吸筹识别对比）');
check('有吸筹识别分数更高', deepQuiet.score > deepNoAcc.score, `无=${deepNoAcc.score} 有=${deepQuiet.score}`);
check('吸筹维度+8以上', deepQuiet.dims.acc >= 8, `实际=${deepQuiet.dims.acc}`);
check('有吸筹识别后脱离弱势区(<45拉回)', deepQuiet.score >= 45, `实际=${deepQuiet.score}`);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
