// 股票短线精灵 · 核心分析模块（服务端）
// 数据来源：东方财富免费公开接口（无需 key / 权限）
// 筹码峰：由 K线 + 成交量按 CYQ 模型自算
// 短评：内置 4 只样本股 AI 范例（hy3/step5）；其余股票走规则速评

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

async function fetchJSON(url, timeout = 8000, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': 'https://quote.eastmoney.com/' },
        signal: ctrl.signal
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise(r => setTimeout(r, 600 * (i + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

function toTencentCode(secid) {
  // secid: "1.600519" -> "sh600519" ; "0.000858" -> "sz000858"
  const [m, code] = secid.split('.');
  return (m === '1' ? 'sh' : 'sz') + code;
}

const NAME_MAP = {
  '600519': '贵州茅台', '300750': '宁德时代', '002594': '比亚迪', '300059': '东方财富',
  '601318': '中国平安', '600036': '招商银行', '000858': '五粮液', '601012': '隆基绿能',
  '688981': '中芯国际', '600276': '恒瑞医药', '000333': '美的集团', '000651': '格力电器',
  '600900': '长江电力', '601899': '紫金矿业', '300760': '迈瑞医疗', '002415': '海康威视',
  '600030': '中信证券', '601166': '兴业银行', '000001': '平安银行', '600887': '伊利股份',
  '002230': '科大讯飞', '603259': '药明康德', '688256': '寒武纪', '601398': '工商银行',
  '600519': '贵州茅台', '000858': '五粮液'
};

// 代码 -> 东财 secid（1.=沪 0.=深/京）
function resolveSecid(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/\.(sh|sz|bja)$/, '');
  const code = s.replace(/[^0-9]/g, '');
  if (/^sh/.test(s)) return '1.' + code;
  if (/^sz/.test(s)) return '0.' + code;
  if (code.length !== 6) return null;
  if (code[0] === '6') return '1.' + code;
  if (code[0] === '0' || code[0] === '3') return '0.' + code;
  if (code[0] === '8' || code[0] === '4') return '0.' + code; // 北交所
  return '1.' + code;
}

async function getKline(secid, lmt = 120) {
  const tc = toTencentCode(secid);
  // 腾讯优先（稳定、无 key）
  try {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${tc},day,,,${lmt}`;
    const j = await fetchJSON(url, 8000, 1);
    const node = j?.data?.[tc];
    const arr = node?.day || node?.qfqday;
    if (arr && arr.length) {
      return arr.map(a => ({ date: a[0], open: +a[1], close: +a[2], high: +a[3], low: +a[4], volume: +a[5] }));
    }
  } catch (e) {}
  // 兜底东财
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&secid=${secid}&end=20500101&lmt=${lmt}`;
  const j = await fetchJSON(url);
  if (!j.data || !j.data.klines) throw new Error('K线数据为空');
  return j.data.klines.map(line => {
    const a = line.split(',');
    return { date: a[0], open: +a[1], close: +a[2], high: +a[3], low: +a[4], volume: +a[5] };
  });
}

async function getSnapshot(secid) {
  const code = secid.split('.')[1];
  const tc = toTencentCode(secid);
  // 腾讯优先
  try {
    const url = `https://qt.gtimg.cn/q=${tc}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://gu.qq.com/' }, signal: ctrl.signal });
    clearTimeout(t);
    const txt = await r.text();
    const m = txt.match(/="(.*)"/);
    if (m) {
      const a = m[1].split('~');
      // 名称兜底：全市场清单(UTF-8可靠) > 腾讯原生名(GBK,可能乱码) > 内置映射 > 代码
      // （必须拿到正确中文名，否则个股资讯搜索无关键词、页面显示乱码）
      const stockName = (STOCK_LIST.find(x => x.code === code) || {}).name
        || (a[1] || '').trim()
        || NAME_MAP[code] || code;
      return {
        name: stockName,
        code,
        price: +a[3],
        prevClose: +a[4],
        changePct: +a[32],
        pe: a[39] ? +a[39] : null,
        pb: a[46] ? +a[46] : null,
        totalMktCap: a[45] ? +a[45] * 1e8 : null,
        floatMktCap: a[44] ? +a[44] * 1e8 : null
      };
    }
  } catch (e) {}
  // 兜底东财
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f57,f58,f60,f116,f117,f170`;
  const j = await fetchJSON(url);
  const d = j.data;
  if (!d) throw new Error('快照数据为空');
  return {
    name: d.f58 || NAME_MAP[code] || code, code: d.f57 || code,
    price: d.f43 / 100, prevClose: d.f60 / 100, changePct: d.f170 / 100,
    pe: null, pb: null, totalMktCap: d.f116, floatMktCap: d.f117
  };
}

async function getFlow(secid, lmt = 20) {
  try {
    const url = `https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=${lmt}&klt=101&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&secid=${secid}`;
    const j = await fetchJSON(url, 6000, 1);
    if (!j.data || !j.data.klines) return { mainNetInflow: null, mainNetInflow5d: null, trend: [] };
    const arr = j.data.klines
      .map(line => { const a = line.split(','); return { date: a[0], main: +a[1] }; })
      .reverse(); // 旧->新
    const mainNetInflow = arr.length ? arr[arr.length - 1].main : null;
    const last5 = arr.slice(-5).reduce((s, x) => s + x.main, 0);
    return { mainNetInflow, mainNetInflow5d: last5, trend: arr.map(x => x.main) };
  } catch (e) {
    return { mainNetInflow: null, mainNetInflow5d: null, trend: [] };
  }
}

// 个股近期资讯：东财搜索接口（按股票名称检索，返回真实新闻+摘要）
// 注：东财公告接口 np-anotice-stock 的 secid 参数已失效（返回全市场流），故改用搜索接口
async function getNews(stockName) {
  const name = String(stockName || '').trim();
  if (!name || /^\d+$/.test(name)) return []; // 名称缺失或是纯代码则跳过
  const param = encodeURIComponent(JSON.stringify({
    keyword: name, type: ['cmsArticleWebOld'], pageindex: 1, pagesize: 6, searchtype: 1
  }));
  const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${param}`;
  try {
    const txt = await fetchText(url, 'https://so.eastmoney.com/', 10000, 2); // 云端偶发抖动，多重试
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const j = JSON.parse(m[0]);
    const list = (j.result && j.result.cmsArticleWebOld) || [];
    return list
      .map(x => ({
        title: String(x.title || '').replace(/<\/?em>/g, ''),
        date: String(x.date || '').slice(0, 10),
        summary: String(x.content || '').replace(/<\/?em>/g, '').slice(0, 80)
      }))
      .filter(x => x.title)
      .slice(0, 5);
  } catch (e) { return []; }
}

// CYQ 移动成本分布：常量衰减 + 当日量三角分布
function computeCYQ(klines, price) {
  const arr = [...klines];
  let minL = Infinity, maxH = -Infinity;
  arr.forEach(d => { minL = Math.min(minL, d.low); maxH = Math.max(maxH, d.high); });
  const N = 60, step = (maxH - minL) / N;
  let bins = new Array(N).fill(0);
  const decay = 0.985;
  arr.forEach(d => {
    bins = bins.map(v => v * decay);
    const s = Math.max(0, Math.floor((d.low - minL) / step));
    const e = Math.min(N - 1, Math.floor((d.high - minL) / step));
    const c = d.close;
    for (let i = s; i <= e; i++) {
      const p = minL + (i + 0.5) * step;
      let w = 1 - Math.abs(p - c) / ((d.high - d.low) || 1);
      if (w < 0) w = 0;
      bins[i] += d.volume * w;
    }
  });
  const total = bins.reduce((a, b) => a + b, 0) || 1;
  const cur = price;
  let profit = 0, cost = 0;
  const points = bins.map((b, i) => {
    const p = minL + (i + 0.5) * step;
    cost += b * p;
    if (p <= cur) profit += b;
    return [+p.toFixed(2), +((b / total) * 100).toFixed(2)];
  });
  const avgCost = cost / total;
  const profitRatio = +((profit / total) * 100).toFixed(1);
  let peakIdx = 0;
  bins.forEach((b, i) => { if (b > bins[peakIdx]) peakIdx = i; });
  const peakPrice = +(minL + (peakIdx + 0.5) * step).toFixed(2);
  // 90% 成本集中度
  let acc = 0, lo = null, hi = null;
  for (let i = 0; i < N; i++) {
    acc += bins[i] / total;
    if (lo === null && acc >= 0.05) lo = minL + (i + 0.5) * step;
    if (acc >= 0.95 && hi === null) { hi = minL + (i + 0.5) * step; break; }
  }
  const concentration = (lo && hi) ? +(((hi - lo) / (hi + lo)) * 100).toFixed(1) : null;
  return { points, profitRatio, avgCost: +avgCost.toFixed(2), peakPrice, concentration };
}

function ema(arr, n) {
  const k = 2 / (n + 1);
  let prev = arr[0];
  return arr.map((v, i) => { prev = i === 0 ? v : v * k + prev * (1 - k); return prev; });
}

function computeMACD(klines) {
  const closes = klines.map(d => d.close);
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const diff = closes.map((_, i) => e12[i] - e26[i]);
  const dea = ema(diff, 9);
  const hist = diff.map((d, i) => 2 * (d - dea[i]));
  const n = closes.length;
  const last = { diff: diff[n - 1], dea: dea[n - 1], hist: hist[n - 1] };
  const pd = diff[n - 2], pdea = dea[n - 2];
  let signal = '空头';
  if (last.diff > last.dea && pd <= pdea) signal = '金叉';
  else if (last.diff < last.dea && pd >= pdea) signal = '死叉';
  else if (last.diff > last.dea) signal = '多头';
  else signal = '空头';
  return { diff: +last.diff.toFixed(3), dea: +last.dea.toFixed(3), hist: +last.hist.toFixed(3), signal, zeroAxis: last.diff > 0 ? '零轴上' : '零轴下' };
}

function computeRSI(closes, n = 14) {
  if (closes.length <= n) return 50;
  let gain = 0, loss = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  if (loss === 0) return 100;
  return +(100 - 100 / (1 + gain / loss)).toFixed(1);
}

/* ===== 综合评分体系（0-100）=====
 * 三个层次：
 *  computeQuoteScore   快照评分：仅用批量报价字段（今日走势为主），全市场 5198 只秒算
 *  computeShortTermScore 纯K线短期技术分：供"综合榜"加权（短期走势维度）
 *  computeDeepScore    深度评分：个股详情页，融合技术/资金/筹码/动量/今日走势
 */
function scoreGrade(s) {
  if (s >= 80) return '强势';
  if (s >= 65) return '偏强';
  if (s >= 45) return '中性';
  if (s >= 30) return '偏弱';
  return '弱势';
}

function computeQuoteScore(q) {
  // q: {price,prevClose,changePct,high,low,amp,volume,amount,turnover,volRatio,totalMktCap,pe,pb,avgPrice}
  let s = 50;
  const chg = q.changePct || 0;
  // 1) 今日涨跌幅 ±26（涨停附近顶格）
  s += Math.max(-26, Math.min(26, chg * 4));
  // 2) 日内强弱 ±10（收盘位置+相对均价）
  if (q.high && q.low && q.high > q.low) {
    const pos = (q.price - q.low) / (q.high - q.low);   // 0=收在地板 1=收在天花板
    s += (pos - 0.5) * 16;
    if (q.avgPrice) s += q.price > q.avgPrice ? 4 : -4;
  }
  // 3) 量能配合度 ±10（放量且同向=资金认可；爆量过热减半；无量减半）
  const vr = q.volRatio || 0;
  const dir = chg >= 0 ? 1 : -1;
  if (vr >= 1.2 && vr <= 3) s += dir * 10;
  else if (vr > 3) s += dir * 4;      // 爆量：多空分歧大
  else if (vr > 0 && vr < 0.7) s += dir * 2;  // 无量：信号弱
  else s += dir * 3;                  // 量比正常
  // 4) 换手活跃度 ±6（适度活跃加分，过冷/过热减分）
  const to = q.turnover || 0;
  if (to >= 1 && to <= 8) s += 4;
  else if (to > 15) s -= 2;
  else if (to > 0 && to < 0.3) s -= 2;
  // 5) 振幅健康度 ±3
  const amp = q.amp || 0;
  if (amp >= 1.2 && amp <= 6) s += 3;
  else if (amp > 9) s -= 2;
  else if (amp > 0 && amp < 0.5) s -= 2;
  // 6) 流动性 ±5
  const amt = q.amount || 0;   // 万元
  if (amt > 100000) s += 5;        // 成交额 >10亿
  else if (amt > 10000) s += 2;    // >1亿
  else if (amt > 0 && amt < 1000) s -= 3;
  // 7) 估值安全垫 ±4
  if (q.pe > 0 && q.pe < 20 && q.pb > 0 && q.pb < 3) s += 3;
  if (q.pe > 100 || q.pe < 0) s -= 2;
  s = Math.max(5, Math.min(95, Math.round(s)));
  return { score: s, grade: scoreGrade(s) };
}

// 纯K线短期技术分（-28~+28）：均线排列/MACD/动量/价格与20日线关系
function computeShortTermScore(klines, price) {
  if (!klines || klines.length < 20) return 0;
  const closes = klines.map(k => k.close);
  const ma = (n) => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
  const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20);
  let s = 0;
  if (ma5 > ma10 && ma10 > ma20) s += 8;        // 多头排列
  else if (ma5 < ma10 && ma10 < ma20) s -= 8;   // 空头排列
  if (price > ma20) s += 4; else s -= 4;
  // MACD（12/26/9）
  const ema = (arr, n) => { const k = 2 / (n + 1); let e = arr[0]; for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k); return e; };
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const diff = e12 - e26;
  // 简化：近5日DIFF方向（用收盘价序列近似DEA动量）
  const c5 = closes.slice(-5), p5 = closes[closes.length - 6] || closes[0];
  if (diff > 0) s += 6; else s -= 6;
  if (c5[4] > c5[0]) s += 3; else s -= 3;      // 近5日收盘重心上移
  // 5日/10日动量
  const p10 = closes[closes.length - 11] || closes[0];
  const m5 = (price / p5 - 1) * 100, m10 = (price / p10 - 1) * 100;
  s += Math.max(-8, Math.min(8, m5 * 1.5));
  s += Math.max(-6, Math.min(6, m10 * 0.8));
  return Math.max(-28, Math.min(28, s));
}

// 深度评分（个股详情页）：技术/资金/筹码/动量/RSI/今日走势/波动率
function computeDeepScore({ snapshot, cyq, flow, tech, rsi, klines }) {
  let s = 50;
  const dims = {};
  // 1) 技术趋势 ±22：MACD信号+零轴+均线排列+价格与20日线
  let tech1 = 0;
  if (tech.signal === '金叉' || tech.signal === '多头') tech1 += 12;
  if (tech.signal === '死叉' || tech.signal === '空头') tech1 -= 12;
  if (tech.zeroAxis === '零轴上') tech1 += 8; else tech1 -= 8;
  if (klines && klines.length >= 20) {
    const closes = klines.map(k => k.close);
    const ma = (n) => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
    const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20);
    if (ma5 > ma10 && ma10 > ma20) tech1 += 6;
    else if (ma5 < ma10 && ma10 < ma20) tech1 -= 6;
    if (snapshot.price > ma20) tech1 += 2; else tech1 -= 2;
  }
  dims.tech = Math.max(-22, Math.min(22, tech1)); s += dims.tech;
  // 2) 资金 ±18：当日主力净流入（cap ±12）+ 5日方向 ±6；数据缺失记 0
  let fund = 0;
  const m = flow.mainNetInflow;
  if (m != null) {
    fund += Math.max(-12, Math.min(12, Math.abs(m) / 1e8 * 8) * (m > 0 ? 1 : -1));
    if (flow.mainNetInflow5d > 0) fund += 6; else if (flow.mainNetInflow5d < 0) fund -= 6;
  }
  dims.fund = fund; s += fund;
  // 3) 筹码 ±10：获利比例 30-70 中性偏好，高位追高风险、低位反弹潜力
  let chip = 0;
  if (cyq.profitRatio >= 70) chip = -6;
  else if (cyq.profitRatio <= 30) chip = 6;
  else chip = (cyq.profitRatio - 50) / 20 * 4;
  dims.chip = Math.max(-10, Math.min(10, chip)); s += dims.chip;
  // 4) 短期动量 ±14：5日/10日涨跌幅
  let mom = 0;
  if (klines && klines.length >= 11) {
    const c = klines.map(k => k.close);
    const p5 = c[c.length - 6], p10 = c[c.length - 11];
    const m5 = (snapshot.price / p5 - 1) * 100, m10 = (snapshot.price / p10 - 1) * 100;
    mom = Math.max(-7, Math.min(7, m5 * 1.2)) + Math.max(-7, Math.min(7, m10 * 0.6));
  }
  dims.mom = Math.max(-14, Math.min(14, mom)); s += dims.mom;
  // 5) RSI ±8：超卖反弹潜力/超买回调风险/中段健康
  if (rsi < 30) { dims.rsi = 8; }
  else if (rsi > 70) { dims.rsi = -6; }
  else if (rsi >= 45 && rsi <= 60) { dims.rsi = 2; }
  else { dims.rsi = 0; }
  s += dims.rsi;
  // 6) 今日走势 ±12：当日涨跌 + K线日内位置（收高/收低）
  let today = Math.max(-6, Math.min(6, (snapshot.changePct || 0) * 2));
  if (klines && klines.length) {
    const last = klines[klines.length - 1];
    if (last.high > last.low) {
      const pos = (last.close - last.low) / (last.high - last.low);
      today += (pos - 0.5) * 8;
    }
  }
  dims.today = Math.max(-12, Math.min(12, today)); s += dims.today;
  // 7) 波动率惩罚：近10日日均振幅 >6% 开始扣分（不确定性）
  let vol = 0;
  if (klines && klines.length >= 10) {
    const recent = klines.slice(-10);
    const volPct = recent.reduce((ss, d) => ss + Math.abs(d.high - d.low) / d.close, 0) / recent.length * 100;
    if (volPct > 6) vol = -Math.min(8, (volPct - 6) * 1.5);
  }
  dims.vol = vol; s += vol;
  s = Math.max(5, Math.min(95, Math.round(s)));
  return { score: s, grade: scoreGrade(s), dims };
}

// 全市场综合评分榜：快照评分（今日走势，55%）+ 短期技术分（45%）
let _scoreBoardCache = { ts: 0, data: null, top: 0 };
async function getMarketScoreBoard(limit = 50, top = 300, force = false) {
  const now = Date.now();
  // 缓存复用条件：未过期 且 已算过的候选数 ≥ 本次请求（小榜可复用大榜缓存）
  if (!force && _scoreBoardCache.data && now - _scoreBoardCache.ts < 600000 && _scoreBoardCache.top >= top) {
    return { ... _scoreBoardCache.data, stocks: _scoreBoardCache.data.stocks.slice(0, limit) };
  }
  const snap = await getMarketSnapshot(force);
  const scored = snap.stocks.map(q => ({ q, ...computeQuoteScore(q) }));
  // 预筛：快照分最高的 top 只进入K线深度计算（控制耗时）
  const cand = scored.sort((a, b) => b.score - a.score).slice(0, top);
  const results = await mapLimit(cand, 10, async (item) => {
    let shortTerm = null;
    try {
      const secid = resolveSecid(item.q.code);
      const klines = await getKline(secid, 60);
      shortTerm = Math.round(computeShortTermScore(klines, item.q.price));
    } catch (e) { /* 单只失败不影响整榜 */ }
    const combined = shortTerm == null ? item.score
      : Math.max(5, Math.min(95, Math.round(item.score * 0.55 + (50 + shortTerm) * 0.45)));
    return { ...item.q, score: combined, quoteScore: item.score, shortScore: shortTerm == null ? null : 50 + shortTerm, grade: scoreGrade(combined) };
  });
  const board = {
    updatedAt: now, count: results.length, total: snap.total, source: snap.source,
    stocks: results.sort((a, b) => b.score - a.score)
  };
  _scoreBoardCache = { ts: now, data: board, top };
  return { ...board, stocks: board.stocks.slice(0, limit) };
}

function buildHeuristic({ snapshot, cyq, flow, tech, rsi, news, klines }) {
  // 筹码
  let chip;
  if (cyq.profitRatio >= 70) chip = `当前获利比例${cyq.profitRatio}%，多数筹码浮盈；平均成本${cyq.avgCost}，筹码密集区约在${cyq.peakPrice}，上方存在短线套牢/止盈压力。`;
  else if (cyq.profitRatio <= 30) chip = `当前获利比例仅${cyq.profitRatio}%，多数筹码处于亏损（套牢），抛压趋于衰减，但企稳仍需量能配合。`;
  else chip = `当前获利比例${cyq.profitRatio}%，筹码盈亏大致均衡；平均成本${cyq.avgCost}，现价${snapshot.price}位于成本${snapshot.price > cyq.avgCost ? '上方（浮盈）' : '下方（浮亏）'}。`;

  // 资金
  let fund;
  const m = flow.mainNetInflow;
  if (m == null) fund = '主力资金数据暂不可用。';
  else if (m > 0) fund = `当日主力净流入约${(m / 1e8).toFixed(2)}亿元，资金呈回流${flow.mainNetInflow5d > 0 ? '，近5日累计亦为净流入' : '（但近5日累计净流出，持续性待观察）'}。`;
  else fund = `当日主力净流出约${(-m / 1e8).toFixed(2)}亿元，资金态度偏谨慎${flow.mainNetInflow5d < 0 ? '，近5日持续净流出' : '（近5日累计净流入，或为散户抛压主导）'}。`;

  // 技术
  const techTxt = `MACD${tech.signal}（DIFF ${tech.diff}、DEA ${tech.dea}，位于${tech.zeroAxis}），RSI(14)=${rsi}（${rsi > 70 ? '超买' : rsi < 30 ? '超卖' : '中性'}）。`;

  // 消息
  const newsTxt = news.length ? `近期公告/消息：${news.slice(0, 2).map(x => x.title).join('；')}。` : '暂无重大公告。';

  // 综合
  let score = 0;
  if (tech.signal === '多头' || tech.signal === '金叉') score += 1;
  if (tech.signal === '空头' || tech.signal === '死叉') score -= 1;
  if (m > 0) score += 1; if (m < 0) score -= 1;
  if (cyq.profitRatio >= 60) score += 0.5; if (cyq.profitRatio <= 30) score -= 0.5;
  const bias = score > 1 ? '偏多' : score < -1 ? '偏空' : '中性';
  const summary = `综合四维信号：${bias}。${chip}${fund}`;

  // 策略
  let strategy;
  if (bias === '偏多') strategy = `持仓者沿短期均线上持，跌破${cyq.avgCost}减仓；未入场者不追高，回踩${cyq.avgCost}附近且量能温和可低吸。风控：单笔≤2成，止损参考${cyq.avgCost}。`;
  else if (bias === '偏空') strategy = `观望为主，不接飞刀；持仓者借反抽减仓，跌破前低再看。风控：仓位≤1成，破位严格止损。`;
  else strategy = `区间思路：箱体下沿低吸、上沿高抛；放量突破再转多。仓位≤1.5成，设好止损。`;

  // 三情景概率（2026-10-20 动态化：原为全市场写死的 55/30/15，现由多空信号强度与波动率共同决定）
  const recent = klines.slice(-10);
  const avgRange = recent.reduce((s, d) => s + Math.abs(d.high - d.low) / d.close, 0) / recent.length;
  const up = (snapshot.price * (1 + avgRange)).toFixed(2);
  const dn = (snapshot.price * (1 - avgRange)).toFixed(2);
  const bull = (snapshot.price * (1 + avgRange * 1.8)).toFixed(2);
  const bear = (snapshot.price * (1 - avgRange * 1.8)).toFixed(2);
  // 多空强度分 s ∈ [-60,+60]：MACD/零轴/资金(当日+5日)/筹码位置/RSI/动量/价格与成本关系
  let s = 0;
  if (tech.signal === '金叉' || tech.signal === '多头') s += 12;
  if (tech.signal === '死叉' || tech.signal === '空头') s -= 12;
  if (tech.zeroAxis === '零轴上') s += 5; else s -= 5;
  if (m > 0) s += Math.min(15, Math.abs(m) / 1e8 * 10); else if (m < 0) s -= Math.min(15, Math.abs(m) / 1e8 * 10);
  if (flow.mainNetInflow5d > 0) s += 5; else if (flow.mainNetInflow5d < 0) s -= 5;
  if (cyq.profitRatio >= 70) s -= 8;            // 高位获利盘=追高风险
  else if (cyq.profitRatio <= 30) s += 8;       // 低位套牢=抛压衰减、反弹潜力
  else s += (cyq.profitRatio - 50) / 20 * 5;    // 中间区域线性过渡
  if (rsi > 70) s -= 8; else if (rsi < 30) s += 8;
  const chg = snapshot.changePct || 0;
  if (chg >= 3) s += 5; else if (chg <= -3) s -= 5;
  if (snapshot.price > cyq.avgCost) s += 5; else s -= 5;
  s = Math.max(-60, Math.min(60, s));
  // 波动率越大→震荡概率越低、单边概率越高
  const volPct = avgRange * 100;
  const baseP = Math.max(22, Math.min(42, Math.round(42 - volPct * 2)));
  const rest = 100 - baseP;
  let bullP = Math.round(rest * (0.5 + 0.35 * (s / 60)));
  bullP = Math.max(8, Math.min(rest - 8, bullP));
  const bearP = 100 - baseP - bullP;
  const forecast = {
    base: `${dn}-${up} 区间震荡（约${baseP}%）`,
    bull: `放量突破${up}，上看${bull}（约${bullP}%）`,
    bear: `跌破${dn}，下探${bear}（约${bearP}%）`
  };
  const probNote = `概率依据：多空信号强度 ${s > 0 ? '多' : '空'}(${Math.abs(s).toFixed(0)}/60) · 近10日日均振幅 ${volPct.toFixed(1)}% · 资金${m > 0 ? '净流入' : m < 0 ? '净流出' : '数据缺失'} · 筹码获利比例 ${cyq.profitRatio}%`;

  // 综合评分（0-100，融合技术/资金/筹码/动量/RSI/今日走势/波动率）
  const scoreInfo = computeDeepScore({ snapshot, cyq, flow, tech, rsi, klines });

  return { chip, fund, tech: techTxt, news: newsTxt, summary, strategy, forecast, probNote, kind: '规则速评', score: scoreInfo.score, grade: scoreInfo.grade, scoreDims: scoreInfo.dims };
}

// ===== 内置 4 只样本股 AI 范例短评（由模型基于真实数据生成）=====
const SAMPLE_REVIEWS = {
  '600519': {
    hy3: {
      chip: '近一月股价自1252元震荡上行至1325元，成交量在1280-1320区间最为密集，当前价位于区间上沿。底部获利盘积累较厚（获利比例约七成），但10/19盘中冲高1348后回落，1340-1350一带存在短线套牢盘，构成近期主要压力。',
      fund: '当日主力净流入约6987万元，结束前序小幅流出，资金态度边际转暖；但流入量级不大，属试探性回流，持续性待观察。',
      tech: 'MACD金叉后红柱持续（DIFF 6.44＞DEA -3.35，MACD柱19.58），中期多头格局未破；短线在1320-1350遇阻，近一日微跌0.30%，属冲高后正常回踩。',
      news: '直销渠道持续放量、市场化改革压缩渠道库存、社会库存降至低位；重夺股王反映风险偏好回升。偏利好但非突发催化，属基本面韧性支撑。',
      summary: '筹码锁定+资金回流+技术多头+基本面稳，四因素共振偏多；但短线临近1350前高压力区，追高性价比一般。',
      strategy: '持仓者沿5日线持有，跌破1280(约10日线)减仓；冲高1340-1350不过可部分止盈。\n观望者不追高，回踩1280-1300且量能温和可低吸；放量突破1350站稳再跟进。\n风控：单笔≤总仓2成，1280止损。',
      forecast: { base: '1320-1350区间震荡消化获利盘，2-5日选方向（约55%）', bull: '放量突破1350打开至1400空间（约30%）', bear: '跌破1280回踩1250平台（约15%）' }
    },
    step5: {
      chip: '筹码结构上沿偏重，1340-1350短线套牢盘虽不重，但获利了结意愿随价格抬升增强，下方1280为密集成交支撑。',
      fund: '主力单日净流入不到7000万，相对茅台日均成交偏小，更像被动回流而非主动进攻，资金共识未形成。',
      tech: 'MACD红柱放大但DIFF仍在零轴附近、DEA为负，多头尚未完全确认；量能未配合放大，反弹成色不足。',
      news: '改革与直销利好已被市场部分消化，缺少新催化前难独自驱动趋势。',
      summary: '偏多但动能偏弱，属于「有支撑、缺催化」的震荡市，不宜按强趋势处理。',
      strategy: '以区间交易为主：1280-1350内高抛低吸，突破1350放量才转多。\n仓位比 hy3 更保守（≤1.5成），止损1280。',
      forecast: { base: '1280-1350宽幅震荡（约50%）', bull: '温和放量站上1350看1400（约30%）', bear: '跌破1280下探1235-1250（约20%）' }
    }
  },
  '300750': {
    hy3: {
      chip: '近一月股价自297元回落至267元，跌幅约10%；早期290-300高位区域成交密集，现已全面转为套牢盘，构成反弹主要压制。近期267-278低位有承接但量能一般，筹码结构偏空、获利比例低。',
      fund: '当日主力净流出约4.6亿元，近期呈持续净流出态势，大资金态度谨慎，未见回流信号。',
      tech: 'MACD双线均处零轴下方（DIFF -18.57、DEA -18.62），红柱几近归零，空头占优、趋势偏弱；短线反抽缺乏量能配合。',
      news: '积极面：大额回购(上限400亿)、10/20审议Q3业绩、中报高增且研报称具性价比。事件驱动(Q3业绩)临近，存在预期博弈。',
      summary: '技术面与资金面偏弱、筹码上空方占优，但大额回购+Q3业绩窗口构成阶段性对冲，短期或呈「弱势中的事件博弈」。',
      strategy: '空仓者不急于抄底，待Q3业绩(10/20)落地、且出现放量止跌信号(如单日放量长下影)再介入。\n持仓者若成本高位，可借业绩窗口反弹至285-295减仓。\n风控：破260减仓，单笔≤1.5成。',
      forecast: { base: '260-285区间弱势震荡，等待业绩指引（约50%）', bull: 'Q3超预期+回购加码，放量收复290（约30%）', bear: '业绩不及预期或破260，下探245-250（约20%）' }
    },
    step5: {
      chip: '高位套牢盘虽重，但267附近已出现连续地量企稳，恐慌抛压衰减，向下空间有限。',
      fund: '净流出4.6亿放在日均成交级别不算极端，且回购托底会逐步对冲抛压。',
      tech: 'MACD柱逼近零轴、下跌动能衰竭，随时可能金叉修复。',
      news: 'Q3业绩+400亿回购上限是强催化剂组合，市场预期差大，业绩日易出惊喜。',
      summary: '表面弱势、实则临近催化拐点，属于「利空出尽+事件驱动」的左侧布局窗口。',
      strategy: '激进者可小仓(≤1成)于265-270埋伏业绩，止损258；右侧者等放量站上285再加。\n整体比 hy3 更偏左侧乐观。',
      forecast: { base: '265-290震荡筑底（约45%）', bull: '业绩超预期放量突破295（约35%）', bear: '破258去250（约20%）' }
    }
  },
  '002594': {
    hy3: {
      chip: '近一月股价在81-87元箱体震荡，成交分布较均匀，当前83.5位于中枢略偏上，筹码结构中性、无明显密集套牢或获利峰。',
      fund: '当日主力小幅净流入约1466万元，资金进出均衡，无明确方向性。',
      tech: 'MACD双线贴近零轴（DIFF -1.24、DEA -1.36），红柱微露，多空弱平衡；价在84-86前高下有压制。',
      news: '9月销量创年内新高、出口高增、高端化明确；研报预计净利+24%。基本面强、结构升级清晰。',
      summary: '基本面强(销量/出口/高端化三线向好)但股价横盘、资金观望，呈「好公司等催化」的蓄势状态，向上需放量突破86。',
      strategy: '持仓者86下方持有，放量突破86且站稳可加仓；回踩81-82不破可低吸。\n观望者等突破或回踩低吸，单笔≤2成。止损80。',
      forecast: { base: '81-86箱体震荡蓄势（约55%）', bull: '放量突破86打开至92-95（约30%）', bear: '破80下探76-78（约15%）' }
    },
    step5: {
      chip: '箱体中枢筹码沉淀充分，83一带支撑有效，向下空间小。',
      fund: '小幅净流入虽不大，但在横盘市中属偏暖信号。',
      tech: '零轴附近红柱微露，随时可能转多。',
      news: '销量与出口数据超预期，是确定性最强的样本；横盘更像是业绩兑现前的沉淀。',
      summary: '基本面确定性高，当前横盘提供风险收益比不错的布局点，优于多数同板块。',
      strategy: '可在82-84区间分批建仓(≤2成)，突破86加仓；比 hy3 更建议主动布局而非纯等待。\n止损80。',
      forecast: { base: '82-87震荡偏强（约50%）', bull: '突破86看92（约35%）', bear: '破80看76（约15%）' }
    }
  },
  '300059': {
    hy3: {
      chip: '近一月17.2-18.9元箱体，当前18.08处中枢，10/15放巨量冲18.32后回落，该价位附近有短线套牢；筹码结构中性偏弱。',
      fund: '当日主力净流出约1.5亿元，近期大资金偏谨慎，与「机构跑路」报道一致。',
      tech: 'MACD双线零轴下方微多（DIFF -0.237、DEA -0.296，红柱0.118），弱修复；价受18.3-18.5压制。',
      news: '中报历史最佳，但年内跌超23%、机构减持、实控人减持预期；作为券商龙头与成交额深度绑定，当前成交地量压制预期，融资余额连降。',
      summary: '业绩强但股价弱、量能萎缩+减持预期形成压制，属「基本面与筹码博弈」的弱势震荡，弹性取决于成交额回暖。',
      strategy: '观望为主，不接飞刀；待两市成交额重回1.8万亿+且股价站稳18.5再考虑。\n持仓者反弹18.3-18.5减仓。风控破17止损，单笔≤1成。',
      forecast: { base: '17-18.5地量阴跌震荡（约50%）', bull: '成交额放量重回1.8万亿，突破18.5看20（约30%）', bear: '破17下探15.5-16（约20%）' }
    },
    step5: {
      chip: '高位机构持续出货，筹码向散户转移，结构恶化。',
      fund: '主力连续净流出+融资余额连降，杠杆与机构同步撤退。',
      tech: '弱修复难改下行趋势，18.5压力明确。',
      news: '减持预期+成交地量是中期压制，业绩利好已「见光死」。',
      summary: '最弱的样本，业绩与股价背离短期难解，宜回避。',
      strategy: '回避或仅反弹减仓；若持有破17无条件降仓。比 hy3 更偏防守。\n单笔≤1成，破17清。',
      forecast: { base: '16.5-18弱势盘跌（约45%）', bull: '成交回暖站18.5（约30%）', bear: '破17去15（约25%）' }
    }
  }
};

async function analyze(input) {
  const secid = resolveSecid(input);
  if (!secid) throw new Error('无法识别股票代码，请输6位代码');
  const [klines, snapshot, flow] = await Promise.all([
    getKline(secid), getSnapshot(secid), getFlow(secid)
  ]);
  const tech = computeMACD(klines);
  const rsi = computeRSI(klines.map(d => d.close));
  const cyq = computeCYQ(klines, snapshot.price);
  const news = await getNews(snapshot.name); // 依赖 snapshot.name，故串行
  const heuristic = buildHeuristic({ snapshot, cyq, flow, tech, rsi, news, klines });
  const code6 = snapshot.code;
  const aiReview = SAMPLE_REVIEWS[code6] || null;
  return {
    ok: true, code: code6, name: snapshot.name, secid,
    snapshot: {
      price: snapshot.price, prevClose: snapshot.prevClose, changePct: snapshot.changePct,
      pe: snapshot.pe, pb: snapshot.pb,
      totalMktCap: snapshot.totalMktCap, floatMktCap: snapshot.floatMktCap
    },
    klines, cyq,
    capital: { mainNetInflow: flow.mainNetInflow, mainNetInflow5d: flow.mainNetInflow5d, trend: flow.trend },
    tech: { ...tech, rsi },
    news,
    dataSource: 'eastmoney-live',
    aiReview,
    heuristic
  };
}

// 常用简称/别名 → 用于搜索兜底（用户输入"招行""宁王"等简称时也能命中）
const ALIAS = {
  '招行': '600036', '工行': '601398', '建行': '601939', '农行': '601288', '中行': '601988',
  '交行': '601328', '邮储': '601658', '兴业': '601166', '浦发': '600000', '民生': '600016',
  '平安银行': '000001', '宁波银行': '002142', '招商银行': '600036', '中信银行': '601998',
  '茅台': '600519', '五粮液': '000858', '泸州老窖': '000568', '洋河': '002304', '汾酒': '600809',
  '宁王': '300750', '宁德': '300750', '比亚迪': '002594', '蔚来': 'NIO', '小鹏': 'XPEV',
  '隆基': '601012', '通威': '600438', '阳光电源': '300274', '格力': '000651', '美的': '000333',
  '海尔': '600690', '海康': '002415', '立讯': '002475', '工业富联': '601138',
  '中芯': '688981', '寒武纪': '688256', '海光': '688041', '中微': '688012',
  '恒瑞': '600276', '药明': '603259', '迈瑞': '300760', '爱尔': '300015', '片仔癀': '600436',
  '东财': '300059', '中信证券': '600030', '华泰': '601688', '国泰君安': '601211', '广发': '000776',
  '紫金': '601899', '洛阳钼业': '603993', '山东黄金': '600547', '北方稀土': '600111',
  '长电': '600900', '三峡': '600900', '华能': '600011', '国电': '600795',
  '中石油': '601857', '中石化': '600028', '中海油': '600938', '中国移动': '600941',
  '中国联通': '600050', '中国电信': '601728', '腾讯': '00700', '阿里': '09988',
  '万科': '000002', '保利': '600048', '招商蛇口': '001979',
  '京东方': '000725', 'TCL': '000100', '三安': '600703', '韦尔': '603501',
  '科大讯飞': '002230', '中兴': '000063', '海康威视': '002415', '大华': '002236',
  '伊利': '600887', '蒙牛': '02319', '海天': '603288', '涪陵榨菜': '002507',
  '智飞': '300122', '沃森': '300142', '复兴': '600196', '云南白药': '000538',
  '上海机场': '600009', '白云机场': '600004', '京沪高铁': '601816', '顺丰': '002352',
  '中远海控': '601919', '东方财富': '300059', '同花顺': '300033', '指南针': '300803'
};

async function search(keyword) {
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  // 1) 常用别名精确命中
  if (ALIAS[kw]) {
    const code = ALIAS[kw];
    const name = NAME_MAP[code] || (STOCK_LIST.find(x => x.code === code) || {}).name || kw;
    return [{ code, name }];
  }
  // 2) 内置 NAME_MAP 匹配
  const local = Object.entries(NAME_MAP)
    .filter(([code, name]) => name.includes(kw) || code.includes(kw))
    .map(([code, name]) => ({ code, name }));
  if (local.length) return local.slice(0, 8);
  // 3) 本地全市场清单（5198只）模糊匹配：名称包含 或 代码包含
  const list = STOCK_LIST.filter(x => x.name.includes(kw) || x.code.includes(kw))
    .slice(0, 8)
    .map(x => ({ code: x.code, name: x.name }));
  if (list.length) return list;
  // 4) 东财在线搜索兜底（云端环境通常不可达，保留作异地部署时增强）
  try {
    const url = `https://suggest.cls.cn/api/suggest?keyword=${encodeURIComponent(kw)}&type=1`;
    const j = await fetchJSON(url, 4000, 0);
    const list2 = (j.data || []).map(x => ({ code: String(x.code || '').replace(/\D/g, ''), name: x.name }))
      .filter(x => /^\d{6}$/.test(x.code)).slice(0, 8);
    if (list2.length) return list2;
  } catch (e) {}
  return [];
}

// ===================== 全市场实时监测 =====================
// 多源优先级：腾讯财经(主) → 新浪财经(备)。同花顺免费公开行情已失效(404)，不再依赖。
const STOCK_LIST = loadStockList();
function loadStockList() {
  try { return require('../data/stocks.json'); } catch (e) {
    try { return require('./data/stocks.json'); } catch (e2) { return []; }
  }
}

function livePrefix(code) {
  const c = code[0];
  if (c === '6' || c === '9') return 'sh';
  if (c === '8' || c === '4') return 'bj'; // 北交所
  return 'sz';
}

function parseGtimgTime(s) {
  if (!s || s.length < 14) return null;
  const y = s.slice(0, 4), mo = s.slice(4, 6), d = s.slice(6, 8),
        h = s.slice(8, 10), mi = s.slice(10, 12), se = s.slice(12, 14);
  const t = new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
  return isNaN(t) ? null : t;
}
function parseSinaTime(date, time) {
  if (!date || !time) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi, se] = time.split(':').map(Number);
  const t = new Date(y, mo - 1, d, h, mi, se).getTime();
  return isNaN(t) ? null : t;
}

function parseTencentBatch(txt, codes) {
  const map = {};
  const re = /v_(\w+)="(.*)"/g; let m;
  while ((m = re.exec(txt)) !== null) {
    const key = m[1];                       // 如 sh600519
    const code = key.replace(/^(sh|sz|bj)/, '');
    const a = m[2].split('~');
    const price = parseFloat(a[3]);
    const prevClose = parseFloat(a[4]);
    let changePct = parseFloat(a[32]);
    if (!isFinite(changePct) && prevClose) changePct = (price - prevClose) / prevClose * 100;
    const high = parseFloat(a[33]), low = parseFloat(a[34]);
    const amp = (high && low && prevClose) ? (high - low) / prevClose * 100 : 0;
    map[code] = {
      code,
      // 名称优先取本地全市场清单（腾讯返回GBK名，Node按UTF-8读会乱码）
      name: (STOCK_LIST.find(x => x.code === code) || {}).name || NAME_MAP[code] || a[1] || code,
      price, prevClose,
      changePct: isFinite(changePct) ? +changePct.toFixed(2) : 0,
      amp: +amp.toFixed(2),
      // 评分用扩展字段：成交量(手)/成交额(万)/换手率%/PE/量比/总市值(亿)/PB/均价
      volume: parseFloat(a[36]) || 0,
      amount: parseFloat(a[37]) || 0,
      turnover: parseFloat(a[38]) || 0,
      pe: parseFloat(a[39]) || 0,
      volRatio: parseFloat(a[49]) || 0,
      totalMktCap: parseFloat(a[45]) || 0,
      pb: parseFloat(a[46]) || 0,
      avgPrice: parseFloat(a[51]) || 0,
      time: parseGtimgTime(a[30])
    };
  }
  return map;
}

function parseSinaBatch(txt, codes) {
  const map = {};
  const re = /hq_str_(\w+)="(.*)"/g; let m;
  while ((m = re.exec(txt)) !== null) {
    const key = m[1];
    const code = key.replace(/^(sh|sz|bj)/, '');
    const a = m[2].split(',');
    if (a.length < 6) continue;
    const price = parseFloat(a[3]);
    const prevClose = parseFloat(a[2]);
    const changePct = prevClose ? (price - prevClose) / prevClose * 100 : 0;
    const high = parseFloat(a[4]), low = parseFloat(a[5]);
    const amp = (high && low && prevClose) ? (high - low) / prevClose * 100 : 0;
    map[code] = {
      code,
      // 名称优先取本地全市场清单（新浪返回GBK名，Node按UTF-8读会乱码）
      name: (STOCK_LIST.find(x => x.code === code) || {}).name || NAME_MAP[code] || a[0] || code,
      price, prevClose,
      changePct: +changePct.toFixed(2), amp: +amp.toFixed(2),
      // 评分用扩展字段（新浪字段较少，量比/换手缺失时评分按缺失处理）
      volume: parseFloat(a[8]) / 100 || 0,          // 股 → 手
      amount: parseFloat(a[9]) / 1e4 || 0,          // 元 → 万
      turnover: 0, volRatio: 0, pe: 0, totalMktCap: 0, pb: 0, avgPrice: 0,
      time: parseSinaTime(a[30], a[31])
    };
  }
  return map;
}

// 带重试的文本抓取（应对云端环境对部分域名偶发超时/限流）
async function fetchText(url, referer, timeout = 9000, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': referer }, signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

async function getLiveQuotes(codes) {
  if (!codes.length) return { source: 'none', map: {} };
  const tc = codes.map(c => livePrefix(c) + c).join(',');
  try {
    const txt = await fetchText('https://qt.gtimg.cn/q=' + tc, 'https://gu.qq.com/');
    const map = parseTencentBatch(txt, codes);
    if (Object.keys(map).length >= codes.length * 0.4) return { source: 'tencent', map };
  } catch (e) {}
  // 新浪兜底
  try {
    const sc = codes.map(c => livePrefix(c) + c).join(',');
    const txt = await fetchText('https://hq.sinajs.cn/list=' + sc, 'https://finance.sina.com.cn');
    const map = parseSinaBatch(txt, codes);
    if (Object.keys(map).length) return { source: 'sina', map };
  } catch (e) {}
  return { source: 'none', map: {} };
}

// 全市场快照（服务端缓存 60s，保证延迟 < 5 分钟）
let _marketCache = null, _marketCacheTs = 0;

async function mapLimit(items, limit, fn) {
  const ret = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { ret[idx] = await fn(items[idx]); } catch (e) { ret[idx] = null; }
    }
  });
  await Promise.all(workers);
  return ret.filter(Boolean);
}

async function getMarketSnapshot(force = false) {
  const now = Date.now();
  if (!force && _marketCache && now - _marketCacheTs < 60000) return _marketCache;
  if (!STOCK_LIST.length) return { updatedAt: now, count: 0, total: 0, source: 'none', stocks: [] };
  const chunks = [];
  for (let i = 0; i < STOCK_LIST.length; i += 100) chunks.push(STOCK_LIST.slice(i, i + 100).map(s => s.code));
  const parts = await mapLimit(chunks, 8, async (chk) => {
    try { const { map } = await getLiveQuotes(chk); return map; } catch (e) { return {}; }
  });
  const merged = {};
  parts.forEach(p => { if (p) Object.assign(merged, p); });
  const stocks = STOCK_LIST.map(s => merged[s.code]).filter(Boolean)
    .map(q => ({ code: q.code, name: q.name, price: q.price, prevClose: q.prevClose, changePct: q.changePct, amp: q.amp, time: q.time,
      volume: q.volume || 0, amount: q.amount || 0, turnover: q.turnover || 0, pe: q.pe || 0,
      volRatio: q.volRatio || 0, totalMktCap: q.totalMktCap || 0, pb: q.pb || 0, avgPrice: q.avgPrice || 0 }));
  const snap = { updatedAt: now, count: stocks.length, total: STOCK_LIST.length, source: 'tencent', stocks };
  _marketCache = snap; _marketCacheTs = now;
  return snap;
}

async function getMarketView(mode = 'up', limit = 30, force = false, top = 300) {
  if (mode === 'score') {
    // 实时评分榜：全市场按快照评分（今日走势）降序
    const snap = await getMarketSnapshot(force);
    const stocks = snap.stocks.map(q => ({ ...q, ...computeQuoteScore(q) }))
      .sort((a, b) => b.score - a.score).slice(0, limit);
    const up = snap.stocks.filter(x => x.changePct > 0).length;
    const down = snap.stocks.filter(x => x.changePct < 0).length;
    return {
      ok: true, updatedAt: snap.updatedAt, count: stocks.length, total: snap.total, source: snap.source, mode,
      breadth: { up, down, flat: snap.stocks.length - up - down, upRatio: snap.stocks.length ? +(up / snap.stocks.length * 100).toFixed(1) : 0 },
      stocks
    };
  }
  if (mode === 'score_deep') {
    // 综合评分榜：快照评分（今日走势55%）+ 短期K线技术分（45%），含拉K线约10-20秒，缓存10分钟
    const board = await getMarketScoreBoard(limit, top, force);
    return { ok: true, updatedAt: board.updatedAt, count: board.stocks.length, total: board.total, source: board.source, mode, stocks: board.stocks };
  }
  const snap = await getMarketSnapshot(force);
  const s = snap.stocks;
  let stocks;
  if (mode === 'down') stocks = [...s].sort((a, b) => a.changePct - b.changePct).slice(0, limit);
  else if (mode === 'amp') stocks = [...s].sort((a, b) => b.amp - a.amp).slice(0, limit);
  else stocks = [...s].sort((a, b) => b.changePct - a.changePct).slice(0, limit);
  const up = s.filter(x => x.changePct > 0).length;
  const down = s.filter(x => x.changePct < 0).length;
  const flat = s.length - up - down;
  const limitUp = s.filter(x => x.changePct >= 9.9).length;
  const limitDown = s.filter(x => x.changePct <= -9.9).length;
  return {
    ok: true, updatedAt: snap.updatedAt, count: snap.count, total: snap.total, source: snap.source,
    breadth: {
      up, down, flat, limitUp, limitDown,
      upRatio: s.length ? +(up / s.length * 100).toFixed(1) : 0
    },
    mode, stocks
  };
}

// 启动时可调用：最佳努力刷新股票清单（不阻塞）
async function refreshStockList(REPORT = 'RPT_DMSK_TS_STOCKNEW', COLUMNS = 'SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_MARKET_CODE', PAGE_SIZE = 500) {
  try {
    let all = []; let page = 1;
    while (true) {
      const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${REPORT}&columns=${COLUMNS}&pageSize=${PAGE_SIZE}&pageNumber=${page}&sortColumns=SECURITY_CODE&sortTypes=1`;
      const j = await fetchJSON(url, 12000, 1);
      const list = (j.result && j.result.data) || [];
      if (!Array.isArray(list) || !list.length) break;
      all = all.concat(list);
      if (list.length < PAGE_SIZE) break;
      if (page++ > 60) break;
    }
    const out = all.map(x => {
      const code = String(x.SECURITY_CODE).trim();
      const name = String(x.SECURITY_NAME_ABBR || '').replace(/\s/g, '');
      return { code, name, prefix: code[0] === '6' || code[0] === '9' ? 'sh' : 'sz' };
    }).filter(x => /^\d{6}$/.test(x.code) && x.name);
    const seen = new Set(); const dedup = out.filter(x => { if (seen.has(x.code)) return false; seen.add(x.code); return true; });
    if (dedup.length > 1000) {
      STOCK_LIST.length = 0; dedup.forEach(x => STOCK_LIST.push(x));
      const fs = require('fs'), path = require('path');
      fs.writeFileSync(path.join(__dirname, '..', 'data', 'stocks.json'), JSON.stringify(dedup));
      _marketCache = null; _marketCacheTs = 0;
    }
  } catch (e) {}
}

module.exports = { analyze, resolveSecid, search, getLiveQuotes, getMarketSnapshot, getMarketView, refreshStockList, STOCK_LIST, computeQuoteScore, computeDeepScore, computeShortTermScore, getMarketScoreBoard };
