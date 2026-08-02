# XiaoDun RAG service

This directory contains the independent AI Engine used by the Node application.
The repository includes a compressed PostgreSQL seed with 9,975 risk texts and
9,975 normalized pgvector embeddings. Existing Docker volumes are reused. On a
new workstation, Compose creates the volumes and PostgreSQL restores the seed
automatically on the first startup, so vectors do not need to be regenerated.

Start or recreate the service from the repository root:

```powershell
docker compose -p compose -f rag-service/compose.yml up -d --build
```

The first startup can take a little longer while PostgreSQL restores the seed
and the AI Engine downloads the embedding model. Later startups reuse both
named volumes.

Verify the restored database:

```powershell
docker exec compose-postgres-1 psql -U xiaodun -d xiaodun -c "SELECT (SELECT count(*) FROM risk_text_samples) AS texts, (SELECT count(*) FROM risk_text_embeddings WHERE is_active) AS active_vectors;"
```

Expected result: `9975` texts and `9975` active vectors.

Seed file:

- `seed/xiaodun-rag-kb-v1.sql.gz`
- SHA-256: `340D623B57DA4EDA9601D84334C062B7C130EEA6A1C243573FDDC404760C6DE2`

The seed is only imported when the PostgreSQL data directory is empty. Removing
or replacing an existing database volume is intentionally not automatic.

## 比赛队员首次启动

拉取最新代码并启动 Docker Desktop 后，在仓库根目录执行：

```powershell
docker compose -p compose -f rag-service/compose.yml up -d --build
```

第一次启动会自动创建 PostgreSQL 数据卷并恢复种子备份。恢复完成后，使用上面的
校验命令确认文本和向量数量均为 `9975`。

如果这台电脑之前已经运行过旧配置，并且校验结果为空，说明旧的空数据卷阻止了
首次恢复。确认该卷没有需要保留的个人数据后，可以只重建 RAG PostgreSQL 卷：

```powershell
docker compose -p compose -f rag-service/compose.yml down
docker volume rm compose_xiaodun_postgres_data
docker compose -p compose -f rag-service/compose.yml up -d --build
```

`docker volume rm` 会永久删除该电脑上的旧 RAG 数据库，只应在确认它为空或无需保留
时执行。它不会删除仓库中的种子备份。

Health and search endpoints remain internal to the local Node backend:

- `http://127.0.0.1:8001/internal/v1/ai/health`
- `http://127.0.0.1:8001/internal/v1/rag/search`
- `http://127.0.0.1:8001/internal/v1/rag/map-stats`
- `http://127.0.0.1:8001/internal/v1/rag/readiness`
- `http://127.0.0.1:8001/internal/v1/rag/items`

## Browser commands

- `/rag` verifies the stored text/vector counts and opens the RAG map cockpit.
- `/rag-manage` opens **RAG Manager**, where a user can add one reviewed risk
  text at a time. The Node backend forwards the item to AI Engine, which creates
  a normalized 512-dimensional document embedding and commits the text and
  vector in one PostgreSQL transaction.

RAG Manager rejects items until the user confirms that the text contains no
personal sensitive information. Duplicate normalized texts are also rejected.
