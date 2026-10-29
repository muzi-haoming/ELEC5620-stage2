# 本次验证记录 · 2026-10-22

## 已实测

- Python 3.12.15；本机独立 PostgreSQL 17，loopback 55432。
- 后端 17 项测试通过，使用隔离的 secondspace_test 数据库和显式模型 fixture。
- 前端原规则 23 项测试通过；Vite production build 通过。
- Edge headless 完整网页流程通过：卖家上架、推荐、Visa、物业回复、取货、送达、验收自动结算、卖家明细、管理员政策、BPAY。
- 两个独立浏览器 context：物业提交后买家轮询收到更新；英文字段名正确；买家时间线无 Agent 名称，管理员可见；管理员无待结算。
- 真实 HEIC 样本解码；正好 15 MiB 接收；15 MiB + 1 字节拒绝；无效文件拒绝。
- 两个并发购买请求仅一个成功；重复验收只生成一笔结算；非法操作不提交业务状态。
- PostgreSQL LangGraph checkpoint 可用新 graph 实例读取并恢复人工处理；已完成的政策不改变固定买家总价。
- 实际重启 API 后，11 条现有演示订单的 ID、状态、结算标识保持一致。
- 部署 YAML 可解析；PowerShell 部署脚本语法解析通过。
- Git 跟踪文件扫描：未包含文档中的模型密钥、私有 .env 或 .runtime 数据。

## 真实模型证据与限制

- campus-qwen 文本调用曾成功提取 `绿色、布艺、双人、扶手`。
- 也观察到空偏好结果；当前版本对已有关键词但模型返回空值的情况使用明确记录的 keyword_fallback_empty。
- 图片请求遇到 OpenAIRateLimitError，真实视觉审核尚未通过验收；不能把演示照片或 fixture 的通过视为真实图片审核证据。
- 模型可达性会随校园网络/服务配额变化，health 只检查数据库，不宣称模型健康。

## 尚未实测的外部步骤

- Azure PostgreSQL：未收到 Azure 资源/连接配置，本次运行的是本地 PostgreSQL。
- Docker/kind：本机缺少容器引擎、kind、kubectl，已准备 Dockerfile、Compose、Kubernetes/PVC/Secret 和部署脚本，尚未运行 rollout。
- GitHub：仓库可克隆，但非交互推送检查无可用登录凭据。改动保存在本地开发分支，未推送、未创建 PR、未独立审核。

原 5621 前端和旧浏览器数据保留；新版预览为 5622。


## 云端接入与模型修复补充（2026-10-22，覆盖上述旧状态）

- 服务商已由 Azure 改为 Google Cloud SQL，PostgreSQL 18.6；连接和只读查询成功，TLS 1.3。
- 独立数据库 secondspace_mvp_20261022 已迁移 15 张业务/checkpoint 表；与本地备份逐表内容摘要完全一致，原有 11 条订单保留。默认应用已切换云端。
- 后续新增订单后，重启 API 验证 12 条订单 ID、状态、结算时间保持一致。
- 校园模型：真实文本解析与缩小后的三图调用通过。重复 front 图片作为三个方向提交，返回完整 JSON 并拒绝；经真实上传/API/ListingAgent/PricingAgent/SupervisionAgent 的链路也保存了校园模型拒绝原因。
- 先前三图 ValidationError 定位为推理占用 512 token 输出额度、finish_reason=length。额度改为 2048，保留类型校验，另设 ModelOutputTruncated 分类。
- 新增图片缩放保留原图、截断分类、结构化响应测试；后端合计 20 项通过。前端 23 项规则测试通过，production build 通过。
- 云连接延迟曾导致网页加载超过测试窗口。引入连接池、合并读取、事务批量写入和单个轮询请求控制；跨物业/买家/管理员导航专项测试已通过。
- Docker/WSL 尚未安装，容器部署仍未实测。Git 非交互推送仍因缺少登录凭据失败。
- 更正（2026-10-23）：照片由 ListingAgent 自动审核，不要求组员人工验收或人工放行。重复角度负例测试不等于完整准确率评估；真实照片正例准确率基准尚未建立，属于测试覆盖限制。

