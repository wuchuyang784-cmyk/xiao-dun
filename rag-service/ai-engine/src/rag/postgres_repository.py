from __future__ import annotations

import hashlib
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

    def get_readiness(self) -> dict:
        sql = """
            SELECT kb.status,
                   kb.sample_count,
                   (SELECT COUNT(*) FROM risk_text_samples rt
                    WHERE rt.published_version_id = kb.version_id
                      AND rt.dataset_status IN ('processed', 'published')
                      AND rt.pii_checked),
                   (SELECT COUNT(*) FROM risk_text_embeddings re
                    WHERE re.knowledge_base_version_id = kb.version_id
                      AND re.model_id = %(model_id)s
                      AND re.is_active),
                   COALESCE((SELECT em.dimension FROM embedding_models em
                             WHERE em.model_id = %(model_id)s AND em.is_active), 0)
            FROM knowledge_base_versions kb
            WHERE kb.version_id = %(version)s
        """
        try:
            import psycopg
        except ImportError as error:
            raise RuntimeError("PostgreSQL dependencies are not installed") from error

        with psycopg.connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql, {
                    "version": self.knowledge_base_version,
                    "model_id": self.embedding_model,
                })
                row = cursor.fetchone()

        if not row:
            return {
                "ready": False,
                "status": "missing",
                "knowledge_base_version": self.knowledge_base_version,
                "expected_count": 0,
                "text_count": 0,
                "vector_count": 0,
                "embedding_model": self.embedding_model,
                "embedding_dimension": 0,
            }

        expected_count = int(row[1] or 0)
        text_count = int(row[2] or 0)
        vector_count = int(row[3] or 0)
        ready = row[0] == "published" and expected_count > 0 and text_count >= expected_count and vector_count >= expected_count
        return {
            "ready": ready,
            "status": "ready" if ready else "incomplete",
            "knowledge_base_version": self.knowledge_base_version,
            "expected_count": expected_count,
            "text_count": text_count,
            "vector_count": vector_count,
            "embedding_model": self.embedding_model,
            "embedding_dimension": int(row[4] or 0),
        }

    def add_risk_text(self, item: dict, embedding: tuple[float, ...]) -> dict:
        try:
            import psycopg
            from pgvector import Vector
            from pgvector.psycopg import register_vector
        except ImportError as error:
            raise RuntimeError("PostgreSQL dependencies are not installed") from error

        retrieval_text = " ".join(
            str(part) for part in (
                item["title"],
                item["category_name"],
                item["text"],
                *(item.get("risk_signals") or ()),
                *(item.get("key_phrases") or ()),
            ) if part
        )
        retrieval_hash = hashlib.sha256(retrieval_text.encode("utf-8")).hexdigest()

        with psycopg.connect(self._database_url) as connection:
            register_vector(connection)
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT dimension FROM embedding_models WHERE model_id = %s AND is_active",
                    (self.embedding_model,),
                )
                model_row = cursor.fetchone()
                if not model_row:
                    raise RuntimeError("configured embedding model is not registered")
                if len(embedding) != int(model_row[0]):
                    raise ValueError(
                        f"embedding dimension mismatch: {len(embedding)}/{int(model_row[0])}"
                    )

                cursor.execute(
                    "SELECT risk_text_id FROM risk_text_samples WHERE md5(normalized_text) = md5(%s)",
                    (item["text"],),
                )
                duplicate = cursor.fetchone()
                if duplicate:
                    raise ValueError(f"duplicate risk text: {duplicate[0]}")

                cursor.execute(
                    """
                    INSERT INTO risk_text_samples(
                        risk_text_id, risk_text_title, risk_category_code,
                        risk_category_name, normalized_text, risk_signals,
                        key_phrases, year, source_dataset, dataset_status,
                        pii_checked, published_version_id
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'published', true, %s)
                    """,
                    (
                        item["risk_text_id"], item["title"], item["category_code"],
                        item["category_name"], item["text"], item.get("risk_signals") or [],
                        item.get("key_phrases") or [], item.get("year"),
                        item.get("source_dataset") or "manual_ui", self.knowledge_base_version,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO risk_text_embeddings(
                        risk_text_id, model_id, knowledge_base_version_id,
                        retrieval_text, retrieval_text_hash, embedding, is_active
                    ) VALUES (%s, %s, %s, %s, %s, %s, true)
                    """,
                    (
                        item["risk_text_id"], self.embedding_model,
                        self.knowledge_base_version, retrieval_text,
                        retrieval_hash, Vector(list(embedding)),
                    ),
                )
                cursor.execute(
                    """
                    UPDATE knowledge_base_versions kb
                    SET sample_count = (
                        SELECT COUNT(*) FROM risk_text_samples rt
                        WHERE rt.published_version_id = kb.version_id
                          AND rt.dataset_status IN ('processed', 'published')
                          AND rt.pii_checked
                    )
                    WHERE kb.version_id = %s
                    RETURNING sample_count
                    """,
                    (self.knowledge_base_version,),
                )
                count_row = cursor.fetchone()
                if not count_row:
                    raise RuntimeError("knowledge base version does not exist")
                text_count = int(count_row[0])
            connection.commit()

        return {
            "risk_text_id": item["risk_text_id"],
            "knowledge_base_version": self.knowledge_base_version,
            "embedding_model": self.embedding_model,
            "embedding_dimension": len(embedding),
            "text_count": text_count,
            "vector_count": text_count,
        }
