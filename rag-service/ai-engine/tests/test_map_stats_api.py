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


if __name__ == "__main__":
    unittest.main()
