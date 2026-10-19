// Vercel Serverless 兼容版（与 server.js 共用核心逻辑）
const { analyze, search } = require('../lib/analyzer');

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const code = url.searchParams.get('code');
  const q = url.searchParams.get('q');

  if (url.pathname === '/api/search' || q) {
    const list = await search(q || '');
    return res.status(200).json({ ok: true, list });
  }
  if (!code) return res.status(400).json({ ok: false, msg: '缺少 code 参数' });
  try {
    const data = await analyze(code);
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ ok: false, msg: String(e.message || e) });
  }
};
