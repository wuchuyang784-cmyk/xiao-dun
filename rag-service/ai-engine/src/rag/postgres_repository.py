from __future__ import annotations

from typing import Any

from .models import CandidateRiskText, SearchRequest


class PostgresRiskTextRepository:
    def __init__(
        self,
        database_url: str,
        *,
        embedding_model: str,
        knowledge_base_version: str,
    ) -> None:
        self._database_url = database_url
        self.embedding_model = embedding_model
        self.knowledge_base_version = knowledge_base_version

    def search_candidates(self, request: SearchRequest) -> list[CandidateRiskText]:
        try:
            import psycopg
            from pgvector import Vector
            from pgvector.psycopg import register_vector
        except ImportError as error:
            raise RuntimeError("PostgreSQL dependencies are not installed") from error

        version = request.knowledge_base_version or self.knowledge_base_version
        sql = """
            WITH eligible AS MATERIALIZED (
                SELECT rt.risk_text_id, rt.risk_text_title,
                       rt.risk_category_code, rt.risk_category_name,
                       rt.normalized_text, rt.risk_signals, rt.key_phrases,
                       rt.year, rt.source_dataset,
                       1 - (re.embedding <=> %(embedding)s) AS vector_score,
                       re.embedding <=> %(embedding)s AS vector_distance
                FROM risk_text_embeddings re
                JOIN risk_text_samples rt
                  ON rt.risk_text_id = re.risk_text_id
                JOIN embedding_models em ON em.model_id = re.model_id
                WHERE rt.dataset_status IN ('processed', 'published')
                  AND rt.pii_checked
                  AND rt.published_version_id = %(version)s
                  AND re.knowledge_base_version_id = %(version)s
                  AND re.is_active AND em.is_active
                  AND em.model_id = %(model_id)s
            ),
            vector_candidates AS (
                SELECT *
                FROM eligible
                ORDER BY vector_distance, risk_text_id
                LIMIT %(candidate_k)s
            ),
            category_candidates AS (
                SELECT *
                FROM eligible
                WHERE %(risk_category_hint)s::text IS NOT NULL
                  AND risk_category_code = %(risk_category_hint)s::text
                ORDER BY vector_distance, risk_text_id
                LIMIT %(category_candidate_k)s
            )
            SELECT risk_text_id, risk_text_title,
                   risk_category_code, risk_category_name,
                   normalized_text, risk_signals, key_phrases,
                   year, source_dataset, vector_score
            FROM (
                SELECT * FROM vector_candidates
                UNION
                SELECT * FROM category_candidates
            ) candidates
            ORDER BY vector_distance, risk_text_id
        """
        parameters: dict[str, Any] = {
            "embedding": Vector(list(request.query_embedding)),
            "version": version,
            "model_id": self.embedding_model,
            "candidate_k": request.candidate_k,
            "category_candidate_k": max(request.top_k * 4, request.candidate_k // 2),
            "risk_category_hint": request.risk_category_hint,
        }
        with psycopg.connect(self._database_url) as connection:
            register_vector(connection)
            with connection.cursor() as cursor:
                cursor.execute(sql, parameters)
                rows = cursor.fetchall()
        return [
            CandidateRiskText(
                risk_text_id=row[0],
                title=row[1],
                risk_category_code=row[2],
                risk_category_name=row[3],
                normalized_text=row[4],
                risk_signals=tuple(row[5] or ()),
                key_phrases=tuple(row[6] or ()),
                year=row[7],
                source_dataset=row[8],
                vector_score=float(row[9]),
            )
            for row in rows
        ]

    def list_map_stats(self) -> dict:
        sql = """
            SELECT simulation_version, province_code, province_name,
                   sample_count, is_simulated, disclaimer
            FROM risk_map_demo_stats
            ORDER BY province_code
        """
        try:
            import psycopg
        except ImportError as error:
            raise RuntimeError("PostgreSQL dependencies are not installed") from error

        with psycopg.connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql)
                rows = cursor.fetchall()

        provinces = [
            {
                "province_code": row[1],
                "province_name": row[2],
                "sample_count": int(row[3]),
                "is_simulated": bool(row[4]),
            }
            for row in rows
        ]
        return {
            "type": "rag_map_simulation",
            "simulation_version": rows[0][0] if rows else "competition_demo_v1",
            "data_source": "ChiFraud (COLING 2025)",
            "total_samples": sum(item["sample_count"] for item in provinces),
            "is_simulated": True,
            "disclaimer": rows[0][5] if rows else "simulated data, does not represent real regional risk",
            "provinces": provinces,
        }
