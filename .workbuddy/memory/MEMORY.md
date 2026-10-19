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

## 待确认（部署前）
1. 部署平台（Vercel vs Cloudflare）
2. ~~iFinD REST/SDK 凭证~~ → 已改为东财免费接口，无需此凭证
3. ~~hy3/step5 API 接入~~ → 用户无 LLM API key 且不熟悉技术概念；live 短评优先走「Agent 对话生成」，部署版 App 先以「实时数据 + 样本短评」形态交付，待用户日后有 key 再接通自治短评。
4. 部署后 env（仅自治模式需要）：HY3_BASE_URL/KEY、STEP5_BASE_URL/KEY、ACTIVE_MODEL（无需 IFIND_TOKEN）
