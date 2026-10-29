## Change

Replace browser-only persistence with the Python/PostgreSQL API while preserving the current React MVP flow. Six specialist LangGraph nodes are coordinated by SupervisionAgent; human policy decisions persist through PostgresSaver checkpoints.

## Validation

- [ ] Backend tests against isolated PostgreSQL
- [ ] Frontend domain tests and build
- [ ] Seller → buyer → property → delivery → immediate settlement browser flow
- [ ] Administrator reports, policies and agent names
- [ ] No credentials, runtime data or payment form values in commits

## External verification

- Google Cloud SQL database connection: state actual result
- campus-qwen text and vision: state actual result separately
- Docker/kind rollout: state actual result
- Independent reviewer: assign another group member before merge
