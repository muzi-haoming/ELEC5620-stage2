# ELEC5620 Stage 2 · Second Space

保留当前 React MVP，接入 Python 3.12 / FastAPI / PostgreSQL / LangChain / LangGraph。

## 运行

1. Python 3.12 虚拟环境安装 `backend/requirements.txt`；`npm ci --prefix frontend`。
2. 复制 `.env.example` 为 `.env`，填写 PostgreSQL 与 campus-qwen 配置。凭据不提交。
3. 后端：`python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8001`。
4. 前端：`npm run dev --prefix frontend`，访问 **http://127.0.0.1:5622/**。

已配置的 Windows 环境可运行 `scripts/start-dev.ps1`。

## 业务

- 卖家：三方向照片、最多两张细节，单张 15 MiB，HEIC；审核、金额明细、拒绝后重提。
- 买家：最多三个匹配推荐、固定物流报价、两端物业确认、Visa/Mastercard 或 BPAY 模拟支付。
- 订单：待取货 → 配送中 → 已收货 → 买家验收并立即结算。用户侧显示交易完成，无待结算状态。
- 管理员：统计、资金、真实 Agent 审计、政策决定；用户侧时间线统一系统消息。
- SupervisionAgent 调度六个业务 Agent；需要人工判断时持久化中断，提交决定后恢复。

## 文档与部署

- [架构与节点职责](docs/ARCHITECTURE.md)
- [本机、Google Cloud SQL、Docker、kind 完整部署步骤](docs/DEPLOYMENT.md)
- API 文档：http://127.0.0.1:8001/docs
- Docker Compose：`docker compose up --build -d`（.env 配置 Cloud SQL URL）
- 本地 PostgreSQL Compose：`docker compose -f compose.yaml -f compose.local.yaml up --build -d`
- Kubernetes：`./scripts/deploy-kind.ps1 -DatabaseMode CloudSQL` 或 `Local`

## 验证

```powershell
.venv/Scripts/python.exe -m pytest backend/tests -q
npm test --prefix frontend
npm run build --prefix frontend
node frontend/tests/api-flow.mjs
```

后端测试仅使用 secondspace_test 数据库。浏览器测试会创建 E2E 家具/订单并处理样例政策，使用专用测试环境。

无真实支付、邮件或物流接口；无生产账号认证。默认 MODEL_MODE=live；fixture 仅测试使用。图片模型不可用则拒绝发布，文本解析可回退关键词并记录模式。

本机应用已接入 Google Cloud SQL；Docker/kind 仍需安装并实际验证。原 stage2/react-frontend 保留，旧浏览器数据不自动导入或覆盖。

演示入口与已知边界见 [最终交付说明](docs/FINAL-HANDOFF.md)。

照片由 ListingAgent 自动审核，无人工照片验收前置条件；所有人工参与点见 [职责核查](docs/HUMAN-INVOLVEMENT.md)。
