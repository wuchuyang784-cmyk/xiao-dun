from __future__ import annotations

from dataclasses import dataclass, field


def _bounded(value: float) -> float:
    return max(0.0, min(1.0, value))


@dataclass(frozen=True, slots=True)
class SearchRequest:
    request_id: str
    query_text: str
    query_embedding: tuple[float, ...]
    top_k: int = 5
    candidate_k: int = 50
    risk_category_hint: str | None = None
    knowledge_base_version: str | None = None

    def __post_init__(self) -> None:
        if not self.request_id.strip():
            raise ValueError("request_id is required")
        if not self.query_text.strip():
            raise ValueError("query_text is required")
        if not self.query_embedding:
            raise ValueError("query_embedding is required")
        if not 1 <= self.top_k <= 20:
            raise ValueError("top_k must be between 1 and 20")
        if not self.top_k <= self.candidate_k <= 100:
            raise ValueError("candidate_k must be between top_k and 100")


@dataclass(frozen=True, slots=True)
class CandidateRiskText:
    risk_text_id: str
    title: str
    risk_category_code: str
    risk_category_name: str
    normalized_text: str
    risk_signals: tuple[str, ...] = ()
    key_phrases: tuple[str, ...] = ()
    year: int | None = None
    source_dataset: str = "ChiFraud"
    vector_score: float = 0.0

    def __post_init__(self) -> None:
        object.__setattr__(self, "vector_score", _bounded(self.vector_score))

    @property
    def retrieval_text(self) -> str:
        return " ".join(
            part
            for part in (
                self.title,
                self.risk_category_name,
                self.normalized_text,
                *self.risk_signals,
                *self.key_phrases,
            )
            if part
        )


@dataclass(frozen=True, slots=True)
class SimilarRiskText:
    risk_text_id: str
    title: str
    risk_category_code: str
    risk_category_name: str
    normalized_text: str
    similarity_score: float
    similarity_level: str
    similarity_reason: str
    year: int | None = None
    source_dataset: str = "ChiFraud"


@dataclass(frozen=True, slots=True)
class SearchResponse:
    request_id: str
    knowledge_base_version: str
    embedding_model: str
    reranked: bool
    items: tuple[SimilarRiskText, ...] = field(default_factory=tuple)
