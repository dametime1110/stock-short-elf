// 股票短线精灵 · 分析后端（Vercel/Cloudflare Serverless 形态）
// 取股票代码 -> 调 iFinD 取四维度数据 -> 调大模型(hy3/step5 可切) 生成结构化短评
// 未配置 iFinD/LLM 凭证时，回退到内置 DEMO 数据集（与前端一致），保证开箱即用。

// ---------- 内置 DEMO 数据（iFinD 实测 + AI 短评） ----------
const DEMO = {
  "600519": { name:"贵州茅台", code:"600519.SH", price:1324.97, chg:-0.3032, pe:20.34, pb:6.59, capital:-69865458,
    macd:{diff:6.4416,dea:-3.3474,macd:19.5781},
    review:{ chip:"近一月股价自1252元震荡上行至1325元，1280-1320成交密集，现价位于区间上沿，获利盘较厚但1340-1350有短线套牢盘。",
      fund:"当日主力净流入约6987万元，边际转暖但量级不大，属试探性回流。",
      tech:"MACD金叉后红柱持续，中期多头未破；短线1320-1350遇阻，微跌属回踩。",
      news:"直销放量、改革去库存、社会库存低位；重夺股王。偏利好非突发催化。",
      summary:"筹码锁定+资金回流+技术多头+基本面稳，四因素共振偏多；临近1350压力区，追高性价比一般。",
      strategy:"持仓沿5日线持有，破1280减仓；冲高1340-1350不过部分止盈。观望者回踩1280-1300低吸，放量破1350再跟。单笔≤2成，1280止损。",
      forecast:{base:"1320-1350震荡消化获利盘(55%)",bull:"放量破1350看1400(30%)",bear:"破1280回踩1250(15%)"} } },
  "300750": { name:"宁德时代", code:"300750.SZ", price:267.02, chg:-3.6029, pe:14.54, pb:3.31, capital:-461470158.77,
    macd:{diff:-18.5729,dea:-18.6155,macd:0.0851},
    review:{ chip:"近一月自297回落至267，早期290-300高位套牢，反弹受压；近期267-278承接一般，结构偏空。",
      fund:"当日主力净流出约4.6亿，持续流出，大资金谨慎。",
      tech:"MACD双线零轴下，红柱近零，空头占优、趋势弱。",
      news:"积极面：33亿回购(上限400亿)、10/20审议Q3、中报高增；事件博弈临近。",
      summary:"技术资金偏弱、筹码空方占优，但回购+Q3窗口对冲，呈弱势中的事件博弈。",
      strategy:"空仓等Q3落地+放量止跌再介入；持仓借反弹285-295减仓。破260减仓，单笔≤1.5成。",
      forecast:{base:"260-285弱势震荡(50%)",bull:"Q3超预期放量收复290(30%)",bear:"破260下探245-250(20%)"} } },
  "002594": { name:"比亚迪", code:"002594.SZ", price:83.5, chg:0.9429, pe:25.86, pb:3.20, capital:14662960,
    macd:{diff:-1.2439,dea:-1.3576,macd:0.2274},
    review:{ chip:"81-87箱体震荡，成交均匀，现价83.5中枢略偏上，筹码中性。",
      fund:"主力小幅净流入约1466万，进出均衡无方向。",
      tech:"MACD贴近零轴微多，84-86前高有压。",
      news:"9月销量创年内新高、出口高增、高端化明确；研报预计净利+24%。",
      summary:"基本面强但股价横盘蓄势，向上需放量突破86。",
      strategy:"持仓86下持有，放量破86加仓；回踩81-82低吸。观望等突破或回踩，单笔≤2成，止损80。",
      forecast:{base:"81-86箱体蓄势(55%)",bull:"放量破86看92-95(30%)",bear:"破80看76-78(15%)"} } },
  "300059": { name:"东方财富", code:"300059.SZ", price:18.08, chg:-0.1657, pe:19.62, pb:2.91, capital:-151003968.98,
    macd:{diff:-0.237,dea:-0.296,macd:0.118},
    review:{ chip:"17.2-18.9箱体，现价18.08中枢，10/15巨量冲18.32回落有短线套牢，结构中性偏弱。",
      fund:"主力净流出约1.5亿，大资金谨慎。",
      tech:"MACD零轴下微多，弱修复，18.3-18.5有压。",
      news:"中报历史最佳但与成交额深度绑定；年内跌超23%、减持预期、成交地量压制。",
      summary:"业绩强股价弱、量能萎缩+减持压制，弱势震荡，弹性看成交额回暖。",
      strategy:"观望为主，成交重回1.8万亿+站稳18.5再考虑；持仓反弹18.3-18.5减仓。破17止损，单笔≤1成。",
      forecast:{base:"17-18.5地量阴跌(50%)",bull:"成交放量破18.5看20(30%)",bear:"破17看15.5-16(20%)"} } }
};

// ---------- iFinD 取数（部署版占位，需凭证） ----------
async function fetchFromIFind(code){
  // 实际部署时填入 iFinD REST/SDK 调用，返回 {kline, capital, macd, news}
  // 例: const r = await fetch(`https://api.ifind.com/...`, {headers:{token:process.env.IFIND_TOKEN}})
  // 见 README 环境变量说明
  return null; // 未配置则走 DEMO
}

// ---------- 大模型推理（hy3 / step5 可切） ----------
async function callLLM(model, prompt){
  const base = process.env.LLM_BASE_URL, key = process.env.LLM_API_KEY;
  if(!base || !key) return null; // 无凭证则前端用 DEMO 评价
  const resp = await fetch(`${base}/chat/completions`, {
    method:"POST",
    headers:{"Content-Type":"application/json", Authorization:`Bearer ${key}`},
    body:JSON.stringify({ model, messages:[{role:"system",content:prompt}], temperature:0.4 })
  });
  const j = await resp.json();
  return j.choices?.[0]?.message?.content;
}

const PROMPT = `你是资深短线交易分析师。基于【筹码峰】【资金面】【K线】【重大消息】四维度数据，做客观短评。
要求：简洁、有依据、不喊单、提示风险。严格输出 JSON：
{ "chip":string,"fund":string,"tech":string,"news":string,"summary":string,
  "strategy":string,"forecast":{"base":string,"bull":string,"bear":string} }`;

// ---------- Serverless 入口（Vercel 形态） ----------
export default async function handler(req, res){
  const code = (req.query?.code || req.body?.code || "").toString().trim();
  const model = (req.query?.model || process.env.ACTIVE_MODEL || "hy3").toString().trim();
  if(!code) return res.status(400).json({error:"缺少 code 参数"});

  const live = await fetchFromIFind(code);
  if(live){
    const reviewText = await callLLM(model, PROMPT + "\n数据：" + JSON.stringify(live));
    return res.json({ mode:"live", model, code, raw:live, review: reviewText ? JSON.parse(safeJSON(reviewText)) : null });
  }
  // DEMO 回退
  const d = DEMO[code];
  if(!d) return res.status(404).json({ mode:"demo", error:"DEMO 仅含 600519/300750/002594/300059；配置 IFIND_TOKEN+LLM 凭证后可查全市场" });
  return res.json({ mode:"demo", model, code, data:{ name:d.name, code:d.code, price:d.price, chg:d.chg, pe:d.pe, pb:d.pb, capital:d.capital, macd:d.macd }, review:d.review });
}

function safeJSON(t){ try{ return t.slice(t.indexOf("{"), t.lastIndexOf("}")+1); }catch(e){ return t; } }