- 云端完整浏览器流程最终重跑通过：卖家 → 推荐 → Visa → 物业 → 配送 → 验收/结算 → 管理员政策展示 → BPAY。无页面脚本错误，未持久化卡信息。政策已生效时测试校验现行政策，不重复处理历史案件。

- 两个独立浏览器的物业同步、中英文字段、买家 Agent 隐藏、管理员 Agent 可见及四状态映射在云端再次通过。
- 真实加载后的 16 个桌面/手机路由检查通过，无渲染异常或横向溢出。
- 云端 LangGraph 人工中断：关闭连接并重建图后仍恢复到 HumanReview，提交处理理由后成功继续结束；该独立检查不更改订单或现行政策。

## GitHub 与 Docker 安装补充

- 用户最终选择 GitHub.com 的 hrw8701-cyber，经个人 fork 向原团队仓库 muzi-haoming/ELEC5620-stage2 提交 PR #1。学校 hwan9982 仓库仅保留私有备份，学校 PR 已关闭。
- GitHub CI 运行 39734118135 成功：隔离 PostgreSQL 后端测试、前端规则测试/构建、Python 后端和 Nginx 前端 Docker 镜像构建均通过。学校服务器 Actions 不算入该结果。
- WSL 3.0.3.0 与 Docker Desktop 4.96.2 安装完成，Engine 29.9.2 已运行，无需重启。程序 D:\tools\Docker，数据 D:\tools\DockerData。详见 LOCAL-SETUP.md。
- Compose 连接真实 Cloud SQL，容器内真实 campus-qwen 文本解析通过。迁移后的 IMG 图片 HTTP 返回内容与本地原件摘要一致。
- 首次多个浏览器测试并行时观察到云响应超时；临时栈诊断显示等待数据库网络响应，无数据库锁阻塞。恢复正常启动、串行重跑后，完整流程通过：卖家上架 → 推荐 → Visa → 物业回复 → 配送 → 验收即时结算 → 管理员政策 → BPAY；无页面脚本异常且不保存卡号。
- .runtime/compose-browser-result.json 保存本次容器完整流程结果；暂时诊断启动配置未进入交付配置。
- Compose 串行补充验收通过：16 个桌面/手机页面；独立浏览器物业回复同步；英语时段/电梯/装卸字段；买家 System message 与管理员 Agent 名称隔离；管理员无待结算状态。
- 已保留 Compose uploads 卷并关闭其容器，为 kind 释放 5623 端口；切换前订单摘要保存在 .runtime/before-kind-orders.json。
- kind/Kubernetes 已部署：后端与前端 Pod 均 1/1 Ready，uploads PVC Bound（2 GiB），5623 NodePort 经 loopback 暴露。
- Pod 内 Cloud SQL TLS 和真实 campus-qwen 文本调用通过。Compose → kind 切换后 19 条订单 ID、状态、结算时间一致。
- 图片迁移脚本修复卷根目录权限问题：归档仅包含源目录下的条目，不再归档根目录本身；保留原图。kind 媒体 HTTP 内容与原文件一致。
- kind 入口实际加载的 16 个桌面/手机路由与跨物业/买家/管理员导航全部通过。
- kind pricing Agent 图调用及 command receipt 写入通过；随后替换 backend Pod，19 条订单及上传图片保持一致。
- 最终源码 82 个文件对实际模型密钥/数据库密码扫描，零命中。安装/启动/复制脚本语法检查通过，当前 kind 的双击容器启动路径实际执行通过。

## 2026-10-23 职责更正

删除交付文档中误加的“真实照片人工验收”要求。核对当前 ListingAgent、上架 API、领域状态和图路由：listing 自动执行审核并返回 published/rejected，只有 conflict 在缺少适用政策时进入 HumanReview。没有修改上架运行逻辑；没有将既有 fixture 测试描述为真实模型准确率验证。其余人工参与点已逐项列于 HUMAN-INVOLVEMENT.md，异常分支待产品方核对。

## 2026-10-23 手动公开比价与照片类别门槛

