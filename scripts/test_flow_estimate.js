/* 分时量价推算资金净额 单测 */
const { estimateFlowFromIntraday } = require('../lib/analyzer');

// 生成分钟序列：priceFn/volFn 以 i=0..N-1 为输入，prevClose 为基准
function gen(priceFn, volFn, prevClose, amtRatio = 1) {
  const points = [];
  for (let i = 0; i < 240; i++) {
    const hh = 9 + Math.floor((i + 30) / 60), mm = (i + 30) % 60;
    const t = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    const p = priceFn(i), v = volFn(i);
    points.push({ t, p, v, amt: p * v * 100 * amtRatio });
  }
  return { date: '2026-10-20', prevClose, source: 'test', points };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}

const base = 10;

// 1) 全天单边上涨（每分钟都涨）→ 强净流入，buyRatio≈100%
{
  const s = gen(i => base * (1 + 0.0004 * i), () => 100, base);
  const r = estimateFlowFromIntraday(s);
  check('单边上涨→明显流入', r && r.level === 'strong_in' && r.buyRatio > 98,
    `estPct=${r && r.estPct} buyRatio=${r && r.buyRatio} label=${r && r.levelLabel}`);
}

// 2) 全天单边下跌 → 强净流出
{
  const s = gen(i => base * (1 - 0.0004 * i), () => 100, base);
  const r = estimateFlowFromIntraday(s);
  check('单边下跌→明显流出', r && r.level === 'strong_out' && r.estPct < 0,
    `estPct=${r && r.estPct} label=${r && r.levelLabel}`);
}

// 3) 上下震荡对称 → 均衡
{
  const s = gen(i => base * (1 + 0.002 * Math.sin(i / 3)), () => 100, base);
  const r = estimateFlowFromIntraday(s);
  check('对称震荡→均衡', r && r.level === 'balanced' && Math.abs(r.estPct) < 12,
    `estPct=${r && r.estPct}`);
}

// 4) 涨时放量、跌时缩量（典型吸筹/流入）：偶数分钟涨+0.1%配300手，奇数分钟跌-0.08%配80手
{
  const pts = [];
  let p = base;
  for (let i = 0; i < 240; i++) {
    const up = i % 2 === 0;
    p = p * (up ? 1.001 : 0.9992);
    const v = up ? 300 : 80;
    pts.push({ t: '10:00', p, v, amt: p * v * 100 });
  }
  const r = estimateFlowFromIntraday({ date: '2026-10-20', prevClose: base, source: 'test', points: pts });
  check('涨放量跌缩量→净流入', r && r.estInflow > 0 && r.buyRatio > 65,
    `estPct=${r && r.estPct} buyRatio=${r && r.buyRatio} label=${r && r.levelLabel}`);
}

// 5) 冲高回落（早盘涨、尾盘跌）→ 收盘净额转负或减弱
{
  const s = gen(i => i < 60 ? base * (1 + 0.0008 * i) : base * (1 + 0.048 - 0.0005 * (i - 60)), () => 100, base);
  const r = estimateFlowFromIntraday(s);
  const flat = gen(i => base * (1 + 0.0008 * Math.min(i, 60)), () => 100, base);
  const rFlat = estimateFlowFromIntraday(flat);
  check('冲高回落净额 < 单边上冲', r.estInflow < rFlat.estInflow,
    `回落=${r.estInflow} 直冲=${rFlat.estInflow}`);
}

// 6) 数据不足返回 null
{
  check('数据不足→null', estimateFlowFromIntraday({ points: [] }) === null
    && estimateFlowFromIntraday(null) === null
    && estimateFlowFromIntraday({ points: new Array(5).fill({ t: '09:31', p: 10, v: 100 }) }) === null);
}

// 7) 净额量级合理性：1分钟100手×10元×240分钟≈240万成交额，净额不应超过总额
{
  const s = gen(i => base * (1 + 0.0004 * i), () => 100, base);
  const r = estimateFlowFromIntraday(s);
  check('净额≤总成交额', Math.abs(r.estInflow) <= r.totalAmt && r.totalAmt > 0,
    `estInflow=${r.estInflow} totalAmt=${r.totalAmt}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
