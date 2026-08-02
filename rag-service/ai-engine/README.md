# AI Engine

规则引擎、RAG、Prompt、私有化模型调用和风险结果融合。

## 当前 RAG MVP

- PostgreSQL 17 + pgvector 危险文本库；
- `/internal/v1/rag/search` 最小检索接口；
- 精确余弦候选召回；
- 关键话术和危险信息类别软加权；
- 数据集、知识库版本和 Embedding 模型追溯。
- 本地默认 Embedding：`BAAI/bge-small-zh-v1.5`（512 维）。

本地 Docker 启动：

```powershell
docker compose -f deploy/compose/rag.yml up --build
```

首次创建空数据卷时会执行 `migrations/001_rag_schema.sql`。正式数据由 `rag.import_dataset` 导入，地图模拟聚合与文本样本相互独立。

接口默认由 AI Engine 在本地加载 `BAAI/bge-small-zh-v1.5` 生成查询向量；如需改用独立模型服务，可将 `EMBEDDING_PROVIDER` 设置为 `external`。内部联调也可以在请求中直接传入 `query_embedding`。

生成或更新正式向量：

```powershell
python -m rag.embed_dataset `
  --database-url postgresql://xiaodun:<password>@127.0.0.1:5432/xiaodun `
  --version kb_chifraud_competition_v1 `
  --device cpu
```

团队对接先阅读 `docs/rag/RAG交付简述.md`，详细技术设计见
`docs/rag/RAG技术设计与数据库接口方案.md`。
