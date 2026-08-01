import unittest

from rag.dataset import CONTACT_MASK, prepare_records, sanitize_text


class DatasetPreparationTests(unittest.TestCase):
    def test_removes_numeric_tail_after_existing_mask(self):
        value = "主管【联系方式已脱敏】47882抢庄"
        self.assertEqual(sanitize_text(value), f"主管{CONTACT_MASK}抢庄")

    def test_masks_alphanumeric_contact_identifier(self):
        self.assertEqual(
            sanitize_text("客服薇：ny28207，欢迎加入"),
            f"{CONTACT_MASK},欢迎加入",
        )

    def test_masks_segmented_contact_number(self):
        self.assertEqual(
            sanitize_text("电话:955-4564-8460"),
            CONTACT_MASK,
        )

    def test_masks_contact_split_across_extracted_phrases(self):
        self.assertEqual(sanitize_text("广告内容【薇"), f"广告内容{CONTACT_MASK}")
        self.assertEqual(
            sanitize_text("bw11201】后续内容"),
            f"{CONTACT_MASK}后续内容",
        )

    def test_deduplicates_after_masking(self):
        rows = [
            {
                "risk_text_id": "risk_2022_000001",
                "risk_category_code": "gambling",
                "risk_category_name": "赌博/博彩",
                "normalized_text": "联系微信12345678",
                "risk_signals": [],
                "key_phrases": [],
                "year": 2022,
                "source_dataset": "ChiFraud",
            },
            {
                "risk_text_id": "risk_2022_000002",
                "risk_category_code": "gambling",
                "risk_category_name": "赌博/博彩",
                "normalized_text": "联系微信87654321",
                "risk_signals": [],
                "key_phrases": [],
                "year": 2022,
                "source_dataset": "ChiFraud",
            },
        ]
        prepared, report = prepare_records(rows)
        self.assertEqual(len(prepared), 1)
        self.assertEqual(report["removed_duplicate_count"], 1)


if __name__ == "__main__":
    unittest.main()
