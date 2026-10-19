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

  // 静态前端（no-store：修复后用户刷新必须立刻拿到新版，避免旧版 JS 缓存导致"搜索不切换"）
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, must-revalidate', 'Pragma': 'no-cache' });
  res.end(HTML);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('股票短线精灵 running on http://0.0.0.0:' + PORT);
});

/* ===== 进程级"内置看门狗"（2026-10-20 加）=====
   无状态 HTTP 服务，任何逃逸的未捕获异常（定时器回调/流事件/异步链外抛错）
   都不应该让整个进程退出——否则服务会挂到平台重启为止。
   这里捕获并记录，服务继续对外响应。 */
process.on('uncaughtException', e => {
  console.error('[看门狗·未捕获异常 已兜底，服务继续运行]', (e && e.stack) || e);
});
process.on('unhandledRejection', e => {
  console.error('[看门狗·未处理的Promise拒绝 已兜底，服务继续运行]', (e && e.stack) || e);
});

/* 心跳日志：每 5 分钟一行，平台日志里可确认服务还活着（排查看门狗是否需要外部介入） */
const _hb = setInterval(() => {
  console.log('[心跳] ' + new Date().toISOString() + ' alive, uptime=' + Math.round(process.uptime()) + 's');
}, 5 * 60 * 1000);
_hb.unref();
