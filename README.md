# 股票短线精灵 · Stock Short Elf

结合 **筹码峰 + 资金面 + K线 + 重大消息** 的 AI 短评工具。查询任意 A 股后，输出：
四维度解读 → 综合短评 → 短期应对策略 → 短期走势预测（基准/乐观/悲观三情景）。

## 特性
- 📱 电脑 / 手机同一链接可用，无 IP 要求（响应式 Web）
- 🌐 **全市场实时监测**：5198 只 A 股实时快照（约 0.3 秒全量刷新），市场广度（涨/跌/涨停/跌停）、涨幅榜、跌幅榜
- ⭐ **自选股实时监测**：自选列表 30 秒自动刷新，实时价格 + 数据延迟显示
- 📊 K线蜡烛图、由 K线+成交量自算的筹码峰（CYQ）、资金面、消息面
- 🤖 4 只示例股内置 **AI 范例短评**，其余股票由规则引擎生成速评；支持 hy3 / step5 切换展示
- 🔌 **零权限取数**：腾讯财经 / 新浪财经 / 东方财富公开接口（无需 iFinD 账号、无需 API key）
  - 注：同花顺免费公开行情接口已下线（404），故不采用；同花顺 App 仅供用户自行看盘

## 数据来源
- 全市场实时报价：腾讯财经批量接口（主，含交易所时间戳）→ 新浪财经（备）
- K线 / 估值（PE·PB·市值）：腾讯财经公开接口，东方财富作兜底
- 主力资金流 / 公告：东方财富公开接口（资金流不可用时优雅降级）
- 全市场股票清单：东方财富 datacenter 抓取后固化为 `data/stocks.json`（5198 只，部署零依赖）
- 筹码峰：由近 120 日 K线 + 成交量按 CYQ 移动成本分布模型自算（获利比例 / 平均成本 / 集中度 / 密集价）
- 技术指标：MACD(12,26,9)、RSI(14) 自算

## 本地运行
```bash
node server.js          # 监听 http://localhost:3000
# 或自定义端口
PORT=8080 node server.js
```
浏览器打开 http://localhost:3000 即可。直接双击 `index.html` 也能看（内置 4 只示例股离线兜底）。

## 部署（一键发布 / Vercel / Cloudflare）
- 一键发布：直接把本目录作为 Node 应用发布，得到一个公网链接，手机浏览器打开即用，可「添加到主屏幕」近似 App。
- Vercel / Cloudflare Pages：导入仓库即可。`api/analyze.js` 为 Vercel Serverless 兼容版，`server.js` 为通用 Node 服务。

## 目录
- `index.html`：前端（三页签：个股 / 自选监测 / 全市场，响应式 + ECharts）
- `lib/analyzer.js`：核心分析模块（多源取数 + CYQ + 指标 + 规则速评 + 内置 AI 范例 + 全市场快照）
- `server.js`：Node 服务（`/api/analyze` + `/api/search` + `/api/quotes` + `/api/market`）
- `api/analyze.js`：Vercel Serverless 兼容版
- `data/stocks.json`：全市场股票清单（5198 只）
- `scripts/fetch_stocks.js`：刷新全市场清单脚本
- `scripts/test_market.js`：行情管道自测脚本
- `vercel.json`：部署配置

> ⚠️ 投资有风险，本工具仅为信息聚合与辅助分析，不构成投资建议。
