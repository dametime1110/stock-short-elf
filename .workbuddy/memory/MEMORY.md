# 股票短线精灵 · 项目记忆

## 产品定位
- 股票短线精灵：AI 短评工具，需结合「筹码峰 + 资金面 + K线 + 重大消息」→ 短评 + 短期应对策略 + 短期走势预测（基准/乐观/悲观三情景）。
- 形态：云原生 Web（电脑+手机同一链接、无 IP 要求）。首选"能直接装"太麻烦就跳过，采用链接形态；可加 PWA 到主屏幕近似 App。

## 关键结论
- 用户是**普通同花顺用户，无 iFinD OpenAPI/量化权限** → 部署后的 App 不能直连 iFinD 取数。
- 数据层转向：**东方财富(East Money)免费公开接口**（无需 key/权限，覆盖 K线/资金流/估值/新闻）；筹码峰继续由 K线+成交量自算 CYQ。这样部署版可全市场实时查询、零权限依赖。
- iFinD MCP 仅作「Agent 桌面通道」：用户在对话里问我，我用 MCP 拉真实数据生成短评（已验证 4 只样本）。
- 模型：hy3（默认）/ step5 切换 = **step5 仅是 hy3 免费额度耗尽时的备用模型**（用户原话）。设计为：默认调 hy3，遇额度/报错自动回退 step5，外加手动开关。统一 JSON schema 输出。
- 部署：GitHub 托管 → Vercel/Cloudflare 自动部署。
- 降级通道：App 无数据/无密钥时，用户用手机同花顺投喂数据，Agent 生成短评。

## 当前进度（2026-10-19）
- 原型已构建并推送到 GitHub：https://github.com/dametime1110/stock-short-elf （含 index.html 前端 + api/analyze.js 后端 + vercel.json + README）。
- 4 只样本股用 iFinD 真实数据 + AI 双模型(hy3/step5)短评已内嵌。

## 当前状态（2026-10-19 已部署 · 全市场监测版）
- **公网链接（手机/电脑通用）**：https://stock-short-elf.app.workbuddy.host/?sharecode=3MXZOXM2SW
- 数据源（全部免费公开、零 key）：**腾讯财经（主，批量实时报价+K线+估值，带交易所时间戳）+ 新浪财经（备）+ 东方财富（资金流/公告/datacenter 清单）**。同花顺免费公开行情已下线（404），不采用。
- **全市场实时监测已上线**：5198 只 A 股清单固化为 `data/stocks.json`（scripts/fetch_stocks.js 可刷新）；`/api/quotes` 批量报价、`/api/market` 全市场快照（约 0.3s 全量）+市场广度+涨/跌/涨停/跌停榜；前端三页签（个股/自选监测/全市场）+ 30s 自动刷新 + 数据延迟显示。线上已验证 5198/5198 全覆盖。
- 4 只示例股（茅台/宁德/比亚迪/东财）含 AI 范例短评（hy3+step5 双版）；其余股票走规则速评；hy3/step5 可切换展示。
- 部署方式：发布为应用（Node 服务 server.js，监听 PORT），无需用户注册账号。GitHub 仓库同步：https://github.com/dametime1110/stock-short-elf（commit 339a812）
- 前端 fetch 需透传链接里的 `?sharecode=` 才能通过代理鉴权（已修复）。
- ⚠️ 沙箱限制：本地后台 Node 进程被禁网（前台 fetch 正常），故接口验证走前台脚本 `scripts/test_market.js`；沙箱出口 IP 曾被东财 push2 临时限流。

## 下一步（可选）
1. 用户想要"全市场 + 真·AI 短评"自治：需提供大模型 API key（HY3/STEP5 的 base_url+key+model），接通 analyzer 的 LLM 分支。
2. 主力资金流接口（东财 push2）在部分沙箱环境被限流时优雅降级为"暂不可用"；线上一般可用。
3. 可加 PWA manifest / 自选股云端同步 / 盘中异动推送。