- 隔离数据库后端 35 项测试通过；前端原有 23 项领域测试通过；React 生产构建通过。
- pricing-ui.mjs 在浏览器验证：新业务空参考价、填写或切换类别不发请求、按钮才发送完整家具资料、资料变化不自动改价、旧结果不可直接应用、新业务清空、中英按钮切换。此测试的估价响应明确为拦截测试数据。
- 公开站点实时抓取成功：沙发、床及其他家具目录均能取得在售 AUD 二手商品。没有使用 eBay 凭据，未绕过 eBay/Gumtree 的访问拒绝。
- 校园模型真实视觉调用：自行生成的人物卡通测试图被拒绝为非家具；真实沙发图片标注“床”被拒绝为类别不符（同时识别出重复方向）。这不代表所有图片识别准确率已获验证。
- 批量比较曾出现输出截断和 HTTP 502；已改为每3条顺序比较，并缩短模型输入与输出。布艺沙发真实比对完成，因可比样本不足返回空价，没有平台均价回退。
- 本轮不修改公开比价说明中列出的其他待讨论逻辑。

- 最终真实公开比价案例：Fabric sofa，fabric，良好，2年，200×90×85 cm；完整查询及校园模型四批比较后选出3个可比商品，返回 AUD 570（相似度加权中位数）。比对项仍存在年限/尺寸缺失，结果保留 unknowns；该金额不是预置测试价。结果证据保存于本机私有 .runtime/public-pricing-last-live.json。


## 2026-10-23 会议设计落地（当前版本）

- 5623 kind部署已更新，连接原Cloud SQL；保留已有业务数据。
- 公开参考资料35条入库；PricingAgent本地属性匹配与折算。按钮醒目且仅手动触发，新业务空价。真实5623估价接口返回AUD670、4条公开来源；详情见PUBLIC-PRICING.md。
- 图片校验失败统一用户文案；管理员保留详细原因。隔离测试确认非家具/类别不符不调用定价。
- 配送按取送地址分区估算，不使用Google Maps，不声称真实距离。同区可能同价；无法识别的地址使用默认分区。浏览器实测Glebe经济/快捷为75/110，Penrith为145/194。固定报价保存当时配送费，后续不重算历史订单。
- 演示时钟按真实秒持续前进，业务时间允许不同于真实日期；跨角色共享同一runId。刷新和服务重启不重新开始，重置全部演示数据才建立新run；手动推进后继续计时。后端报价有效期和日志使用该时钟。
- 后端42项隔离数据库测试、前端23项领域测试、生产构建通过。5623浏览器测试通过：初始空价、手动请求、中英切换、资料变更不自动重算、持续时钟、地址差异价格；无页面脚本错误。未重置生产数据。
- 已知待讨论事项仍在PUBLIC-PRICING.md；没有扩大修改异常处理、动态政策或视觉风险识别范围。公开资料刷新目前为维护脚本操作，非自动定时任务。


## 2026-10-26 审核与上传错误文案修正

将PricingAgent前置审核失败分为 input_invalid、photo_rejected、review_busy、review_timeout、review_unavailable。缺失字段、校园模型HTTP429、超时、网络/鉴权/服务/模型输出异常不再显示为图片政策违规；管理员保留原始分类原因，卖家只收到可操作的安全文案。上架审核服务故障仍按既有数据状态保留记录，但提示“审核暂未完成，资料已保留”，不要求修改图片。

上传端保留大小、格式、空文件、文件无法读取等具体提示，并处理网络失败、HTTP413/429/5xx、非JSON响应。中英文文案均已补齐。图片内容不合格仍用统一政策文案，未放宽审核规则、估价阈值或增加重试/新业务状态。

52项后端测试、23项前端领域测试、生产构建通过。kind 5623已部署且健康；review-messages-ui.mjs以拦截响应验证不同提示、英语繁忙文案和空文件提示，明确不以此作为实际模型调用成功证明。


## 2026-10-26 校园视觉请求输入限制

实际检查电竞椅上架失败的服务响应：HTTP429，code=input_tokens_too_large，message=Input token limit exceeded，无Retry-After。不是普通频率限流。审核推理副本由最长边512/质量75改为最长边不超过256/质量45并优化JPEG，原始上传和页面预览不变。错误分类优先识别该服务错误码，提示输入限制、审核未完成，不提示无效的等待重试。

