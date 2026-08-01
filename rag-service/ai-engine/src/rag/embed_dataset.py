from __future__ import annotations

import argparse
import hashlib
import os
from collections.abc import Iterable

MODEL_ID = "BAAI/bge-small-zh-v1.5"
MODEL_DIMENSION = 512


def retrieval_text(row: tuple) -> str:
    (
        _risk_text_id,
        title,
        category_name,
        normalized_text,
        risk_signals,
        key_phrases,
        _existing_hash,
    ) = row
    return " ".join(
        str(part)
        for part in (
            title,
            category_name,
            normalized_text,
            *(risk_signals or ()),
            *(key_phrases or ()),
        )
        if part
    )


def batched(rows: list, size: int) -> Iterable[list]:
    for index in range(0, len(rows), size):
        yield rows[index : index + size]


def embed_database(
    database_url: str,
    *,
    version: str,
    model_id: str = MODEL_ID,
    device: str | None = None,
    batch_size: int = 64,
) -> dict[str, int | str]:
    try:
        import psycopg
        from pgvector import Vector
        from pgvector.psycopg import register_vector
        from sentence_transformers import SentenceTransformer
    except ImportError as error:
        raise RuntimeError(
            "Install requirements.txt before generating embeddings"
        ) from error

    model = SentenceTransformer(model_id, device=device)
    dimension = model.get_embedding_dimension()
    if dimension != MODEL_DIMENSION:
        raise RuntimeError(
            f"model dimension mismatch: expected {MODEL_DIMENSION}, got {dimension}"
        )

    with psycopg.connect(database_url) as connection:
        register_vector(connection)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO embedding_models(
                    model_id, dimension, distance_metric, is_active
                ) VALUES (%s, %s, 'cosine', true)
                ON CONFLICT (model_id) DO UPDATE SET
                    dimension = EXCLUDED.dimension,
                    distance_metric = 'cosine',
                    is_active = true
                """,
                (model_id, dimension),
            )
            cursor.execute(
                """
                SELECT rt.risk_text_id, rt.risk_text_title,
                       rt.risk_category_name, rt.normalized_text,
                       rt.risk_signals, rt.key_phrases,
                       re.retrieval_text_hash
                FROM risk_text_samples rt
                LEFT JOIN risk_text_embeddings re
                  ON re.risk_text_id = rt.risk_text_id
                 AND re.model_id = %s
                 AND re.knowledge_base_version_id = %s
                WHERE rt.published_version_id = %s
                  AND rt.dataset_status IN ('processed', 'published')
                  AND rt.pii_checked
                ORDER BY rt.risk_text_id
                """,
                (model_id, version, version),
            )
            source_rows = cursor.fetchall()
        connection.commit()

        pending: list[tuple[str, str, str]] = []
        for row in source_rows:
            text = retrieval_text(row)
            text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
            if row[6] != text_hash:
                pending.append((row[0], text, text_hash))

        completed = 0
        for batch in batched(pending, batch_size):
            vectors = model.encode(
                [item[1] for item in batch],
                batch_size=batch_size,
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
            payload = [
                (
                    item[0],
                    model_id,
                    version,
                    item[1],
                    item[2],
                    Vector(vector.tolist()),
                )
                for item, vector in zip(batch, vectors, strict=True)
            ]
            with connection.cursor() as cursor:
                cursor.executemany(
                    """
                    INSERT INTO risk_text_embeddings(
                        risk_text_id, model_id, knowledge_base_version_id,
                        retrieval_text, retrieval_text_hash, embedding, is_active
                    ) VALUES (%s, %s, %s, %s, %s, %s, true)
                    ON CONFLICT (
                        risk_text_id, model_id, knowledge_base_version_id
                    ) DO UPDATE SET
                        retrieval_text = EXCLUDED.retrieval_text,
                        retrieval_text_hash = EXCLUDED.retrieval_text_hash,
                        embedding = EXCLUDED.embedding,
                        is_active = true,
                        created_at = now()
                    """,
                    payload,
                )
            connection.commit()
            completed += len(batch)
            print(f"embedded {completed}/{len(pending)}", flush=True)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT count(*)
                FROM risk_text_embeddings
                WHERE model_id = %s
                  AND knowledge_base_version_id = %s
                  AND is_active
                """,
                (model_id, version),
            )
            embedded_count = cursor.fetchone()[0]
            if embedded_count != len(source_rows):
                raise RuntimeError(
                    f"embedding count mismatch: {embedded_count}/{len(source_rows)}"
                )
            cursor.execute(
                """
                UPDATE knowledge_base_versions
                SET status = 'published', published_at = coalesce(published_at, now())
                WHERE version_id = %s
                """,
                (version,),
            )
        connection.commit()

    return {
        "model_id": model_id,
        "dimension": dimension,
        "source_count": len(source_rows),
        "generated_count": len(pending),
        "embedded_count": embedded_count,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--version", default="kb_chifraud_competition_v1")
    parser.add_argument("--model", default=MODEL_ID)
    parser.add_argument("--device", choices=("cpu", "cuda"), default=None)
    parser.add_argument("--batch-size", type=int, default=64)
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    result = embed_database(
        args.database_url,
        version=args.version,
        model_id=args.model,
        device=args.device,
        batch_size=args.batch_size,
    )
    print(result)


if __name__ == "__main__":
    main()
