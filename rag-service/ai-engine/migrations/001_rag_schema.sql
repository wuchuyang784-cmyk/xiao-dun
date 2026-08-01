BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_base_versions (
    version_id text PRIMARY KEY,
    status text NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
    description text NOT NULL DEFAULT '',
    sample_count integer NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE TABLE IF NOT EXISTS risk_text_samples (
    risk_text_id text PRIMARY KEY,
    risk_text_title text NOT NULL,
    risk_category_code text NOT NULL CHECK (
        risk_category_code IN (
            'fake_bank_card',
            'fake_certification',
            'fake_credentials',
            'fake_sim_card',
            'gambling',
            'new_risk_type',
            'prohibited_drugs',
            'unauthorized_cashout',
            'underground_loan',
            'whoring_prostitution'
        )
    ),
    risk_category_name text NOT NULL,
    normalized_text text NOT NULL,
    risk_signals text[] NOT NULL DEFAULT '{}',
    key_phrases text[] NOT NULL DEFAULT '{}',
    year integer CHECK (year BETWEEN 2000 AND 2100),
    source_dataset text NOT NULL DEFAULT 'ChiFraud',
    dataset_status text NOT NULL CHECK (
        dataset_status IN ('processed', 'published', 'rejected', 'withdrawn')
    ),
    pii_checked boolean NOT NULL DEFAULT false,
    published_version_id text REFERENCES knowledge_base_versions(version_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_text_normalized
    ON risk_text_samples (md5(normalized_text));
CREATE INDEX IF NOT EXISTS ix_risk_text_category
    ON risk_text_samples (risk_category_code);

CREATE TABLE IF NOT EXISTS embedding_models (
    model_id text PRIMARY KEY,
    dimension integer NOT NULL CHECK (dimension > 0),
    distance_metric text NOT NULL DEFAULT 'cosine' CHECK (distance_metric = 'cosine'),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_text_embeddings (
    risk_text_id text NOT NULL REFERENCES risk_text_samples(risk_text_id) ON DELETE CASCADE,
    model_id text NOT NULL REFERENCES embedding_models(model_id),
    knowledge_base_version_id text NOT NULL REFERENCES knowledge_base_versions(version_id),
    retrieval_text text NOT NULL,
    retrieval_text_hash text NOT NULL,
    embedding vector NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (risk_text_id, model_id, knowledge_base_version_id)
);

-- The embedding model is deployment-configurable, so the vector dimension is
-- intentionally not fixed in the base schema. Create the HNSW index in a later
-- model-specific migration after the production embedding dimension is frozen.

CREATE TABLE IF NOT EXISTS risk_map_demo_stats (
    simulation_version text NOT NULL,
    province_code char(6) NOT NULL,
    province_name text NOT NULL,
    sample_count integer NOT NULL CHECK (sample_count >= 0),
    is_simulated boolean NOT NULL CHECK (is_simulated),
    disclaimer text NOT NULL,
    PRIMARY KEY (simulation_version, province_code)
);

COMMIT;
