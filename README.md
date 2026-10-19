# 股票短线精灵 · Stock Short Elf

结合 **筹码峰 + 资金面 + K线 + 重大消息** 的 AI 短评工具。查询任意股票后，输出：
四维度解读 → 综合短评 → 短期应对策略 → 短期走势预测（基准/乐观/悲观三情景）。

## 特性
- 📱 电脑 / 手机同一链接可用，无 IP 要求（响应式 Web）
- 📊 K线蜡烛图、由 K线+成交量自算的筹码峰（CYQ）、资金面、消息面
- 🤖 AI 短评，支持 **hy3 / step5** 模型热切换
- 🔌 数据源自同花顺 iFinD；部署版可接入 iFinD REST/SDK + 可切换大模型

## 本地预览
直接用浏览器打开 `index.html` 即可（需联网加载 ECharts CDN）。

## 部署（GitHub → Vercel / Cloudflare）
1. 将本仓库推到 GitHub（已验证 GitHub MCP 可用）。
2. 在 Vercel / Cloudflare Pages 导入该仓库，框架选「Other」，输出目录为根目录。
3. 配置环境变量（可选，不配则用内置 DEMO 数据）：
   - `IFIND_TOKEN`：同花顺 iFinD REST/SDK 凭证（用于取全市场数据）
   - `LLM_BASE_URL` / `LLM_API_KEY`：大模型服务地址与密钥
   - `ACTIVE_MODEL`：`hy3` 或 `step5`（默认 hy3）
4. 部署后得到一个公网链接，电脑/手机浏览器打开即用，可「添加到主屏幕」近似 App。

## 目录
- `index.html`：前端原型（响应式 + ECharts）
- `api/analyze.js`：分析后端（取数 → 大模型 → 结构化短评；含 DEMO 回退）
- `vercel.json`：部署配置

> ⚠️ 投资有风险，本工具仅为信息聚合与辅助分析，不构成投资建议。
