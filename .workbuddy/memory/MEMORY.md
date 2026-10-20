# 股票短线精灵 · 项目记忆

## 产品定位
- 股票短线精灵：AI 短评工具，需结合「筹码峰 + 资金面 + K线 + 重大消息」→ 短评 + 短期应对策略 + 短期走势预测（基准/乐观/悲观三情景）。
- 形态：云原生 Web（电脑+手机同一链接、无 IP 要求）。首选"能直接装"太麻烦就跳过，采用链接形态；可加 PWA 到主屏幕近似 App。

## 关键结论
- 用户是**普通同花顺用户，无 iFinD OpenAPI/量化权限** → 部署后的 App 不能直连 iFinD 取数。
- 数据层转向：**东方财富(East Money)免费公开接口**（无需 key/权限，覆盖 K线/资金流/估值/新闻）；筹码峰继续由 K线+成交量自算 CYQ。这样部署版可全市场实时查询、零权限依赖。
- iFinD MCP 仅作「Agent 桌面通道」：用户在对话里问我，我用 MCP 拉真实数据生成短评（已验证 4 只样本）。
- 模型：hy3（默认）/ step5 切换 = **step5 仅是 hy3 免费额度耗尽时的备用模型**（用户原话）。设计为：默认调 hy3，遇额度/报错自动回退 step5，外加手动开关。统一 JSON schema 输出。
- 部署：**发布为应用（Node 服务 server.js，监听 PORT）** 上线到公网链接 https://stock-short-elf.app.workbuddy.host/?sharecode=3MXZOXM2SW ；GitHub 仓库同步仅为备份。用户要求：**改完代码默认直接部署到该链接，不再单独询问是否发布**（"默认以后都更新到链接"，2026-10-20 起）。
- 降级通道：App 无数据/无密钥时，用户用手机同花顺投喂数据，Agent 生成短评。

## 当前进度（2026-10-19）
- 原型已构建并推送到 GitHub：https://github.com/dametime1110/stock-short-elf （含 index.html 前端 + api/analyze.js 后端 + vercel.json + README）。
- 4 只样本股用 iFinD 真实数据 + AI 双模型(hy3/step5)短评已内嵌。

## 关键 bug 档案（2026-10-20 修复）
- **K线字段名不匹配**：analyzer getKline 返回全名 `date/open/close/high/low/volume`，前端图表期望简写 `d/o/c/h/l/v` → render 抛错 → 所有股票静默掉进 FALLBACK_DATA（4 只内嵌样本）→ 用户看到"搜什么都是茅台/东财"。修复：前端 normKlines() 归一化 + render 分区容错 + server.js no-store。commit 967b9ad。
- 教训：接口字段与前端不一致 + catch 静默兜底 = bug 被掩盖；兜底数据应在 UI 显式标注（_fallback 标记待加）。

## 当前状态（2026-10-19 已部署 · 全市场监测版）
- **公网链接（手机/电脑通用）**：https://stock-short-elf.app.workbuddy.host/?sharecode=3MXZOXM2SW
- 数据源（全部免费公开、零 key）：**腾讯财经（主，批量实时报价+K线+估值，带交易所时间戳）+ 新浪财经（备）+ 东方财富（资金流/公告/datacenter 清单）**。同花顺免费公开行情已下线（404），不采用。
- **全市场实时监测已上线**：5198 只 A 股清单固化为 `data/stocks.json`（scripts/fetch_stocks.js 可刷新）；`/api/quotes` 批量报价、`/api/market` 全市场快照（约 0.3s 全量）+市场广度+涨/跌/涨停/跌停榜；前端三页签（个股/自选监测/全市场）+ 30s 自动刷新 + 数据延迟显示。线上已验证 5198/5198 全覆盖。
- 4 只示例股（茅台/宁德/比亚迪/东财）含 AI 范例短评（hy3+step5 双版）；其余股票走规则速评；hy3/step5 可切换展示。
- 部署方式：发布为应用（Node 服务 server.js，监听 PORT），无需用户注册账号。GitHub 仓库同步：https://github.com/dametime1110/stock-short-elf
- 前端 fetch 需透传链接里的 `?sharecode=` 才能通过代理鉴权（已修复）。
- ⚠️ 沙箱限制：本地后台 Node 进程被禁网（前台 fetch 正常），故接口验证走前台脚本 `scripts/test_market.js`；沙箱出口 IP 曾被东财 push2 临时限流。

