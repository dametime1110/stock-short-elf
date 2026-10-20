// 分时形态识别单测（合成序列）：验证 analyzeIntraday + judgeIntradayPattern
// 典型场景：教科书拉升 / 洗盘 / 吸筹 / 出货(冲高回落) / 放量滞涨 / 随机噪音
const { analyzeIntraday, judgeIntradayPattern } = require('../lib/analyzer');

let pass = 0, fail = 0;
function check(name, series, expect) {
  const f = analyzeIntraday(series);
  const v = f ? judgeIntradayPattern(f) : null;
  const ok = v && v.pattern === expect;
  if (ok) { pass++; console.log(`✓ ${name} → ${v.pattern}(${v.score}分)`); }
  else { fail++; console.log(`✗ ${name} → 期望${expect} 实际${v ? v.pattern : 'null'}`, v ? JSON.stringify(v.metrics) : ''); }
  return v;
}

// 生成 241 分钟分时序列（9:30-15:00）；均价按 累计成交额/累计量 真实模拟（与实盘一致）
function gen(priceFn, volFn, prevClose) {
  const points = [];
  let cumPV = 0, cumV = 0;
  for (let i = 0; i < 241; i++) {
    const hh = 9 + Math.floor((i + 30) / 60), mm = (i + 30) % 60;
    const t = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    const p = priceFn(i), v = volFn(i);
    cumPV += p * v; cumV += v;
    points.push({ t, p, v, avg: cumV > 0 ? cumPV / cumV : p });
  }
  return { date: '2026-10-20', prevClose, source: 'test', points };
}

// 1) 教科书拉升：阶梯上行、涨时放量、始终在均价上方、尾盘收高
const base = 10;
check('教科书拉升', gen(
  i => base * (1 + 0.0004 * i),                       // 全天稳步上行 +9.6%
  i => 1000 * (i < 30 ? 0.6 : 1.2 + 0.3 * Math.sin(i / 10)),
  base
), 'rally');

// 2) 洗盘：早盘下探跌破均价、缩量、随后收回均价上方震荡收高
check('缩量洗盘', gen(
  i => {
    if (i < 45) return base * (1 - 0.0006 * i);       // 早盘阴跌探底 -2.7%
    if (i < 60) return base * (1 - 0.0006 * 45 + 0.0004 * (i - 45)); // 快速收回
    return base * (1 - 0.001 + 0.00015 * (i - 60));   // 之后缓步回升
  },
  i => i < 45 ? 400 : 1100,                            // 下跌段明显缩量
  base
), 'washout');

// 3) 吸筹：全天窄幅粘合均价、量能温和、重心微升
check('低位吸筹', gen(
  i => base * (1 + 0.00002 * i + 0.0004 * Math.sin(i / 15)),
  i => 900 + 100 * Math.sin(i / 12),
  base
), 'accumulation');

// 4) 出货（冲高回落）：早盘冲高 +6%、之后放量阴跌回原位、尾盘收低
check('冲高回落出货', gen(
  i => {
    if (i < 60) return base * (1 + 0.001 * i);        // 冲高 +6%
    if (i < 180) return base * (1 + 0.06 - 0.0005 * (i - 60)); // 放量回落
    return base * (1 + 0.06 - 0.0005 * 120 - 0.0002 * (i - 180)); // 尾盘续弱
  },
  i => i < 60 ? 1200 : i < 180 ? 1800 : 1500,
  base
), 'distribution');

// 5) 放量滞涨出货：早盘冲高+2%后放量回落，全天涨跌幅有限但巨量脉冲多次
check('放量滞涨', gen(
  i => {
    if (i < 40) return base * (1 + 0.0005 * i);        // 早盘冲高 +2%
    return base * (1 + 0.02 - 0.00012 * (i - 40));     // 之后放量阴跌回原位
  },
  i => 1400 + (i % 29 === 0 ? 6000 : 0),               // 全天偏大量+脉冲
  base
), 'distribution');

// 6) 随机噪音：不归入任何一类 → 中性
check('随机噪音', gen(
  i => base * (1 + 0.002 * Math.sin(i * 1.7) + 0.001 * Math.cos(i * 0.9)),
  i => 800 + 400 * Math.abs(Math.sin(i * 0.7)),
  base
), 'neutral');

// 7) 尾盘跳水：全天横盘、最后30分钟放量急跌 → 出货
check('尾盘跳水', gen(
  i => {
    if (i < 210) return base * (1 + 0.00002 * Math.sin(i / 10));
    return base * (1 - 0.0012 * (i - 210));            // 尾盘 -3.7%
  },
  i => i < 210 ? 700 : 2200,
  base
), 'distribution');

console.log(`\n结果：${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
