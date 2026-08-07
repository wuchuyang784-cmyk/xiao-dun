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
