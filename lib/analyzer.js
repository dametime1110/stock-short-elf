// 股票短线精灵 · 核心分析模块（服务端）
// 数据来源：东方财富免费公开接口（无需 key / 权限）
// 筹码峰：由 K线 + 成交量按 CYQ 模型自算
// 短评：内置 4 只样本股 AI 范例（hy3/step5）；其余股票走规则速评

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const fs = require('fs');
const path = require('path');

async function fetchJSON(url, timeout = 8000, retries = 2, referer = 'https://quote.eastmoney.com/') {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': referer },
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

// ===== 当日数据缓存（2026-10-20 新增）=====
// 分时/资金流：盘中实时、收盘后定格。数据源间歇性限流时，缓存保证"当天成功过一次就一直可见"，
// 同时避免同一股票反复打开时重复打接口（减轻限流）。盘中 TTL 2 分钟保鲜；收盘后缓存到次日 9:20。
const _dayCache = new Map();
function _tradeDay(now = Date.now()) {
  const d = new Date(now - (9 * 3600 + 15 * 60) * 1000);   // 凌晨0-9:15仍归属上一交易日（盘前）
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
function _cacheTtlMs(now = Date.now()) {
  const d = new Date(now), h = d.getHours() + d.getMinutes() / 60;
  if (h >= 15.2) {                                          // 收盘后：数据定格，缓存到次日9:20
    const next = new Date(d); next.setDate(next.getDate() + 1); next.setHours(9, 20, 0, 0);
    return Math.max(3600e3, next.getTime() - now);
  }
  return 120e3;                                             // 盘中 2 分钟
}
function _cacheGet(key, now = Date.now(), ttlOverride = null) {
  const e = _dayCache.get(key);
  if (!e) return null;
  const ttl = ttlOverride != null ? ttlOverride : _cacheTtlMs(now);
  if (now - e.t > ttl) { _dayCache.delete(key); return null; }
  return e.val;
}
function _cacheSet(key, val, now = Date.now()) {
  if (_dayCache.size > 800) _dayCache.clear();
  _dayCache.set(key, { t: now, val });
}
const _sleep = ms => new Promise(s => setTimeout(s, ms));

// ===== 资金流预热刷新（2026-10-20 新增）=====
// 东财资金流接口间歇性限流（时通时断）。缓存会抓住放行窗口，但用户"打开那一刻"可能正处限流期。
// 对策：常驻服务盘中每5分钟后台重试"最近访问过的股票"，放行窗口一旦出现就写入当日缓存，
// 用户随后打开即可命中（与自选股场景天然匹配：看过的票才会反复看）。
const _recentSecids = [];
function _noteSecid(secid) {
  if (!secid) return;
  const i = _recentSecids.indexOf(secid);
  if (i >= 0) _recentSecids.splice(i, 1);
  _recentSecids.unshift(secid);
  if (_recentSecids.length > 30) _recentSecids.pop();
}
let _hotTimer = null;
function startHotFlowRefresh() {
  if (_hotTimer) return;
  _hotTimer = setInterval(async () => {
    const now = new Date();
    const day = now.getDay(), h = now.getHours() + now.getMinutes() / 60;
    if (day === 0 || day === 6) return;          // 周末不开盘
    if (h < 9 || h > 15.5) return;               // 仅盘中/尾盘时段
    const list = _recentSecids.slice(0, 12);
    for (let i = 0; i < list.length; i += 2) {   // 低并发，避免加剧限流
      await Promise.all(list.slice(i, i + 2).map(s => getFlow(s).catch(() => { })));
      await _sleep(1500);
    }
  }, 5 * 60 * 1000);
  if (_hotTimer.unref) _hotTimer.unref();        // 不阻塞进程退出
}

async function getFlow(secid, lmt = 20) {
  const empty = { mainNetInflow: null, mainNetInflow5d: null, trend: [] };
  const ck = secid + '|flow|' + _tradeDay();
  const cached = _cacheGet(ck);
  if (cached) return cached;
  // 公开免费资金流源仅东财一家（腾讯ff_已失效、新浪/雪球无免费接口），但其 push2 系接口间歇性限流。
  // 策略：四入口轮换（his/主站/延迟域 × 两种报表路径），单轮快速失败（约3-4秒），失败短缓存30秒防请求风暴；
  // 成功则当日缓存（盘中2分钟/盘后到次日），自选股反复打开不重复请求。
  const entries = [
    `https://push2his.eastmoney.com/api/qt/stock/fflow/kline/get?lmt=${lmt}&klt=101&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56&secid=${secid}`,
    `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=${lmt}&klt=101&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&secid=${secid}`,
    `https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=${lmt}&klt=101&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&secid=${secid}`,
    `https://push2delay.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=${lmt}&klt=101&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&secid=${secid}`
  ];
  for (let i = 0; i < entries.length; i++) {
    try {
      const j = await fetchJSON(entries[i], 6000, 0, 'https://quote.eastmoney.com/');
      if (j && j.data && Array.isArray(j.data.klines) && j.data.klines.length) {
        // klines 每行=日期,主力,小单,中单,大单,超大单（元）
        const arr = j.data.klines.map(line => { const a = String(line).split(','); return { date: a[0], main: +a[1] }; }).reverse(); // 旧->新
        const mainNetInflow = arr.length ? arr[arr.length - 1].main : null;
        const last5 = arr.slice(-5).reduce((s, x) => s + x.main, 0);
        const out = { mainNetInflow, mainNetInflow5d: last5, trend: arr.map(x => x.main) };
        _cacheSet(ck, out);
        return out;
      }
    } catch (e) {}
    await _sleep(200 * (i + 1));
  }
  // 全失败：短缓存30秒（防用户连续打开时反复打接口加剧限流），返回空（前端显示"—"不崩）
  _cacheSet(ck, empty);
  _dayCache.get(ck).t = Date.now() - (_cacheTtlMs() - 30000);
  return empty;
}

// ===== 当天分时数据（2026-10-20 重构为三源）=====
// 源1 腾讯 minute（实测5/5稳定）；源2 新浪1分钟K线（实测5/5稳定，带高低价）；源3 东财 trends2（间歇可达保底）
// 用途：分时走势 + 量价关系 + 均价线关系 → 盘中形态判定（拉升/洗盘/吸筹/出货）；盘后三源均返回全天完整数据
async function getIntraday(secid, prevCloseFallback = null) {
  const tc = toTencentCode(secid);
  const ck = secid + '|intraday|' + _tradeDay();
  const cached = _cacheGet(ck);
  if (cached) {
    // 收盘后若命中的是「盘中残缺」缓存（最后时间早于当天收盘），则视为无效，重新取整日定格数据
    const now = Date.now();
    const closed = (new Date(now).getHours() + new Date(now).getMinutes() / 60) >= 15.2;
    const lastT = (cached.points[cached.points.length - 1] || {}).t || '00:00';
    if (!(closed && /^\d{2}:\d{2}$/.test(lastT) && lastT < '15:00')) return cached;
  }
  const finish = (val) => { if (val) _cacheSet(ck, val); return val; };
  // 源1：腾讯 minute query —— 每项 "HHMM 价格 累计量(手) 累计额(元)"，量需差分，均价=累计额/(累计量*100)
  try {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${tc}`;
    const j = await fetchJSON(url, 8000, 1);
    const node = j && j.data && j.data[tc];
    const arr = node && node.data && node.data.data;
    if (arr && arr.length > 5) {
      const pts = [];
      let lastV = 0;
      for (const s of arr) {
        const parts = String(s).trim().split(/\s+/);
        const t = parts[0], p = +parts[1], cumV = +parts[2], cumAmt = +parts[3];
        if (!/^\d{4}$/.test(t) || !isFinite(p)) continue;
        const v = Math.max(0, cumV - lastV); lastV = cumV;
        const avg = cumV > 0 ? cumAmt / (cumV * 100) : p;
        pts.push({ t: t.slice(0, 2) + ':' + t.slice(2), p, h: p, l: p, v, amt: cumAmt, avg });
      }
      if (pts.length > 5) {
        return finish({ date: node.data.date || null, prevClose: prevCloseFallback ?? null, source: 'tencent', points: pts });
      }
    }
  } catch (e) {}
  // 源2：新浪 1分钟K线 —— 每根 {day:"YYYY-MM-DD HH:MM",open,high,low,close,volume(股),amount(元)}；分钟量=差分/100(股→手)，均价=累计额/(累计量*100)
  // ⚠️ 新浪 datalen=320 返回的是「最近320分钟」会跨天（昨尾盘+今全天），必须按交易日过滤并重置当日累计基准，否则昨天数据混入+均价跨天污染
  try {
    const code = secid.split('.')[1];
    const sym = secid.startsWith('1.') ? 'sh' + code : code.startsWith('8') || code.startsWith('4') ? 'bj' + code : 'sz' + code;
    const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${sym}&scale=1&ma=no&datalen=320`;
    const j = await fetchJSON(url, 8000, 1, 'https://finance.sina.com.cn');
    if (Array.isArray(j) && j.length > 5) {
      const today = _tradeDay();
      const pts = [];
      let lastV = 0, cumAmt = 0, cumV = 0, date = null, started = false;
      for (const k of j) {
        const day = String(k.day || '');
        const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2}):00$/.exec(day);
        if (!m) continue;
        if (m[1].replace(/-/g, '') !== today) { started = false; lastV = 0; cumAmt = 0; cumV = 0; continue; } // 跳过非当天（昨天尾盘），重置累计
        if (!started) { started = true; lastV = 0; cumAmt = 0; cumV = 0; } // 当天第一根重置基准，均价从头算
        date = m[1];
        const p = +k.close, v = Math.max(0, (+k.volume - lastV)) / 100; lastV = +k.volume;
        cumAmt += +k.amount || 0; cumV += +k.volume || 0;
        const avg = cumV > 0 ? cumAmt / (cumV * 100) : p;
        pts.push({ t: m[2] + ':' + m[3], p, h: +k.high || p, l: +k.low || p, v, amt: cumAmt, avg });
      }
      if (pts.length > 5) {
        return finish({ date: date ? date.replace(/-/g, '') : null, prevClose: prevCloseFallback ?? null, source: 'sina', points: pts });
      }
    }
  } catch (e) {}
  // 源3：东财 trends2（间歇可达）—— trends 每项 "时间,价,高,低,量(手),额,均价"
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`;
    const j = await fetchJSON(url, 8000, 1);
    const d = j && j.data;
    if (d && Array.isArray(d.trends) && d.trends.length > 5) {
      const pts = [];
      for (const line of d.trends) {
        const a = String(line).split(',');
        const t = (a[0] || '').slice(11, 16); // "HH:MM"
        const p = +a[1], h = +a[2], l = +a[3], v = +a[4], amt = +a[5], avg = +a[6];
        if (!/^\d{2}:\d{2}$/.test(t) || !isFinite(p)) continue;
        pts.push({ t, p, h: isFinite(h) ? h : p, l: isFinite(l) ? l : p, v: isFinite(v) ? v : 0, amt: isFinite(amt) ? amt : 0, avg: isFinite(avg) && avg > 0 ? avg : p });
      }
      if (pts.length > 5) {
        return finish({ date: String(d.trends[0] || '').slice(0, 10), prevClose: d.preClose || prevCloseFallback || null, source: 'eastmoney', points: pts });
      }
    }
  } catch (e) {}
  return null;
}

// 分时特征提取：均价线关系 + 走势形状 + 量价关系
// baselineVol：近期日均成交量（由K线近5日均量提供，用于"当日是否放量"判断；无则为null）
// prevCloseFallback：分时源自带昨收缺失时（腾讯备源）的兜底昨收（实时快照的昨收）
function analyzeIntraday(series, baselineVol = null, prevCloseFallback = null) {
  const pts = (series && series.points) || [];
  const N = pts.length;
  if (N < 20) return null;
  const prices = pts.map(x => x.p), vols = pts.map(x => x.v), avgs = pts.map(x => x.avg);
  const prevClose = series.prevClose || prevCloseFallback || prices[0];
  const last = prices[N - 1];
  const hi = Math.max(...prices), lo = Math.min(...prices);
  const hiIdx = prices.indexOf(hi), loIdx = prices.indexOf(lo);
  const totalVol = vols.reduce((a, b) => a + b, 0);
  const avgVol = totalVol / N || 1;
  const chgPct = (last / prevClose - 1) * 100;
  const ampPct = (hi - lo) / prevClose * 100;
  let f = { n: N, prevClose, last, hi, lo, chgPct: +chgPct.toFixed(2), ampPct: +ampPct.toFixed(2), totalVol };
  f.volRatioDay = baselineVol > 0 ? +(totalVol / baselineVol).toFixed(2) : null; // 当日总量 vs 近期日均量

  // —— 均价线关系 ——
  let above = 0;
  for (let i = 0; i < N; i++) if (prices[i] > avgs[i] * 1.0005) above++;
  f.aboveRatio = +(above / N).toFixed(3);
  f.biasNow = +((last / avgs[N - 1] - 1) * 100).toFixed(2);            // 现价对均价乖离
  const third = Math.max(5, Math.floor(N / 3));
  const vwEarly = avgs.slice(0, third).reduce((a, b) => a + b, 0) / third;
  const vwLate = avgs.slice(-third).reduce((a, b) => a + b, 0) / third;
  f.vwapSlope = +((vwLate / vwEarly - 1) * 100).toFixed(2);           // 均价线日内方向（正=抬升）
  let dips = 0, wasAbove = prices[0] > avgs[0];
  for (let i = 1; i < N; i++) {
    const nowAbove = prices[i] > avgs[i];
    if (wasAbove && !nowAbove) dips++;                                 // 每次从上方跌破记1次
    wasAbove = nowAbove;
  }
  f.dips = dips;

  // —— 分时走势形状 ——
  f.open30 = +((prices[Math.min(29, N - 1)] / prices[0] - 1) * 100).toFixed(2);   // 开盘半小时
  f.late30 = N > 30 ? +((last / prices[N - 31] - 1) * 100).toFixed(2) : 0;        // 尾盘半小时
  const seg = Math.floor(N / 4), segMeans = [0, 1, 2, 3].map(i => {
    const s = pts.slice(i * seg, (i + 1) * seg); return s.reduce((a, b) => a + b.p, 0) / s.length;
  });
  f.segTrend = +((segMeans[3] / segMeans[0] - 1) * 100).toFixed(2);    // 价格重心前1/4 → 后1/4
  f.segRising = segMeans.filter((v, i) => i > 0 && v > segMeans[i - 1]).length;   // 递升段数 0-3
  f.spikeFade = hiIdx < N * 0.7 && (last / hi - 1) < -0.015;           // 冲高回落（高点在前70%时段）
  f.dipRecover = loIdx > N * 0.05 && loIdx < N * 0.7 && (last / lo - 1) > 0.012 && !f.closeNearHi; // 探底回升（低点非开盘附近，且未收在最高=不是单边拉升）

  // —— 量价关系 ——
  let upSum = 0, upCnt = 0, dnSum = 0, dnCnt = 0, newHighVol = 0, spikes = 0;
  let runHi = prices[0];
  for (let i = 1; i < N; i++) {
    const chg = prices[i] - prices[i - 1];
    if (chg > 0) { upSum += vols[i]; upCnt++; } else if (chg < 0) { dnSum += vols[i]; dnCnt++; }
    if (prices[i] > runHi) { runHi = prices[i]; if (vols[i] > avgVol * 1.2) newHighVol++; }
    if (vols[i] > avgVol * 2.5) spikes++;                                // 脉冲巨量分钟
  }
  f.upVolRatio = upCnt ? +(upSum / upCnt / avgVol).toFixed(2) : 1;      // 涨时放量率
  f.downVolRatio = dnCnt ? +(dnSum / dnCnt / avgVol).toFixed(2) : 1;    // 跌时放量率
  f.newHighVol = newHighVol;                                            // 创新高且放量次数（量价齐升）
  f.spikes = spikes;                                                    // 巨量脉冲次数
  f.flat = Math.abs(chgPct) < 1;                                        // 全天涨跌幅有限
  f.closeNearHi = (last / hi - 1) > -0.006;                             // 收在最高附近
  f.lateVolRatio = N > 30 ? +(vols.slice(-30).reduce((a, b) => a + b, 0) / 30 / avgVol).toFixed(2) : 1; // 尾盘30分钟量能强度
  f.aboveAvgNow = last > avgs[N - 1];
  f.stableVol = f.upVolRatio > 0.85 && f.upVolRatio < 1.35 && f.spikes <= 1; // 量能温和无脉冲
  return f;
}

// ===== 分时量价推算资金净额（2026-10-20）=====
// 背景：公开免费"主力资金流"全网仅东财一家且对云端限流（时通时断），
// 而分时数据（腾讯/新浪）实测 5/5 稳定。本函数用分钟级"主动买卖失衡"模型
// 从分时序列推算全天资金净额——口径与东财主力资金流不同（东财按逐笔单量
// 拆分大单，本模型按分钟K线涨跌归类主动买卖），但同向反映资金进出强弱，
// 且 100% 跟随稳定数据源，作为东财不可用时的替代视图（前端会标注"推算"）。
// 算法：分钟收阳 → 该分钟成交量全部计为"主动买"；收阴 → 全部计为"主动卖"；
//       平盘 → 对半。净额 = (主动买量 - 主动卖量) × 100股/手 × 分钟均价。
//       强度分 = 净额 / 全天成交额 × 100（-100 ~ +100）。
function estimateFlowFromIntraday(series) {
  if (!series || !Array.isArray(series.points) || series.points.length < 20) return null;
  const pts = series.points;
  let buyVol = 0, sellVol = 0, totalAmt = 0, totalVol = 0;
  let buyAmt = 0, sellAmt = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = i > 0 ? pts[i - 1].p : (series.prevClose || p.p);
    const chg = p.p - prev;
    const v = Math.max(0, p.v || 0);
    // 注意：不能直接用 p.amt——各源口径不同（腾讯源 amt 是累计成交额，东财源是分钟额），
    // 统一用"分钟均价 × 分钟量"重算分钟成交额，保证净额量级正确
    const amt = (p.avg || p.p) * v * 100;
    totalVol += v; totalAmt += amt;
    if (chg > 0.0001) { buyVol += v; buyAmt += amt; }
    else if (chg < -0.0001) { sellVol += v; sellAmt += amt; }
    else { buyVol += v / 2; sellVol += v / 2; buyAmt += amt / 2; sellAmt += amt / 2; }
  }
  if (totalVol <= 0 || totalAmt <= 0) return null;
  // 净额估算：以均价计价的（买-卖）成交金额差
  const estInflow = buyAmt - sellAmt;
  const estPct = +(estInflow / totalAmt * 100).toFixed(2);
  const level = estPct >= 12 ? 'strong_in' : estPct >= 4 ? 'in' : estPct > -4 ? 'balanced'
    : estPct > -12 ? 'out' : 'strong_out';
  return {
    est: true,
    estInflow: Math.round(estInflow),
    estPct,
    level,
    levelLabel: { strong_in: '资金明显流入', in: '资金温和流入', balanced: '资金进出均衡', out: '资金温和流出', strong_out: '资金明显流出' }[level],
    buyRatio: +(buyVol / totalVol * 100).toFixed(1),
    totalAmt: Math.round(totalAmt)
  };
}

// 分时形态判定：拉升 / 洗盘 / 吸筹 / 出货 / 中性（全部规则透明可解释，命中≥2条才下结论）
const INTRA_PATTERN = {
  rally:        { label: '拉升', icon: '🚀', hint: '量价齐升、站稳均价线，走势健康。沿均价线持有，尾盘不破均价可留；追高者等回踩均价不破再上。' },
  washout:      { label: '洗盘', icon: '🧹', hint: '缩量回踩、破均价能收回，浮筹清洗特征。守住均价线上方可持，放量跌破均价再减仓。' },
  accumulation: { label: '吸筹', icon: '🕵️', hint: '窄幅粘合+温和量，主力低调吸筹。可轻仓跟随埋伏，放量长阳启动再加，跌破均价止损。' },
  distribution: { label: '出货', icon: '⚠️', hint: '冲高回落/放量滞涨/尾盘跳水，主力借拉高派发嫌疑。持仓者反抽减仓，勿在均价线下方接货。' },
  neutral:      { label: '方向不明', icon: '😑', hint: '多空信号交织，等方向明确（放量突破站上均价 / 放量跌破均价）再动手。' }
};
function judgeIntradayPattern(f) {
  if (!f) return null;
  const ev = [];
  // hit() 返回证据对象本身（truthy），组内存对象，便于原样展示；distN 等用 .hit 统计
  const hit = (t, d, ok) => { const o = { t, d, hit: !!ok }; ev.push(o); return o; };
  // —— 出货（派发）——
  const dist = [];
  dist.push(hit('冲高回落', `高点${f.hi}出现在前${Math.round(f.hiIdx / f.n * 100)}%时段，现价距高点-${((1 - f.last / f.hi) * 100).toFixed(1)}%`, f.spikeFade));
  dist.push(hit('尾盘跳水', `尾盘半小时${f.late30 > 0 ? '+' : ''}${f.late30}%`, f.late30 < -1));
  dist.push(hit('尾盘放量', `尾盘半小时均量为全天${f.lateVolRatio}倍`, f.late30 < -0.8 && f.lateVolRatio > 1.2));
  dist.push(hit('失守均价', `站上均价时长仅${Math.round(f.aboveRatio * 100)}%且均价线下行${f.vwapSlope}%`, f.aboveRatio < 0.42 && f.vwapSlope < -0.15));
  dist.push(hit('深度破均', `现价低于均价${Math.abs(f.biasNow)}%、站上均价时长仅${Math.round(f.aboveRatio * 100)}%`, f.biasNow < -1.5 && f.aboveRatio < 0.5));
  dist.push(hit('放量下跌', `跌时放量率${f.downVolRatio}（>1.1为放量）`, f.downVolRatio > 1.1 && f.chgPct < 0.5));
  dist.push(hit('放量滞涨', `当日量为近期日均${f.volRatioDay ?? '?'}倍、巨量脉冲${f.spikes}次，涨跌幅仅${f.chgPct}%`, f.flat && (f.spikes >= 2 || (f.volRatioDay != null && f.volRatioDay > 1.3))));
  const distN = dist.filter(x => x.hit).length;
  // —— 洗盘 ——
  const wash = [];
  wash.push(hit('破均价能收回', `跌破均价${f.dips}次，现价${f.aboveAvgNow ? '站回均价上方' : '仍在均价下方'}`, f.dips >= 1 && f.aboveAvgNow));
  wash.push(hit('跌时缩量', `跌时放量率${f.downVolRatio}（<0.88为缩量）`, f.downVolRatio < 0.88));
  wash.push(hit('探底回升', `低点${f.lo}，现价距低点+${((f.last / f.lo - 1) * 100).toFixed(1)}%`, f.dipRecover));
  wash.push(hit('尾盘不弱', `尾盘半小时${f.late30 > 0 ? '+' : ''}${f.late30}%`, f.late30 > -0.3 || f.closeNearHi));
  const washN = wash.filter(x => x.hit).length;
  // —— 吸筹（必须含方向确认：重心微升 或 粘合均价，避免随机横盘误报）——
  const accu = [];
  accu.push(hit('窄幅横盘', `日内振幅${f.ampPct}%（<2.5为窄幅）`, f.ampPct < 2.5));
  const accuGlue = hit('粘合均价', `站上均价时长${Math.round(f.aboveRatio * 100)}%（45-62%为粘合）`, f.aboveRatio >= 0.45 && f.aboveRatio <= 0.62);
  accu.push(accuGlue);
  accu.push(hit('量能温和', `涨时放量率${f.upVolRatio}、巨量脉冲${f.spikes}次`, f.stableVol));
  const accuUp = hit('重心微升', `价格重心${f.segTrend > 0 ? '+' : ''}${f.segTrend}%、尾盘${f.late30 > 0 ? '+' : ''}${f.late30}%`, f.segTrend > 0.05 || f.late30 > 0.2);
  accu.push(accuUp);
  const accuN = accu.filter(x => x.hit).length;
  // 吸筹=还没启动：涨幅有限、贴近均价（未远离）——避免大涨/远离均价的票被误判吸筹
  const accuConfirmed = accuN >= 2 && (accuGlue.hit || accuUp.hit) && f.chgPct < 2.5 && f.aboveRatio < 0.75;
  // —— 拉升 ——
  const ral = [];
  ral.push(hit('站稳均价', `站上均价时长${Math.round(f.aboveRatio * 100)}%、均价线抬升${f.vwapSlope}%`, f.aboveRatio > 0.68 && f.vwapSlope > 0.1));
  ral.push(hit('涨时放量', `涨时放量率${f.upVolRatio}、创新高放量${f.newHighVol}次`, f.upVolRatio > 1.08 || f.newHighVol >= 2));
  ral.push(hit('量价正相关', `现价涨幅${f.chgPct}%`, f.chgPct > 1));
  const ralN = ral.filter(x => x.hit).length;

  // 汇总：出货→洗盘→吸筹→拉升 优先级，命中≥2条才定型；否则中性（宁可观望不乱扣帽子）
  let pattern = 'neutral', score = 50, group = ev;
  const pick = (key, n, arr, base) => { pattern = key; score = Math.min(95, base + n * 12); group = arr; };
  if (distN >= 2) pick('distribution', distN, dist, 55);
  else if (washN >= 2) pick('washout', washN, wash, 55);
  else if (accuConfirmed) pick('accumulation', accuN, accu, 55);
  else if (ralN >= 2) pick('rally', ralN, ral, 55);
  const meta = INTRA_PATTERN[pattern];
  return { pattern, label: meta.label, icon: meta.icon, score, hint: meta.hint, evidence: group, metrics: f };
}

// 个股近期资讯：东财搜索接口（按股票名称检索，返回真实新闻+摘要）
// 注：东财公告接口 np-anotice-stock 的 secid 参数已失效（返回全市场流），故改用搜索接口
// 稳定性：东财搜索接口间歇限流 → 加"内存+落盘"双缓存，成功一次当天常驻；
//   限流取不到时回退缓存（标注 stale），完全取不到才标 limited（前端显示"限流中"而非误导的"暂无公告"）
// 排序：立案/调查/处罚/减持等利空关键词提到最前，确保重大消息不被淹没
const _NEWS_CACHE_FILE = path.join(__dirname, '..', 'data', 'news_cache.json');
let _newsCache = {};
try { _newsCache = JSON.parse(fs.readFileSync(_NEWS_CACHE_FILE, 'utf8') || '{}'); } catch (e) { _newsCache = {}; }
const NEWS_TTL = 30 * 60 * 1000; // 30 分钟内不重复抓东财（降低限流暴露）
const _NEWS_NEG = ['立案', '调查', '处罚', '警示', '问询', '退市', '减持', '诉讼', '违规', '预亏', '下修', '商誉', '停牌', '风险', 'ST'];
function _newsWeight(n) {
  const t = n.title || '';
  let w = 0;
  for (const k of _NEWS_NEG) if (t.includes(k)) w += 100;       // 利空关键词强提权
  const d = n.date || '';
  const days = (Date.now() - new Date(d.replace(/-/g, '/')).getTime()) / 86400000;
  w += Math.max(0, 30 - (isNaN(days) ? 0 : days));              // 越新越靠前
  return w;
}
function _saveNewsCache() {
  try { fs.writeFileSync(_NEWS_CACHE_FILE, JSON.stringify(_newsCache)); } catch (e) { /* 落盘失败不影响内存缓存 */ }
}
// 返回 { list, limited, stale }：limited=真取不到(应提示限流)、stale=用的是限流前缓存(可能非最新)
async function getNews(stockName) {
  const name = String(stockName || '').trim();
  if (!name || /^\d+$/.test(name)) return { list: [], limited: false, stale: false };
  const now = Date.now();
  const cached = _newsCache[name];
  if (cached && (now - cached.ts) < NEWS_TTL) return { list: cached.list, limited: false, stale: false };
  const param = encodeURIComponent(JSON.stringify({
    keyword: name, type: ['cmsArticleWebOld'], pageindex: 1, pagesize: 6, searchtype: 1
  }));
  const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${param}`;
  try {
    const txt = await fetchText(url, 'https://so.eastmoney.com/', 10000, 2); // 云端偶发抖动，多重试
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no json');
    const j = JSON.parse(m[0]);
    const list = ((j.result && j.result.cmsArticleWebOld) || [])
      .map(x => ({
        title: String(x.title || '').replace(/<\/?em>/g, ''),
        date: String(x.date || '').slice(0, 10),
        summary: String(x.content || '').replace(/<\/?em>/g, '').slice(0, 80)
      }))
      .filter(x => x.title)
      .slice(0, 5)
      .sort((a, b) => _newsWeight(b) - _newsWeight(a)); // 重大利空排最前
    _newsCache[name] = { ts: now, list };
    _saveNewsCache();
    return { list, limited: false, stale: false };
  } catch (e) {
    if (cached) return { list: cached.list, limited: false, stale: true }; // 限流了，用之前缓存顶着
    return { list: [], limited: true, stale: false };                       // 完全取不到
  }
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

/* ===== KDJ 随机指标（超买超卖）=====
 * 标准口径（同花顺/通达信）：N=9, M1=3, M2=2
 *  RSV = (收盘 - N日最低) / (N日最高 - N日最低) × 100
 *  K = (2×K前值 + RSV) / 3；D = (2×D前值 + K) / 2；J = 3K - 2D（初值 K=D=50）
 *  超买：K≥80 或 J≥100；超卖：K≤20 或 J≤0；低位金叉（<50）=反弹信号；高位死叉（>50）=回落信号
 */
function computeKDJ(klines, n = 9, m1 = 3, m2 = 2) {
  const closes = klines.map(d => d.close), highs = klines.map(d => d.high), lows = klines.map(d => d.low);
  const N = closes.length;
  if (N < n + m1 + m2 + 2) return null;
  const rsv = (i) => {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { if (highs[j] > hh) hh = highs[j]; if (lows[j] < ll) ll = lows[j]; }
    return hh > ll ? (closes[i] - ll) / (hh - ll) * 100 : 50;
  };
  const K = [], D = [];
  let kPrev = 50, dPrev = 50;
  for (let i = 0; i < N; i++) {
    if (i < n - 1) { K.push(50); D.push(50); continue; }
    kPrev = (kPrev * (m1 - 1) + rsv(i)) / m1;
    dPrev = (dPrev * (m2 - 1) + kPrev) / m2;
    K.push(kPrev); D.push(dPrev);
  }
  const k = K[N - 1], d = D[N - 1], j = 3 * k - 2 * d;
  const kp = K[N - 2], dp = D[N - 2];
  let zone = 'neutral';
  if (k >= 80 || j >= 100) zone = 'overbought';
  else if (k <= 20 || j <= 0) zone = 'oversold';
  let signal;
  if (k > d && kp <= dp) signal = zone === 'oversold' ? '低位金叉' : '金叉';
  else if (k < d && kp >= dp) signal = zone === 'overbought' ? '高位死叉' : '死叉';
  else if (zone === 'overbought') signal = '超买';
  else if (zone === 'oversold') signal = '超卖';
  else signal = k > d ? '多头排列' : '空头排列';
  // J 值极端（>110 或 <-10）标记过热/过冷，辅助判断
  const jExtreme = j >= 110 ? 'J值过热' : j <= -10 ? 'J值过冷' : null;
  const keep = Math.min(60, N);   // 序列只回传画图所需尾部
  return {
    k: +k.toFixed(1), d: +d.toFixed(1), j: +j.toFixed(1),
    signal, zone, jExtreme,
    zoneLabel: zone === 'overbought' ? '超买区（≥80）' : zone === 'oversold' ? '超卖区（≤20）' : '中性区（20-80）',
    series: { k: K.slice(-keep).map(x => +x.toFixed(1)), d: D.slice(-keep).map(x => +x.toFixed(1)), j: D.slice(-keep).map((_, i) => +(3 * K[N - keep + i] - 2 * D[N - keep + i]).toFixed(1)) }
  };
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

// ===== 主力吸筹识别（涨停前潜伏信号模型，2026-10-20）=====
// 思路：涨停不是起点而是终点。启动前主力往往先在低位"安静地"收集筹码：
//   低位横盘 + 温和放量(量能阶梯抬升) + 吸筹K线(下影承接/小阳堆积/缩量阴回调洗盘)
//   + 资金持续小幅净流入 + 波动收敛 + 均线粘合
// 输出：accScore(0-100) / phase(none|quiet|accumulating|launched|topping) / signals[](特征命中)
// 无实时快照/资金流时可降级为纯K线版（历史日复算、全市场批量用）
const ACC_PHASE_LABEL = { none: '无明显特征', quiet: '缩量观察', accumulating: '主力吸筹中', launched: '已启动', topping: '高位派发风险' };
function _accMa(arr, n) { return arr.slice(-n).reduce((a, b) => a + b, 0) / n; }

function computeAccumulation({ klines, snapshot, cyq, flow, tech, rsi }) {
  const kl = klines || [];
  const N = kl.length;
  if (N < 25) return { accScore: 50, phase: 'none', signals: [], pos: null };
  const price = (snapshot && snapshot.price) || kl[N - 1].close;
  const closes = kl.map(k => k.close), highs = kl.map(k => k.high), lows = kl.map(k => k.low), vols = kl.map(k => k.volume);

  // 1) 位置（权重18）：现价在60日区间中的分位，越低越是吸筹土壤；仍压在中期均线下方加分
  const win = Math.min(60, N), from = N - win;
  const segH = Math.max(...highs.slice(from)), segL = Math.min(...lows.slice(from));
  const range = segH - segL;
  const pos = range > 0 ? (price - segL) / range : 0.5;
  const ma60 = N >= 60 ? _accMa(closes, 60) : null;
  let posS = pos <= 0.22 ? 1 : pos <= 0.40 ? 0.7 : pos <= 0.60 ? 0.25 : pos <= 0.80 ? 0.1 : 0.05;
  if (ma60) { if (price < ma60 * 1.02) posS = Math.min(1, posS + 0.15); else if (price > ma60 * 1.15) posS = Math.max(0, posS - 0.2); }

  // 2) 横盘整理（权重15）：近10日涨跌幅/振幅足够小、60日区间不太宽
  const last10 = kl.slice(-10);
  const avgAbsChg = last10.reduce((s, k, i) => { const p = (kl[N - 11 + i] || k).close; return s + Math.abs(k.close / p - 1); }, 0) / 10 * 100;
  const avgAmp10 = last10.reduce((s, k) => s + (k.high - k.low) / k.close, 0) / 10 * 100;
  const segRangePct = range / price * 100;
  let conS = 0;
  conS += avgAbsChg <= 1.6 ? 0.45 : avgAbsChg <= 2.4 ? 0.25 : avgAbsChg > 3.5 ? -0.25 : 0;
  conS += avgAmp10 <= 3.2 ? 0.35 : avgAmp10 <= 4.5 ? 0.2 : avgAmp10 > 7 ? -0.25 : 0;
  conS += segRangePct <= 12 ? 0.2 : segRangePct > 25 ? -0.15 : 0;
  conS = Math.max(0, Math.min(1, conS));

  // 3) 温和放量（权重25）：5日量/10日、5日量/20日 落在温和放量区间；阶梯抬升加分；缩量/爆量减分
  const v5 = _accMa(vols, 5);
  const v10 = N >= 15 ? _accMa(vols.slice(0, N - 5), 10) : v5;
  const v20 = _accMa(vols, 20);
  const v30 = N >= 30 ? _accMa(vols, 30) : v20;
  const r5_10 = v10 > 0 ? v5 / v10 : 1, r5_20 = v20 > 0 ? v5 / v20 : 1;
  let volS = 0.15;
  volS += (r5_10 >= 1.15 && r5_10 <= 3.2) ? 0.3 : r5_10 > 3.2 ? 0.1 : r5_10 < 0.8 ? -0.15 : 0;
  volS += (r5_20 >= 1.1 && r5_20 <= 2.8) ? 0.25 : r5_20 > 2.8 ? 0.08 : r5_20 < 0.95 ? -0.25 : 0;   // 缩量=无人吸筹，重罚
  if (v5 < v30 * 0.9) volS -= 0.15;                                       // 量能持续萎缩
  if (v5 > v10 && v10 >= v20 * 0.95) volS += 0.15;                        // 量能阶梯：5日>10日≥20日
  const vr = (snapshot && snapshot.volRatio) || 0;
  volS += (vr >= 1.2 && vr <= 3.5) ? 0.1 : vr > 5 ? -0.15 : (vr > 0 && vr < 0.7) ? -0.1 : 0;
  const to = (snapshot && snapshot.turnover) || 0;
  volS += (to >= 1 && to <= 8) ? 0.1 : to > 15 ? -0.1 : 0;
  volS = Math.max(0, Math.min(1, volS));

  // 4) 吸筹K线（权重15）：下影承接(收盘位于当日上半区)/小阳堆积/缩量阴回调(洗盘)；大阴线扣分
  let lowerShadowDays = 0, smallYang = 0, shrinkPullback = 0, bigDown = 0;
  for (let i = Math.max(1, N - 10); i < N; i++) {
    const k = kl[i], p = kl[i - 1].close;
    const chg = k.close / p - 1;
    const body = Math.abs(k.close - k.open);
    const lower = Math.min(k.close, k.open) - k.low;
    const dayPos = (k.high > k.low) ? (k.close - k.low) / (k.high - k.low) : 0.5;
    if (dayPos >= 0.55 && lower > body * 0.8) lowerShadowDays++;          // 长下影且收在上半区=主力承接
    if (chg > 0 && chg < 0.025) smallYang++;
    if (i >= 6) {
      const v5b = vols.slice(i - 5, i).reduce((a, b) => a + b, 0) / 5;
      if (chg < -0.008 && k.volume < v5b * 0.8) shrinkPullback++;         // 缩量阴回调=洗盘非出逃
    }
    if (chg < -0.05) bigDown++;
  }
  let cdlS = 0.2 + Math.min(4, lowerShadowDays) * 0.1 + Math.min(4, smallYang) * 0.08 + Math.min(2, shrinkPullback) * 0.06 - Math.min(3, bigDown) * 0.12;
  cdlS = Math.max(0, Math.min(1, cdlS));

  // 5) 资金持续流入（权重15）：近5日主力净流入为正的天数与累计；无数据时权重让渡给K线维度
  let fundS = null, fundInfo = null;
  const trend = (flow && flow.trend) || [];
  if (trend.length >= 8) {
    const last5f = trend.slice(-5);
    const posDays = last5f.filter(x => x > 0).length;
    const sum5 = last5f.reduce((a, b) => a + b, 0);
    fundS = 0.3;
    fundS += posDays >= 3 ? 0.3 : posDays >= 2 ? 0.15 : 0;
    if (sum5 > 0) fundS += 0.2;
    const maxAbs = Math.max(...last5f.map(Math.abs));
    if (maxAbs > 0 && sum5 > 0 && sum5 / maxAbs >= 1.5) fundS += 0.1;       // 多日累加而非单日脉冲
    if (trend.slice(-10).filter(x => x > 0).length >= 6) fundS += 0.1;
    fundS = Math.max(0, Math.min(1, fundS));
    fundInfo = { posDays, sum5 };
  }

  // 6) 波动收敛（权重8）：ATR5/ATR20 收敛 = 突破前夜特征
  const atr = n => { let s = 0; for (let i = N - n; i < N; i++) s += kl[i].high - kl[i].low; return s / n; };
  const atr5 = atr(5), atr20 = atr(20);
  const atrRatio = atr20 > 0 ? atr5 / atr20 : 1;
  let volcS = atrRatio <= 0.7 ? 1 : atrRatio <= 0.9 ? 0.75 : atrRatio <= 1.1 ? 0.5 : 0.25;
  const amp30 = kl.slice(-30).reduce((s, k) => s + (k.high - k.low) / k.close, 0) / Math.min(30, N) * 100;
  if (avgAmp10 < amp30 * 0.85) volcS = Math.min(1, volcS + 0.15);

  // 7) 均线粘合（权重7）：MA5/10/20 距离近且重心不再下移
  let maS = 0.4, maDev = null;
  if (N >= 20) {
    const ma5 = _accMa(closes, 5), ma10 = _accMa(closes, 10), ma20 = _accMa(closes, 20);
    const d1 = Math.abs(ma5 - ma20) / ma20 * 100, d2 = Math.abs(ma10 - ma20) / ma20 * 100;
    maDev = d1;
    maS = (d1 <= 1.5 && d2 <= 2.2) ? 1 : (d1 <= 2.5 && d2 <= 3.5) ? 0.7 : d1 > 5 ? 0.2 : 0.4;
    maS += ma5 >= ma10 ? 0.15 : -0.15;
    maS = Math.max(0, Math.min(1, maS));
  }

  // 汇总（无资金数据时权重让渡给K线维度）
  const dims = { pos: { v: posS, w: 18 }, con: { v: conS, w: 12 }, vol: { v: volS, w: 25 }, cdl: { v: cdlS, w: 15 }, fund: { v: fundS, w: 15 }, volc: { v: volcS, w: 8 }, ma: { v: maS, w: 7 } };
  if (fundS == null) {
    const give = dims.fund.w;
    const klDims = ['pos', 'con', 'vol', 'cdl'], totW = klDims.reduce((s, k) => s + dims[k].w, 0);
    klDims.forEach(k => { dims[k].w += give * dims[k].w / totW; });
    dims.fund.w = 0;
  }
  let acc = 50;
  for (const k in dims) { const d = dims[k]; if (d.w > 0) acc += (d.v - 0.5) * d.w * 1.5; }
  const accScore = Math.max(5, Math.min(98, Math.round(acc)));

  // 相位判定：已启动/高位派发/吸筹中/缩量观察
  const chgToday = (snapshot && snapshot.changePct != null) ? snapshot.changePct : (kl[N - 1].close / kl[N - 2].close - 1) * 100;
  const max3Chg = Math.max(...kl.slice(-3).map((k, i) => { const p = (kl[N - 4 + i] || k).close; return k.close / p - 1; }));
  const vrNow = (snapshot && snapshot.volRatio) || r5_20;
  const atHigh = range > 0 && pos >= 0.95;
  // 吸筹必须有量能或资金确认——否则只是"缩量观察"（无人问津），不能算主力吸筹
  const volConfirmed = volS >= 0.55 || (fundS != null && fundS >= 0.55);
  let phase = 'none';
  if (max3Chg >= 0.075 || chgToday >= 9.5 || (vrNow > 4 && chgToday > 5) || (atHigh && max3Chg >= 0.03)) phase = 'launched';
  else if (pos > 0.72 && (r5_20 > 1.15 || vrNow > 2.5) && max3Chg < 0.025) phase = 'topping';
  else if (accScore >= 62 && pos < 0.62 && volConfirmed) phase = 'accumulating';
  else if (accScore >= 45 && pos < 0.62) phase = 'quiet';

  const signals = [
    { t: '低位', hit: pos <= 0.4, d: `股价位于60日区间${(pos * 100).toFixed(0)}%分位${ma60 ? (price < ma60 ? '·中期均线下方' : '') : ''}` },
    { t: '横盘', hit: conS >= 0.6, d: `近10日日均涨跌${avgAbsChg.toFixed(1)}%·日均振幅${avgAmp10.toFixed(1)}%` },
    { t: '温和放量', hit: volS >= 0.6, d: `5日量/10日量=${r5_10.toFixed(2)}·5日量/20日量=${r5_20.toFixed(2)}` },
    { t: '吸筹K线', hit: cdlS >= 0.55, d: `下影承接${lowerShadowDays}天·小阳${smallYang}天·缩量回调${shrinkPullback}天` },
    ...(fundInfo ? [{ t: '资金持续流入', hit: fundS >= 0.6, d: `近5日主力净流入${(fundInfo.sum5 / 1e8).toFixed(2)}亿·净流入${fundInfo.posDays}/5天` }] : []),
    { t: '波动收敛', hit: volcS >= 0.7, d: `ATR5/ATR20=${atrRatio.toFixed(2)}` },
    { t: '均线粘合', hit: maS >= 0.7, d: maDev != null ? `MA5-MA20偏离${maDev.toFixed(1)}%` : '数据不足' }
  ];
  return { accScore, phase, signals, pos: +pos.toFixed(2), dims: { pos: +posS.toFixed(2), con: +conS.toFixed(2), vol: +volS.toFixed(2), cdl: +cdlS.toFixed(2), fund: fundS == null ? null : +fundS.toFixed(2), volc: +volcS.toFixed(2), ma: +maS.toFixed(2) } };
}

// K线版吸筹识别（无实时快照/资金流，用于历史日复算与全市场批量）
function computeAccumulationKL(klines) {
  return computeAccumulation({ klines, snapshot: null, cyq: null, flow: null, tech: null, rsi: null });
}

// 深度评分（个股详情页）：技术/资金/筹码/动量/RSI/今日走势/波动率
function computeDeepScore({ snapshot, cyq, flow, tech, rsi, klines, acc, kdj }) {
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
  const techBase = Math.max(-22, Math.min(22, tech1));
  // 1b) KDJ 超买超卖修正：低位金叉/超卖=反弹潜力，高位死叉/超买=回调风险（与MACD分工，不重复计权）
  let techKdj = 0;
  if (kdj) {
    if (kdj.signal === '低位金叉') techKdj = 5;
    else if (kdj.zone === 'oversold' && kdj.j <= 0) techKdj = 4;
    else if (kdj.signal === '高位死叉') techKdj = -5;
    else if (kdj.zone === 'overbought' && kdj.j >= 100) techKdj = -4;
    else if (kdj.signal === '金叉') techKdj = 2;
    else if (kdj.signal === '死叉') techKdj = -2;
  }
  dims.tech = Math.max(-22, Math.min(22, techBase + techKdj)); s += dims.tech;
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
  // 8) 主力吸筹潜伏 ±14（2026-10-20 涨停前识别：低位横盘+温和放量+资金持续流入等七维特征）
  //    吸筹分70→+6，80→+9，90→+12；无吸筹特征甚至破位下跌的给负项，最低-6
  let accDim = 0;
  if (acc && acc.accScore != null) accDim = Math.max(-6, Math.min(14, (acc.accScore - 50) * 0.3));
  dims.acc = accDim; s += accDim;
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

// ===== 全市场吸筹榜（2026-10-20）：涨停前潜伏清单 =====
// 与评分榜相反：这里专门找"今天还没涨、但主力正在低位默默吸筹"的票。
// 快照代理预筛（涨幅温和未启动+量比活跃+换手适度+流动性）→ 前150只拉K线做深度吸筹识别，缓存10分钟
let _accBoardCache = { ts: 0, data: null };
async function getMarketAccumulationBoard(limit = 40, force = false) {
  const now = Date.now();
  if (!force && _accBoardCache.data && now - _accBoardCache.ts < 600000) {
    return { ..._accBoardCache.data, stocks: _accBoardCache.data.stocks.slice(0, limit) };
  }
  const snap = await getMarketSnapshot(force);
  const pre = snap.stocks.map(q => {
    let p = 0;
    const chg = q.changePct || 0;
    if (chg >= -3 && chg <= 4) p += 30;            // 未启动（涨幅温和）
    else if (chg > 4 && chg <= 6) p += 12;
    const vr = q.volRatio || 0;
    if (vr >= 1.0 && vr <= 3.5) p += 25;           // 量比活跃但未爆量
    else if (vr > 3.5 && vr <= 5) p += 10;
    else if (vr > 0 && vr < 0.8) p -= 10;          // 无量不碰
    const to = q.turnover || 0;
    if (to >= 0.8 && to <= 9) p += 20;             // 换手适度活跃
    else if (to > 9) p += 8;
    const amt = q.amount || 0;
    if (amt > 5000) p += 15;                       // 成交额>5000万 保证流动性
    else if (amt > 2000) p += 8;
    if (q.price >= 2) p += 10;
    return { q, p };
  }).filter(x => x.p >= 40).sort((a, b) => b.p - a.p).slice(0, 150);
  const results = await mapLimit(pre, 10, async (item) => {
    try {
      const secid = resolveSecid(item.q.code);
      const klines = await getKline(secid, 60);
      if (!klines || klines.length < 25) return null;
      const acc = computeAccumulationKL(klines);
      if (acc.phase !== 'accumulating' && acc.phase !== 'quiet') return null;   // 已启动/派发/无特征 不上榜
      return {
        ...item.q, accScore: acc.accScore, phase: acc.phase, pos: acc.pos,
        accGrade: acc.accScore >= 78 ? '强' : acc.accScore >= 65 ? '较明显' : acc.accScore >= 52 ? '轻度' : '弱',
        accHits: acc.signals.filter(s => s.hit).map(s => s.t).join('、')
      };
    } catch (e) { return null; }
  });
  const up = snap.stocks.filter(x => x.changePct > 0).length;
  const down = snap.stocks.filter(x => x.changePct < 0).length;
  const board = {
    updatedAt: now, count: results.length, total: snap.total, source: snap.source,
    breadth: { up, down, flat: snap.stocks.length - up - down, upRatio: snap.stocks.length ? +(up / snap.stocks.length * 100).toFixed(1) : 0 },
    stocks: results.sort((a, b) => b.accScore - a.accScore)
  };
  _accBoardCache = { ts: now, data: board };
  return { ...board, stocks: board.stocks.slice(0, limit) };
}

// 历史日简化评分（0-100）：实时快照只存当天，历史日用K线逐日复算
// 信号：当日涨跌幅/日内收盘位置/量能代理(当日量vs前5日均量)/5日动量/均线排列/振幅健康度
function computeDailyScoreAt(klines, idx) {
  if (!klines || idx < 0 || idx >= klines.length) return null;
  const k = klines[idx];
  const prev = klines[idx - 1];
  if (!prev) return null;
  let s = 50;
  // 1) 当日涨跌幅 ±22
  const chg = (k.close / prev.close - 1) * 100;
  s += Math.max(-22, Math.min(22, chg * 3.5));
  // 2) 日内收盘位置 ±8（收在天花板/地板）
  if (k.high > k.low) s += ((k.close - k.low) / (k.high - k.low) - 0.5) * 16;
  // 3) 量能代理 ±8：当日量/前5日均量（1.3-2.5放量且涨=资金认可；爆量过热；无量弱）
  if (idx >= 5) {
    const avgV = klines.slice(idx - 5, idx).reduce((a, b) => a + b.volume, 0) / 5;
    const vr = avgV > 0 ? k.volume / avgV : 1;
    const dir = chg >= 0 ? 1 : -1;
    if (vr >= 1.3 && vr <= 2.5) s += dir * 8;
    else if (vr > 2.5) s += dir * 3;
    else if (vr > 0 && vr < 0.7) s += dir * 2;
    else s += dir * 3;
  }
  // 4) 5日动量 ±12（截至该日）
  if (idx >= 5) {
    const p5 = klines[idx - 5].close;
    const m5 = (k.close / p5 - 1) * 100;
    s += Math.max(-12, Math.min(12, m5 * 1.2));
  }
  // 5) 均线位置 ±10（截至该日：MA5/10/20 排列 + 收盘与MA20关系）
  if (idx >= 19) {
    const cl = klines.slice(0, idx + 1).map(x => x.close);
    const ma = n => cl.slice(-n).reduce((a, b) => a + b, 0) / n;
    const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20);
    if (ma5 > ma10 && ma10 > ma20) s += 7;
    else if (ma5 < ma10 && ma10 < ma20) s -= 7;
    if (k.close > ma20) s += 3; else s -= 3;
  }
  // 6) 振幅健康度 ±4
  const amp = (k.high - k.low) / prev.close * 100;
  if (amp >= 1 && amp <= 6) s += 2;
  else if (amp > 9) s -= 2;
  // 7) 主力吸筹潜伏 ±9（K线复算版：低位横盘+温和放量+吸筹K线；让趋势球反映涨停前的潜伏过程）
  if (idx >= 24) {
    const accS = computeAccumulationKL(klines.slice(0, idx + 1)).accScore;
    s += Math.max(-9, Math.min(9, (accS - 50) * 0.3));
  }
  s = Math.max(5, Math.min(95, Math.round(s)));
  return { score: s, grade: scoreGrade(s) };
}

// 最近 N 个交易日评分（供前端趋势小球）：
// - 最后一根（今天）若传入实时数据 live，直接用 computeDeepScore 综合评分，保证与页面大数字一致
// - 历史日用 computeDailyScoreAt K线复算简化版（无实时快照/资金流可用）
function recentDailyScores(klines, n = 5, live = null) {
  const out = [];
  for (let i = Math.max(0, klines.length - n); i < klines.length; i++) {
    let r = null;
    if (live && i === klines.length - 1) {
      try { r = { score: computeDeepScore(live).score, grade: computeDeepScore(live).grade }; } catch (e) { r = null; }
    }
    if (!r) r = computeDailyScoreAt(klines, i);
    if (r) out.push({ date: klines[i].date, ...r, isToday: i === klines.length - 1 });
  }
  return out;
}

function buildHeuristic({ snapshot, cyq, flow, tech, rsi, news, newsLimited, klines, acc, kdj }) {
  // 筹码
  let chip;
  if (cyq.profitRatio >= 70) chip = `当前获利比例${cyq.profitRatio}%，多数筹码浮盈；平均成本${cyq.avgCost}，筹码密集区约在${cyq.peakPrice}，上方存在短线套牢/止盈压力。`;
  else if (cyq.profitRatio <= 30) chip = `当前获利比例仅${cyq.profitRatio}%，多数筹码处于亏损（套牢），抛压趋于衰减，但企稳仍需量能配合。`;
  else chip = `当前获利比例${cyq.profitRatio}%，筹码盈亏大致均衡；平均成本${cyq.avgCost}，现价${snapshot.price}位于成本${snapshot.price > cyq.avgCost ? '上方（浮盈）' : '下方（浮亏）'}。`;

  // 资金
  let fund;
  const m = flow.mainNetInflow;
  if (m == null) fund = '主力资金数据暂不可用（数据源限流），可参考上方分时量价判定与K线量能。';
  else if (flow.est) fund = `分时量价推算：全天资金${m > 0 ? '净流入' : '净流出'}约${(Math.abs(m) / 1e8).toFixed(2)}亿元（${flow.est.levelLabel}，主动买占比${flow.est.buyRatio}%）。口径说明：由分钟涨跌归类的主动买卖失衡估算，非东财主力大单口径（该源当前限流），趋势方向可参考。`;
  else if (m > 0) fund = `当日主力净流入约${(m / 1e8).toFixed(2)}亿元，资金呈回流${flow.mainNetInflow5d > 0 ? '，近5日累计亦为净流入' : '（但近5日累计净流出，持续性待观察）'}。`;
  else fund = `当日主力净流出约${(-m / 1e8).toFixed(2)}亿元，资金态度偏谨慎${flow.mainNetInflow5d < 0 ? '，近5日持续净流出' : '（近5日累计净流入，或为散户抛压主导）'}。`;

  // 技术
  let techTxt = `MACD${tech.signal}（DIFF ${tech.diff}、DEA ${tech.dea}，位于${tech.zeroAxis}），RSI(14)=${rsi}（${rsi > 70 ? '超买' : rsi < 30 ? '超卖' : '中性'}）`;
  if (kdj) {
    techTxt += `；KDJ：K ${kdj.k} / D ${kdj.d} / J ${kdj.j}，${kdj.signal}（${kdj.zoneLabel}${kdj.jExtreme ? '，' + kdj.jExtreme : ''}）`;
    if (kdj.signal === '低位金叉') techTxt += '，短线反弹信号';
    else if (kdj.signal === '高位死叉') techTxt += '，短线回调信号';
    else if (kdj.zone === 'overbought') techTxt += '，追高风险积聚';
    else if (kdj.zone === 'oversold') techTxt += '，关注超跌反弹机会';
  }
  techTxt += '。';

  // 消息
  const newsTxt = news.length
    ? `近期公告/消息：${news.slice(0, 2).map(x => x.title).join('；')}。`
    : (newsLimited
        ? '⚠️ 公告获取限流中（数据源波动），稍后自动重试；重大消息请以交易所/公司公告为准。'
        : '暂无重大公告。');

  // 综合
  let score = 0;
  if (tech.signal === '多头' || tech.signal === '金叉') score += 1;
  if (tech.signal === '空头' || tech.signal === '死叉') score -= 1;
  if (m > 0) score += 1; if (m < 0) score -= 1;
  if (cyq.profitRatio >= 60) score += 0.5; if (cyq.profitRatio <= 30) score -= 0.5;
  const bias = score > 1 ? '偏多' : score < -1 ? '偏空' : '中性';
  const summary = `综合四维信号：${bias}。${chip}${fund}` + (acc && acc.phase === 'accumulating' ? `检测到主力吸筹特征（吸筹分${acc.accScore}/100），股价处于启动前潜伏阶段。` : acc && acc.phase === 'quiet' ? `有轻度吸筹迹象（吸筹分${acc.accScore}/100），量能尚未确认，继续观察。` : '');

  // 策略
  let strategy;
  if (bias === '偏多') strategy = `持仓者沿短期均线上持，跌破${cyq.avgCost}减仓；未入场者不追高，回踩${cyq.avgCost}附近且量能温和可低吸。风控：单笔≤2成，止损参考${cyq.avgCost}。`;
  else if (bias === '偏空') strategy = `观望为主，不接飞刀；持仓者借反抽减仓，跌破前低再看。风控：仓位≤1成，破位严格止损。`;
  else strategy = `区间思路：箱体下沿低吸、上沿高抛；放量突破再转多。仓位≤1.5成，设好止损。`;
  // 主力吸筹潜伏提示（2026-10-20）：检测到启动前吸筹特征时，策略以"潜伏"为主线
  if (acc && (acc.phase === 'accumulating' || acc.phase === 'quiet')) {
    const hits = acc.signals.filter(x => x.hit).map(x => x.t);
    strategy = `🕵️ 主力吸筹识别：${ACC_PHASE_LABEL[acc.phase]}（吸筹分${acc.accScore}/100，命中：${hits.join('、') || '暂无'}）。属于启动前潜伏阶段${acc.phase === 'accumulating' ? '，主力仍在低调收集筹码' : '，量能尚未确认'}。\n` + strategy;
    if (acc.phase === 'accumulating' && acc.accScore >= 65) {
      strategy += `\n潜伏打法：不追高，沿吸筹平台上沿轻仓试探（≤1成），跌破近10日低点/平台下沿止损；一旦放量长阳突破平台上沿再顺势加仓。`;
    }
  }

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
  // 主力吸筹（2026-10-20）：潜伏期特征越强，向上突破(乐观情景)概率越高——"涨停前预测"的核心修正
  if (acc && acc.phase === 'accumulating') s += Math.min(10, Math.max(0, (acc.accScore - 60) * 0.4));
  else if (acc && acc.phase === 'quiet' && acc.accScore >= 55) s += 2;
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
  const probNote = `概率依据：多空信号强度 ${s > 0 ? '多' : '空'}(${Math.abs(s).toFixed(0)}/60) · 近10日日均振幅 ${volPct.toFixed(1)}% · 资金${m > 0 ? (flow.est ? '推算净流入' : '净流入') : m < 0 ? (flow.est ? '推算净流出' : '净流出') : '数据缺失'} · 筹码获利比例 ${cyq.profitRatio}%` + (acc && acc.phase !== 'none' ? ` · 主力吸筹分 ${acc.accScore}（${ACC_PHASE_LABEL[acc.phase]}）` : '');

  // 综合评分（0-100，融合技术/资金/筹码/动量/RSI/今日走势/波动率/主力吸筹）
  const scoreInfo = computeDeepScore({ snapshot, cyq, flow, tech, rsi, klines, acc });

  return { chip, fund, tech: techTxt, news: newsTxt, summary, strategy, forecast, probNote, kind: '规则速评', score: scoreInfo.score, grade: scoreInfo.grade, scoreDims: scoreInfo.dims, accumulation: acc || null };
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
  _noteSecid(secid);   // 记录最近访问，供资金流预热刷新使用
  // 资金流（东财，可能限流）加 4.5s 硬超时竞速：不阻塞主链路，失败走分时量价推算兜底
  const flowTask = getFlow(secid);
  const flowTimeout = new Promise(resolve => setTimeout(() => resolve(null), 4500));
  const flow = await Promise.race([flowTask, flowTimeout]) || { mainNetInflow: null, mainNetInflow5d: null, trend: [] };
  const [klines, snapshot, intradayRaw] = await Promise.all([
    getKline(secid), getSnapshot(secid), getIntraday(secid)
  ]);
  const tech = computeMACD(klines);
  const rsi = computeRSI(klines.map(d => d.close));
  const kdj = computeKDJ(klines);
  const cyq = computeCYQ(klines, snapshot.price);
  // 资金流兜底（提前计算）：东财资金流不可用（限流）时，用分时量价推算全天资金净额（稳定数据源）
  const flowEst = intradayRaw ? estimateFlowFromIntraday(intradayRaw) : null;
  // 供评分/短评/吸筹/概率使用的资金视图：东财真实值优先，其次分时推算值（est=true，口径不同）
  const flowView = flow.mainNetInflow != null ? flow
    : (flowEst ? { mainNetInflow: flowEst.estInflow, mainNetInflow5d: null, trend: flow.trend, est: flowEst } : flow);
  const acc = computeAccumulation({ klines, snapshot, cyq, flow: flowView, tech, rsi });
  // 分时量价形态判定（拉升/洗盘/吸筹/出货）：接口失败不影响主流程
  let intraday = null;
  try {
    // 近5日日均量作为"当日是否放量"的基准
    const recent = klines.slice(-5);
    const baselineVol = recent.length ? recent.reduce((a, b) => a + (b.volume || 0), 0) / recent.length : null;
    const feats = analyzeIntraday(intradayRaw, baselineVol, snapshot.prevClose);
    if (feats) {
      const verdict = judgeIntradayPattern(feats);
      intraday = {
        ...verdict,
        date: intradayRaw.date, source: intradayRaw.source,
        prevClose: intradayRaw.prevClose || snapshot.prevClose || null,   // 分时源自带昨收缺失时（腾讯/新浪源）用实时快照昨收兜底
        // 分时序列压缩传输：[分钟数, 价格, 均价, 分钟量]
        points: intradayRaw.points.map(x => {
          const m = /^(\d{2}):(\d{2})$/.exec(x.t);
          return [m ? (+m[1]) * 60 + (+m[2]) : 0, x.p, x.avg, x.v];
        })
      };
    }
  } catch (e) { intraday = null; }
  // 对外返回的资金字段：东财真实资金流，或分时量价推算值（est=true）
  const capitalOut = flowView;
  const newsRes = await getNews(snapshot.name); // 依赖 snapshot.name，故串行
  const news = newsRes.list;
  const heuristic = buildHeuristic({ snapshot, cyq, flow: flowView, tech, rsi, news, newsLimited: newsRes.limited, klines, acc, kdj });
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
    // 分时量价形态判定（当天）：走势形状 + 均价线关系 + 量价关系 → 拉升/洗盘/吸筹/出货
    intraday,
    // 资金面：东财主力资金流（不可用时为分时量价推算值，est=true）
    capital: capitalOut,
    tech: { ...tech, rsi },
    // KDJ 随机指标（超买超卖）：K/D/J 值 + 信号（低位金叉/高位死叉/超买/超卖）+ 尾部序列供前端画图
    kdj,
    news,
    newsLimited: newsRes.limited,   // 真取不到（东财限流且无缓存）→ 前端显示"限流中"而非"暂无公告"
    newsStale: newsRes.stale,       // 用的是限流前缓存 → 前端提示"可能非最新"
    dataSource: 'eastmoney-live',
    aiReview,
    heuristic,
    // 主力吸筹识别（涨停前潜伏信号：低位横盘+温和放量+资金持续流入等七维特征）
    accumulation: acc,
    // 近5个交易日评分（趋势小球）：今天=实时综合评分（与页面大数字一致），历史日=K线复算简化版
    dailyScores: recentDailyScores(klines, 5, { snapshot, cyq, flow: flowView, tech, rsi, klines, acc }),
    // 评分同步到顶层（前端兼容两种读取位置）
    score: heuristic.score, grade: heuristic.grade, scoreDims: heuristic.scoreDims
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
  if (mode === 'accumulation') {
    // 吸筹榜：涨停前潜伏识别（快照预筛150只+拉K线深度计算，缓存10分钟）
    const board = await getMarketAccumulationBoard(limit, force);
    return { ok: true, updatedAt: board.updatedAt, count: board.stocks.length, total: board.total, source: board.source, mode, breadth: board.breadth, stocks: board.stocks };
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

module.exports = { analyze, resolveSecid, search, getLiveQuotes, getMarketSnapshot, getMarketView, refreshStockList, STOCK_LIST, computeQuoteScore, computeDeepScore, computeShortTermScore, getMarketScoreBoard, computeDailyScoreAt, recentDailyScores, computeAccumulation, computeAccumulationKL, getMarketAccumulationBoard, ACC_PHASE_LABEL, getIntraday, analyzeIntraday, judgeIntradayPattern, INTRA_PATTERN, computeKDJ, getFlow, startHotFlowRefresh, estimateFlowFromIntraday, getNews };
