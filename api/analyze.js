// Vercel Serverless 兼容版（与 server.js 共用核心逻辑）
const { analyze, search, getLiveQuotes, getMarketView } = require('../lib/analyzer');

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const code = url.searchParams.get('code');
  const q = url.searchParams.get('q');

  if (url.pathname === '/api/search' || q) {
    const list = await search(q || '');
    return res.status(200).json({ ok: true, list });
  }

  if (url.pathname === '/api/quotes') {
    const raw = url.searchParams.get('codes') || '';
    const codes = [...new Set(raw.split(',').map(s => s.trim().replace(/\D/g, '')).filter(c => c.length === 6))];
    if (!codes.length) return res.status(400).json({ ok: false, msg: '缺少有效的 codes' });
    try {
      const { source, map } = await getLiveQuotes(codes);
      const list = codes.map(c => map[c]).filter(Boolean);
      return res.status(200).json({ ok: true, source, updatedAt: Date.now(), list });
    } catch (e) {
      return res.status(502).json({ ok: false, msg: String(e.message || e) });
    }
  }

  if (url.pathname === '/api/market') {
    const mode = url.searchParams.get('mode') || 'up';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 100);
    const force = url.searchParams.get('force') === '1';
    const top = Math.min(parseInt(url.searchParams.get('top') || '300', 10) || 300, 1000);
    try {
      const data = await getMarketView(mode, limit, force, top);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(502).json({ ok: false, msg: String(e.message || e) });
    }
  }

  if (!code) return res.status(400).json({ ok: false, msg: '缺少 code 参数' });
  try {
    const data = await analyze(code);
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ ok: false, msg: String(e.message || e) });
  }
};
