// 抓取全市场 A 股代码表 -> data/stocks.json
// 数据源：东方财富 datacenter（免费，无需 key）
const fs = require('fs');
const path = require('path');

const REPORT = 'RPT_DMSK_TS_STOCKNEW';
const COLUMNS = 'SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_MARKET_CODE';
const PAGE_SIZE = 500;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

// 市场前缀映射：上交所 069001002001 -> sh；深交所 069001002002 -> sz（按代码首位判断更稳）
function prefix(code) {
  if (/^(60|68|9)/.test(code)) return 'sh'; // 沪市（600/601/603/605/688/900）
  return 'sz'; // 深市（000/001/002/003/300/200）
}

async function fetchPage(page) {
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${REPORT}&columns=${COLUMNS}&pageSize=${PAGE_SIZE}&pageNumber=${page}&sortColumns=SECURITY_CODE&sortTypes=1`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const j = await r.json();
    const list = (j.result && j.result.data) || [];
    if (!Array.isArray(list)) return [];
    return list;
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  let all = [];
  let page = 1;
  while (true) {
    const list = await fetchPage(page);
    if (!list.length) break;
    all = all.concat(list);
    if (list.length < PAGE_SIZE) break;
    page++;
    if (page > 60) break; // 安全上限
  }
  const stocks = all.map(x => {
    const code = String(x.SECURITY_CODE).trim();
    const name = String(x.SECURITY_NAME_ABBR || '').replace(/\s/g, '');
    return { code, name, prefix: prefix(code) };
  }).filter(x => /^\d{6}$/.test(x.code) && x.name);
  // 去重
  const seen = new Set();
  const dedup = stocks.filter(x => { if (seen.has(x.code)) return false; seen.add(x.code); return true; });
  const out = path.join(__dirname, '..', 'data', 'stocks.json');
  fs.writeFileSync(out, JSON.stringify(dedup));
  console.log(`写入 ${dedup.length} 只股票 -> ${out}`);
})().catch(e => { console.error('抓取失败:', e.message); process.exit(1); });
