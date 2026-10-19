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
      return {
        name: NAME_MAP[code] || code,
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

async function getNews(secid) {
  const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=8&page_index=0&secid=${secid}`;
  try {
    const j = await fetchJSON(url, 5000);
    if (!j.data || !j.data.list) return [];
    return j.data.list
      .map(it => ({ title: it.title || it.ann_title || '', date: (it.display_time || '').slice(0, 10) }))
      .filter(x => x.title);
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

  // 三情景
  const recent = klines.slice(-10);
  const avgRange = recent.reduce((s, d) => s + Math.abs(d.high - d.low) / d.close, 0) / recent.length;
  const up = (snapshot.price * (1 + avgRange)).toFixed(2);
  const dn = (snapshot.price * (1 - avgRange)).toFixed(2);
  const bull = (snapshot.price * (1 + avgRange * 1.8)).toFixed(2);
  const bear = (snapshot.price * (1 - avgRange * 1.8)).toFixed(2);
  const forecast = {
    base: `${dn}-${up} 区间震荡（约55%）`,
    bull: `放量突破${up}，上看${bull}（约30%）`,
    bear: `跌破${dn}，下探${bear}（约15%）`
  };

  return { chip, fund, tech, news: newsTxt, summary, strategy, forecast, kind: '规则速评' };
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
  const [klines, snapshot, flow, news] = await Promise.all([
    getKline(secid), getSnapshot(secid), getFlow(secid), getNews(secid)
  ]);
  const tech = computeMACD(klines);
  const rsi = computeRSI(klines.map(d => d.close));
  const cyq = computeCYQ(klines, snapshot.price);
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

async function search(keyword) {
  const kw = String(keyword || '').trim();
  // 1) 内置别名映射（NAME_MAP 定义于文件顶部，为 {code: name} 对象）
  const local = Object.entries(NAME_MAP)
    .filter(([code, name]) => name.includes(kw) || code.includes(kw))
    .map(([code, name]) => ({ code, name }));
  if (local.length) return local.slice(0, 8);
  // 2) 尝试东财在线搜索
  try {
    const url = `https://suggest.cls.cn/api/suggest?keyword=${encodeURIComponent(kw)}&type=1`;
    const j = await fetchJSON(url, 4000);
    const list = (j.data || []).map(x => ({ code: String(x.code || '').replace(/\D/g, ''), name: x.name }))
      .filter(x => /^\d{6}$/.test(x.code)).slice(0, 8);
    if (list.length) return list;
  } catch (e) {}
  return [];
}

module.exports = { analyze, resolveSecid, search };
