# RAG database seed

`xiaodun-rag-kb-v1.sql.gz` is a PostgreSQL 17 logical backup containing the
published `kb_chifraud_competition_v1` knowledge base:

- 9,975 normalized risk-text records
- 9,975 active 512-dimensional `BAAI/bge-small-zh-v1.5` embeddings
- the pgvector HNSW cosine index
- 34 province-level competition simulation rows totaling 10,000 samples

PostgreSQL restores this file automatically only when the named data volume is
created for the first time.

SHA-256:

```text
340D623B57DA4EDA9601D84334C062B7C130EEA6A1C243573FDDC404760C6DE2
```
