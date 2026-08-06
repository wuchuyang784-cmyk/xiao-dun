from __future__ import annotations

import re
from collections.abc import Iterable

from .models import CandidateRiskText, SearchRequest, SearchResponse, SimilarRiskText
from .repository import RiskTextRepository

LATIN_OR_NUMBER = re.compile(r"[a-z0-9_]{2,}", re.IGNORECASE)
CHINESE_CHARACTER = re.compile(r"[\u4e00-\u9fff]")


def search_tokens(text: str) -> set[str]:
    normalized = text.lower()
    tokens = set(LATIN_OR_NUMBER.findall(normalized))
    chinese = CHINESE_CHARACTER.findall(normalized)
    tokens.update(chinese)
    tokens.update(
        "".join(chinese[index : index + 2])
        for index in range(max(0, len(chinese) - 1))
    )
    return {token for token in tokens if token}


def overlap_score(query_tokens: set[str], candidate_text: str) -> float:
    if not query_tokens:
        return 0.0
    candidate_tokens = search_tokens(candidate_text)
    overlap = query_tokens & candidate_tokens
    return min(1.0, len(overlap) / max(1, min(len(query_tokens), 12)))


def matched_phrases(query_text: str, phrases: Iterable[str]) -> list[str]:
    compact_query = re.sub(r"\s+", "", query_text.lower())
    return [
        phrase
        for phrase in phrases
        if len(re.sub(r"\s+", "", phrase)) >= 2
        and re.sub(r"\s+", "", phrase.lower()) in compact_query
    ][:3]


def similarity_level(score: float) -> str:
    if score >= 0.78:
        return "high"
    if score >= 0.60:
        return "medium"
    return "low"


class RagSearchService:
    def __init__(self, repository: RiskTextRepository) -> None:
        self._repository = repository

    def search(self, request: SearchRequest) -> SearchResponse:
        query_tokens = search_tokens(request.query_text)
        ranked: list[tuple[float, CandidateRiskText, float, float]] = []
        for candidate in self._repository.search_candidates(request):
            lexical = overlap_score(query_tokens, candidate.retrieval_text)
            category_bonus = float(
                bool(request.risk_category_hint)
                and request.risk_category_hint == candidate.risk_category_code
            )
            score = candidate.vector_score * 0.80 + lexical * 0.15 + category_bonus * 0.05
            ranked.append((min(1.0, score), candidate, lexical, category_bonus))

        ranked.sort(key=lambda item: (-item[0], item[1].risk_text_id))
        items = tuple(
            self._to_result(request.query_text, candidate, score, lexical, bonus)
            for score, candidate, lexical, bonus in ranked[: request.top_k]
        )
        return SearchResponse(
            request_id=request.request_id,
            knowledge_base_version=request.knowledge_base_version
            or self._repository.knowledge_base_version,
            embedding_model=self._repository.embedding_model,
            reranked=False,
            items=items,
        )

    @staticmethod
    def _to_result(
        query_text: str,
        candidate: CandidateRiskText,
        score: float,
        lexical: float,
        category_bonus: float,
    ) -> SimilarRiskText:
        matches = matched_phrases(
            query_text, (*candidate.key_phrases, *candidate.risk_signals)
        )
        reasons: list[str] = []
        if matches:
            reasons.append("共同出现：" + "、".join(matches))
        if category_bonus:
            reasons.append("风险类别一致")
        if lexical >= 0.25 and not matches:
            reasons.append("危险话术或关键词具有明显重合")
        if not reasons:
            reasons.append("整体语义与历史危险文本相似")
        return SimilarRiskText(
            risk_text_id=candidate.risk_text_id,
            title=candidate.title,
            risk_category_code=candidate.risk_category_code,
            risk_category_name=candidate.risk_category_name,
            normalized_text=candidate.normalized_text,
            similarity_score=round(score, 4),
            similarity_level=similarity_level(score),
            similarity_reason="；".join(reasons),
            year=candidate.year,
            source_dataset=candidate.source_dataset,
        )
