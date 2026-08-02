from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol

from .models import CandidateRiskText, SearchRequest


class RiskTextRepository(Protocol):
    knowledge_base_version: str
    embedding_model: str

    def search_candidates(self, request: SearchRequest) -> list[CandidateRiskText]:
        """Return vector-ranked, publishable dangerous-text candidates."""

    def list_map_stats(self) -> dict:
        """Return the explicitly simulated province aggregates for map display."""

    def get_readiness(self) -> dict:
        """Return knowledge-base row counts used by the UI activation gate."""

    def add_risk_text(self, item: dict, embedding: tuple[float, ...]) -> dict:
        """Add one publishable manual item and its normalized embedding."""


class InMemoryRiskTextRepository:
    def __init__(
        self,
        candidates: Iterable[CandidateRiskText],
        *,
        knowledge_base_version: str = "kb_test_v1",
        embedding_model: str = "embedding_test_v1",
    ) -> None:
        self._candidates = list(candidates)
        self.knowledge_base_version = knowledge_base_version
        self.embedding_model = embedding_model

    def search_candidates(self, request: SearchRequest) -> list[CandidateRiskText]:
        return sorted(
            self._candidates,
            key=lambda candidate: (-candidate.vector_score, candidate.risk_text_id),
        )[: request.candidate_k]

    def list_map_stats(self) -> dict:
        return {
            "type": "rag_map_simulation",
            "simulation_version": "test",
            "data_source": "in-memory",
            "total_samples": 0,
            "is_simulated": True,
            "disclaimer": "simulated data",
            "provinces": [],
        }

    def get_readiness(self) -> dict:
        count = len(self._candidates)
        return {
            "ready": True,
            "status": "ready",
            "knowledge_base_version": self.knowledge_base_version,
            "expected_count": count,
            "text_count": count,
            "vector_count": count,
            "embedding_model": self.embedding_model,
            "embedding_dimension": 0,
        }

    def add_risk_text(self, item: dict, embedding: tuple[float, ...]) -> dict:
        del embedding
        risk_text_id = str(item["risk_text_id"])
        self._candidates.append(CandidateRiskText(
            risk_text_id=risk_text_id,
            title=str(item["title"]),
            risk_category_code=str(item["category_code"]),
            risk_category_name=str(item["category_name"]),
            normalized_text=str(item["text"]),
            risk_signals=tuple(item.get("risk_signals") or ()),
            key_phrases=tuple(item.get("key_phrases") or ()),
            year=item.get("year"),
            source_dataset=str(item.get("source_dataset") or "manual"),
        ))
        count = len(self._candidates)
        return {"risk_text_id": risk_text_id, "text_count": count, "vector_count": count}
