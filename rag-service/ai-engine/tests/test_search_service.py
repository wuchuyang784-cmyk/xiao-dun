import unittest

from rag.models import CandidateRiskText, SearchRequest
from rag.repository import InMemoryRiskTextRepository
from rag.service import RagSearchService, search_tokens


class RagSearchServiceTest(unittest.TestCase):
    def setUp(self):
        self.repository = InMemoryRiskTextRepository(
            [
                CandidateRiskText(
                    risk_text_id="risk_fraud",
                    title="退款客服话术",
                    risk_category_code="fraud",
                    risk_category_name="诈骗",
                    normalized_text="订单异常，请开启屏幕共享办理退款。",
                    risk_signals=("退款理赔", "屏幕共享"),
                    key_phrases=("开启屏幕共享",),
                    vector_score=0.82,
                ),
                CandidateRiskText(
                    risk_text_id="risk_gambling",
                    title="博彩推广话术",
                    risk_category_code="gambling",
                    risk_category_name="赌博/博彩",
                    normalized_text="高额收益，立即参与。",
                    vector_score=0.86,
                ),
            ]
        )
        self.service = RagSearchService(self.repository)

    def test_keyword_and_category_signals_rerank_candidates(self):
        result = self.service.search(
            SearchRequest(
                request_id="req_1",
                query_text="客服说订单异常，让我开启屏幕共享办理退款",
                query_embedding=(0.1, 0.2, 0.3),
                risk_category_hint="fraud",
                top_k=2,
                candidate_k=2,
            )
        )
        self.assertEqual(result.items[0].risk_text_id, "risk_fraud")
        self.assertIn("风险类别一致", result.items[0].similarity_reason)

    def test_top_k_limits_results(self):
        result = self.service.search(
            SearchRequest(
                request_id="req_2",
                query_text="危险信息",
                query_embedding=(0.1, 0.2),
                top_k=1,
                candidate_k=2,
            )
        )
        self.assertEqual(len(result.items), 1)

    def test_chinese_bigrams_are_generated(self):
        tokens = search_tokens("屏幕共享")
        self.assertIn("屏幕", tokens)
        self.assertIn("共享", tokens)


if __name__ == "__main__":
    unittest.main()