在运行容器内，对同一份已保存电竞椅资料进行无写入真实审核：压缩后模型调用成功，返回方向与一致性不合格（缺少真正俯视、侧面栏为正面、颜色/款式可能不一致）。这证明输入阻塞已消除，不代表该家具已通过审核或已上架。模型判断仍可能有误；未绕过视觉门槛或自动修改用户照片。降低推理分辨率可能降低细节识别能力，当前MVP以类别、方向和基本一致性为目的。


## 2026-10-26 家具类别不一致的字段提示

ListingAgent对真实家具的category_match=false单独输出category字段错误，估价返回category_mismatch。卖家估价提示和类别字段、上架失败字段均明确说明类别不一致，提示椅子/桌子/柜子选择其他。非家具、角度、清晰度及服务故障保持原有独立处理，不因分类消息变更自动放行。保留结构化视觉结果供管理员查看。中英文同步；55项后端测试及生产构建通过。


## 2026-10-29 实时外部查询与可解释估价

按最新要求替换仅数据库定价：手动点击后先校验必要资料和照片，通过才实时调用Cash Converters公开匿名搜索接口及现有公开来源，再验证商品页并存储依据。1–2样本按用户确认仍给估价并标注样本有限。无样本或来源失败不声称表单错误；未知材质、输入范围等明确定位字段。椅子异常尺寸仅提示核对，不自动修改。修正成色文本“no damage”的否定语义误判。

验证：61项后端测试、23项前端领域测试、生产构建通过。5623浏览器拦截测试通过：手动触发、材质字段错误、少样本提示、计算说明、中英切换。真实联网测试（绕过视觉环节，单独验证PricingAgent）：电竞椅/其他/混合/良好/2年/70×70×125cm，取得11条商品，2条可比，返回AUD119.99，sampleLimited=true，1个来源失败；选定来源conditionFactor=1、ageFactor=1。该尺寸是测试参数，不是用户原图家具尺寸，也不是对用户家具的最终报价。结果保存在本机.runtime/live-pricing-oct29.json。

kind版本已部署且数据库健康。没有改视觉角度审核标准；没有把市场无样本当作阻止合格家具自行定价上架的理由。新来源非官方稳定开发者API，页面结构和接口未来可能变化。

## 2026-10-29 Role themes, pending interaction and execution evidence
- Buyer blue, seller green, manager/founder purple use matching HSL saturation/lightness. Theme changes are frontend-only.
- Shared buttons show a spinner while awaiting click handlers; submit buttons follow pending server operations. Store blocks overlapping commands, shows an accessible progress notice, and adds a longer-wait message after 8 seconds. Pricing and matching explicitly expose their busy state.
- New order events and agent audit records persist request ID and the actual graph decisions. Specialist nodes record elapsed milliseconds and actual model-call outcome; matching with empty text no longer labels keyword processing as a model call.
- Manager-only expanders display execution summaries and call metadata, not hidden model reasoning. Historical events explicitly lack call evidence. Both public state and action-result serializers remove execution details.
- Validation: backend 63 passed; frontend domain 23 passed; production build; role-loading-ui browser checks (delayed mock responses, no production mutations) and pricing-explanation-ui passed. kind rollout and health on port 5623 passed. No live AI request was needed for this presentation change.

