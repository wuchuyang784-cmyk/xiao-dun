# XiaoDun RAG service

This directory contains the independent AI Engine used by the Node application.
It deliberately reuses the existing Docker volumes so the 9,975 PostgreSQL and
pgvector records are not regenerated.

Start or recreate the service from the repository root:

```powershell
docker compose -p compose -f rag-service/compose.yml up -d --build
```

Health and search endpoints remain internal to the local Node backend:

- `http://127.0.0.1:8001/internal/v1/ai/health`
- `http://127.0.0.1:8001/internal/v1/rag/search`
