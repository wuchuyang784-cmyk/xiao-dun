BEGIN;

ALTER TABLE risk_text_embeddings
    ALTER COLUMN embedding TYPE vector(512)
    USING embedding::vector(512);

INSERT INTO embedding_models(model_id, dimension, distance_metric, is_active)
VALUES ('BAAI/bge-small-zh-v1.5', 512, 'cosine', true)
ON CONFLICT (model_id) DO UPDATE SET
    dimension = EXCLUDED.dimension,
    distance_metric = EXCLUDED.distance_metric,
    is_active = true;

CREATE INDEX IF NOT EXISTS ix_risk_text_embeddings_bge_small_zh_cosine
    ON risk_text_embeddings
    USING hnsw (embedding vector_cosine_ops);

COMMIT;