## 评分体系 + 主力吸筹识别（2026-10-20 已上线）
- **综合评分**（个股页评分卡 0-100）：computeDeepScore 八维=技术±22/资金±18/筹码±10/动量±14/RSI±8/今日走势±12/波动率惩罚/**吸筹潜伏±14**；全市场榜单：🏆评分榜(快照实时分)、🎯综合榜(今日走势55%+短期K线45%，前300候选，缓存10分钟)、**🕵️吸筹榜(涨停前潜伏清单，快照预筛150只+拉K线，缓存10分钟，实测61只上榜)**。
- **主力吸筹识别** computeAccumulation（七维：位置18/横盘12/温和放量25/吸筹K线15/资金持续流入15/波动收敛8/均线粘合7）→ accScore 0-100 + phase(none/quiet/accumulating/launched/topping) + signals 特征命中。设计红线：**accumulating 必须有量或资金确认**（否则 quiet），避免低位无人横盘误报；launched=近3日最大涨幅≥7.5%/今日涨停；topping=高位放量滞涨。历史日复算版 computeAccumulationKL（无快照/资金流）用于5日小球。
- 5日趋势小球 dailyScores：K线逐日复算（含吸筹±9），可看到涨停前几天的分数爬坡。
- 测试资产：scripts/test_accumulation.js（合成K线 14/14）、scripts/test_real_analyze.js（真实数据抽查）。

## 韭菜指数上云（2026-10-19 23:40 完成 · 含后台定时刷新）
- **已实现"不开电脑也能更新"**：Desktop 完整版重新发布为应用（覆盖原 10-17 早期版），云端模式（不设 PUSH_URL）自取数据。
- 验证：/api/refresh 触发云端自取成功——`self_fetched:true`、911 板块（行业+概念，腾讯源）、六维权重不变、13 秒出数、非 demo。
- 机制：电脑开 → 本地推送优先（15 分钟窗口，含 iFinD 校对更准）；电脑关 → 推送过期后云端自取顶上（/api/leek 缓存 TTL 180s，打开即 3 分钟内新鲜）。
- **云端后台定时刷新已实现（23:40）**：server.py 新增 `_cloud_background_refresh` 守护线程——推送过期（电脑关机）时每 5 分钟（工作日 9:00-15:30）/30 分钟（休市）自取 build_payload，落盘 pushed.json + 更新缓存 + 记历史；用户不打不开网页数据都在更新。关键细节：`_push_fresh` 需排除 `self_fetched` 标记（否则自取数据被误判为"本机刚推过"导致停更）；自取用单飞锁 `_cloud_fetch_lock`（后台线程/手动刷新/请求三处共用，防并发构建）。
- 项目零第三方依赖（主链路全标准库），server.py 监听 0.0.0.0:$PORT，三形态（本机推送/云端接收/refresh）内置。
- ⚠️ 发布注意：部署沙箱 Python 自动启动入口找 `main.py`，本项目入口是 `server.py` → 必须显式传 `startCmd="python server.py"`，否则 SITES_START_FAILED（2026-10-19 已踩坑）。
- 已知限制：①云端东财 push2 不可达（IP 封），靠腾讯源 911 板块（比东财 ~1000 少长尾专属名）；②小单率维度依赖尾盘逐笔聚合（本机行为），非尾盘云端自取时该维度缺失，按可用权重归一化（不掺假）。

## 下一步（可选）
1. 用户想要"全市场 + 真·AI 短评"自治：需提供大模型 API key（HY3/STEP5 的 base_url+key+model），接通 analyzer 的 LLM 分支。
2. 主力资金流接口（东财 push2）在部分沙箱环境被限流时优雅降级为"暂不可用"；线上一般可用。
3. 可加 PWA manifest / 自选股云端同步 / 盘中异动推送。
