import unittest

from fastapi.testclient import TestClient

from rag.api import create_app


class FakeRepository:
    knowledge_base_version = "kb_test_v1"
    embedding_model = "embedding_test_v1"

    def list_map_stats(self):
        return {
            "type": "rag_map_simulation",
            "simulation_version": "competition_demo_v1",
            "data_source": "ChiFraud (COLING 2025)",
            "total_samples": 10_000,
            "is_simulated": True,
            "disclaimer": "simulated data, does not represent real regional risk",
            "provinces": [
                {
                    "province_code": "110000",
                    "province_name": "Beijing",
                    "sample_count": 332,
                    "is_simulated": True,
                }
            ],
        }

    def get_readiness(self):
        return {
            "ready": True,
            "status": "ready",
            "knowledge_base_version": self.knowledge_base_version,
            "expected_count": 9_975,
            "text_count": 9_975,
            "vector_count": 9_975,
            "embedding_model": self.embedding_model,
            "embedding_dimension": 512,
        }

    def add_risk_text(self, item, embedding):
        self.added_item = item
        self.added_embedding = embedding
        return {
            "risk_text_id": item["risk_text_id"],
            "text_count": 9_976,
            "vector_count": 9_976,
            "embedding_dimension": len(embedding),
        }


class FakeEmbeddingClient:
    def embed_document(self, text, request_id):
        self.document_text = text
        self.request_id = request_id
        return (0.6, 0.8)


class RagMapStatsApiTest(unittest.TestCase):
    def test_returns_map_simulation_envelope(self):
        client = TestClient(create_app(repository=FakeRepository()))

        response = client.get("/internal/v1/rag/map-stats")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["code"], 0)
        self.assertEqual(body["data"]["total_samples"], 10_000)
        self.assertTrue(body["data"]["is_simulated"])
        self.assertEqual(body["data"]["provinces"][0]["sample_count"], 332)

    def test_returns_rag_readiness_counts(self):
        client = TestClient(create_app(repository=FakeRepository()))

        response = client.get("/internal/v1/rag/readiness")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["data"]["ready"])
        self.assertEqual(body["data"]["text_count"], 9_975)
        self.assertEqual(body["data"]["vector_count"], 9_975)
        self.assertEqual(body["data"]["embedding_dimension"], 512)

    def test_adds_one_manual_rag_item_and_embedding(self):
        repository = FakeRepository()
        embedder = FakeEmbeddingClient()
        client = TestClient(create_app(repository=repository, embedding_client=embedder))

        response = client.post("/internal/v1/rag/items", json={
            "request_id": "add-1",
            "title": "冒充客服退款",
            "text": "对方要求开启屏幕共享并转账到所谓安全账户。",
            "category_code": "new_risk_type",
            "risk_signals": ["屏幕共享", "安全账户"],
            "key_phrases": ["退款理赔"],
            "pii_confirmed": True,
        })

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["data"]["text_count"], 9_976)
        self.assertEqual(body["data"]["vector_count"], 9_976)
        self.assertEqual(repository.added_embedding, (0.6, 0.8))
        self.assertIn("冒充客服退款", embedder.document_text)
        self.assertEqual(embedder.request_id, "add-1")

    def test_rejects_manual_item_without_pii_confirmation(self):
        client = TestClient(create_app(
            repository=FakeRepository(), embedding_client=FakeEmbeddingClient()
        ))

        response = client.post("/internal/v1/rag/items", json={
            "title": "风险文本",
            "text": "这是一条用于测试的危险话术文本。",
            "category_code": "new_risk_type",
            "pii_confirmed": False,
        })

        self.assertEqual(response.status_code, 400)
        self.assertIn("pii_confirmed", response.json()["message"])


if __name__ == "__main__":
    unittest.main()