## 2026-10-29 Theme readability correction
- Restored seller forest green (#214f43) with original yellow pricing action; buyer uses burnt orange and warm ivory; founder/manager uses charcoal navigation, gold actions and an ivory content canvas.
- Added frontend/src/themes.css with paired surface/text tokens covering role canvas, sidebar, forms, tabs, hover/selected/disabled states, badges, tables, charts, timelines, modals and progress feedback. Semantic success/warning/error colours remain distinct.
- Removed the previous partial role overrides that painted selected-tab text the same colour as its background. Selected-tab counts now inherit readable foregrounds. Button colour changes are immediate so enabling/disabling cannot flash mismatched text/background during a transition.
- Validation: production frontend image built and rolled out on 5623. theme-colours-ui covers 13 routes plus modal/mobile, 53 rendered contrast checks (including hover, disabled, input values and Chinese), zero failures after corrections. Checks compare visible text with computed solid backgrounds at WCAG AA thresholds; this is not a full accessibility audit. Screenshots in .runtime/theme-review were visually inspected for buyer discovery/checkout/mobile, seller upload and founder dashboard/policies/modal. role-loading-ui also passed during this revision. Test actions use intercepted state, with no changes to production business records.
- Scope: frontend styling only; backend and business rules unchanged.

## 2026-10-29 Full dark founder theme and scoped loading
- Updated manager/founder to charcoal page, cards, inputs, tables and modal surfaces with champagne-gold text, per the latest reference. Removed ivory content surfaces; dark native form controls follow color-scheme.
- Buyer success/transaction-complete notices now use orange foreground/background/border tokens instead of shared green success tokens. Seller green remains unchanged.
- Explicit Button loading values take precedence over generic submit-operation loading: pricing disables the seller submit button without a spinner; an actual listing submission still animates it.
- Verification: production frontend build and rollout on 5623; 53 rendered contrast checks across 13 routes, modal, mobile, hover/disabled and Chinese passed. Buyer completion background and dark manager panels are asserted. Delayed-response browser test confirms pricing spinner, disabled non-spinning submit, and actual submit spinner. Screenshots of manager dashboard/modal and buyer completed order visually inspected. No backend/business changes or production mutations from tests.

## 2026-10-29 Event facts separated from request workflows
- Order event emission now records the action, the checks that actually passed on that successful branch, and before/after state snapshots. Delivery records only its in-transit prerequisite; acceptance and settlement have separate snapshots. Rejected attempts do not acquire fabricated success events. Existing trade guards are unchanged.
- Request metadata groups all new dispatch audit records and generated events by request ID. Manager event cards show facts and link to one deduplicated workflow in the request-history panel. Older records retain their text and explicitly lack per-check evidence; no backfill is inferred.
- Workflow nodes display short responsibility phrases, not static summaries as proof. Only recorded model attempts show model/endpoint/outcome. A separate model-call timer is persisted; old node timings are not relabelled as API timings. Nodes with no model call show no timing or model fields.
- Both public state and action-result serializers remove internal facts and execution details. Buyer/seller presentation remains unchanged.
- Verification: backend 64 passed including failed-transition/no-event, delivery-only prerequisites, two acceptance events sharing one request, distinct before/after snapshots and role sanitization. Browser event-evidence-ui passed for deduplication across events/audit, jump links, bilingual rendering, historical fallback, short duties, model-only metadata and buyer isolation. role-loading-ui and all 53 theme contrast checks passed. Frontend build, backend/frontend Kubernetes rollouts and 5623 health passed. Browser fixtures were intercepted and did not mutate production records or call a real model.

## 2026-10-29 — model-selected request-scoped tools

- Live LangGraph nodes now use campus-qwen JSON tool selection and LangChain StructuredTool execution; see AGENT-TOOLS.md for the bounded tool contract and commit boundary.
- No live keyword fallback. Model failures/invalid choices stop before business commit, return retryable 503, preserve current form entries, and record sanitized admin evidence.
- Pricing uses separate public-market search and estimate tools, with enforced photo-review/search prerequisites.
- Logistics/payment preparation runs existing business validation on snapshots. Transaction commit rechecks current state; no changes to fees, acceptance prerequisites or idempotency rules.
- Backend: 71 tests passed, including live-mode planner doubles, unauthorized/early tool selection, invalid delivery, failure after preparation, immutable source state, atomic settlement, and search-before-estimate.
- Frontend: 23 domain tests passed; production Vite/Docker build passed.
- Deployed browser tests: event-evidence-ui.mjs and agent-retry-ui.mjs passed. These use mocked responses for UI assertions; they do not claim real model execution.
- Real campus-qwen checks: a direct selection chose inspect_request (~1.7 s). An in-memory complete delivery preparation ran supervisor/specialist tool loops with actual model calls and left source state unchanged.
- Deployed GET /api/reports on port 5623 succeeded with seven actual campus-qwen calls (about 1.3–2.0 s each), including policy reading, AuditReportingAgent delegation, inspection and read_report. Sanitized execution evidence was found in the admin audit. No existing order was changed.
- Full kind deployment plus final backend/frontend rollouts succeeded; CloudSQL health is ok. Existing historical events remain unchanged and do not acquire fabricated model evidence.
