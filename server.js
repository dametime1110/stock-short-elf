// 股票短线精灵 · Node 服务（静态前端 + API）
// 本地：node server.js  →  http://localhost:3000
// 部署：监听 0.0.0.0:$PORT
const http = require('http');
const fs = require('fs');
const path = require('path');
const { analyze, search, getLiveQuotes, getMarketView, refreshStockList } = require('./lib/analyzer');

const PORT = process.env.PORT || 3000;
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const sendJSON = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  if (u.pathname === '/api/analyze') {
    const code = u.searchParams.get('code');
    if (!code) return sendJSON(400, { ok: false, msg: '缺少 code 参数' });
    try {
      const data = await analyze(code);
      sendJSON(200, data);
    } catch (e) {
      sendJSON(502, { ok: false, msg: String(e.message || e) });
    }
    return;
  }

  if (u.pathname === '/api/search') {
    const q = u.searchParams.get('q') || '';
    try {
      const list = await search(q);
      sendJSON(200, { ok: true, list });
    } catch (e) {
      sendJSON(200, { ok: true, list: [] });
    }
    return;
  }

  if (u.pathname === '/api/quotes') {
    const raw = u.searchParams.get('codes') || '';
    const codes = [...new Set(raw.split(',').map(s => s.trim().replace(/\D/g, '')).filter(c => c.length === 6))];
    if (!codes.length) return sendJSON(400, { ok: false, msg: '缺少有效的 codes' });
    try {
      const { source, map } = await getLiveQuotes(codes);
      const list = codes.map(c => map[c]).filter(Boolean);
      sendJSON(200, { ok: true, source, updatedAt: Date.now(), list });
    } catch (e) {
      sendJSON(502, { ok: false, msg: String(e.message || e) });
    }
    return;
  }

  if (u.pathname === '/api/market') {
    const mode = u.searchParams.get('mode') || 'up';
    const limit = Math.min(parseInt(u.searchParams.get('limit') || '30', 10) || 30, 100);
    const force = u.searchParams.get('force') === '1';
    try {
      const data = await getMarketView(mode, limit, force);
      sendJSON(200, data);
    } catch (e) {
      sendJSON(502, { ok: false, msg: String(e.message || e) });
    }
    return;
  }

  // 静态前端
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('股票短线精灵 running on http://0.0.0.0:' + PORT);
});
