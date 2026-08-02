import unittest

from rag.embedding_client import SentenceTransformerEmbeddingClient


class FakeModel:
    def __init__(self):
        self.last_text = None

    def encode(self, text, **kwargs):
        self.last_text = text
        self.kwargs = kwargs
        return [0.6, 0.8]


class SentenceTransformerEmbeddingClientTest(unittest.TestCase):
    def test_adds_query_instruction_and_normalizes(self):
        client = SentenceTransformerEmbeddingClient()
        fake = FakeModel()
        client._model = fake

        vector = client.embed("退款客服要求转账", "req_1")

        self.assertTrue(
            fake.last_text.startswith(
                SentenceTransformerEmbeddingClient.QUERY_INSTRUCTION
            )
        )
        self.assertEqual(vector, (0.6, 0.8))
        self.assertTrue(fake.kwargs["normalize_embeddings"])

    def test_document_embedding_matches_seed_corpus_without_query_instruction(self):
        client = SentenceTransformerEmbeddingClient()
        fake = FakeModel()
        client._model = fake

        vector = client.embed_document("标题 分类 危险文本", "req_2")

        self.assertEqual(fake.last_text, "标题 分类 危险文本")
        self.assertEqual(vector, (0.6, 0.8))
        self.assertTrue(fake.kwargs["normalize_embeddings"])


if __name__ == "__main__":
    unittest.main()
