import unittest
from pathlib import Path


AI_ENGINE = Path(__file__).resolve().parents[1]
RAG_SERVICE = AI_ENGINE.parent
SCHEMA = AI_ENGINE / "migrations" / "001_rag_schema.sql"
MODEL_SCHEMA = AI_ENGINE / "migrations" / "002_bge_small_zh_v1_5.sql"
REQUIREMENTS = AI_ENGINE / "requirements.txt"
COMPOSE = RAG_SERVICE / "compose.yml"


class RagSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = SCHEMA.read_text(encoding="utf-8").lower()
        cls.model_schema = MODEL_SCHEMA.read_text(encoding="utf-8").lower()
        cls.requirements = REQUIREMENTS.read_text(encoding="utf-8").lower()
        cls.compose = COMPOSE.read_text(encoding="utf-8").lower()

    def test_required_tables_exist(self):
        for name in (
            "knowledge_base_versions",
            "risk_text_samples",
            "embedding_models",
            "risk_text_embeddings",
            "risk_map_demo_stats",
        ):
            self.assertIn(name, self.schema)

    def test_pgvector_is_enabled_without_chroma_or_postgis(self):
        self.assertIn("create extension if not exists vector", self.schema)
        self.assertNotIn("chroma", self.schema)
        self.assertNotIn("postgis", self.schema)

    def test_runtime_only_uses_checked_publishable_text(self):
        self.assertIn("pii_checked boolean", self.schema)
        self.assertIn("'processed', 'published'", self.schema)
        self.assertIn("is_simulated boolean not null check (is_simulated)", self.schema)

    def test_selected_embedding_model_freezes_dimension_and_index(self):
        self.assertIn("baai/bge-small-zh-v1.5", self.model_schema)
        self.assertIn("vector(512)", self.model_schema)
        self.assertIn("using hnsw", self.model_schema)

    def test_cpu_container_avoids_cuda_dependencies_and_persists_model_cache(self):
        self.assertIn("download.pytorch.org/whl/cpu", self.requirements)
        self.assertIn("torch==2.13.0+cpu", self.requirements)
        self.assertIn("xiaodun_huggingface_cache", self.compose)
        self.assertIn('"127.0.0.1:8001:8001"', self.compose)


if __name__ == "__main__":
    unittest.main()
