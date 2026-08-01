from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def import_dataset(database_url: str, dataset_path: Path, map_path: Path, version: str) -> None:
    try:
        import psycopg
    except ImportError as error:
        raise RuntimeError("Install requirements.txt before importing data") from error

    rows = json.loads(dataset_path.read_text(encoding="utf-8"))
    map_data = json.loads(map_path.read_text(encoding="utf-8"))
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO knowledge_base_versions(version_id, status, description, sample_count)
                VALUES (%s, 'draft', %s, %s)
                ON CONFLICT (version_id) DO UPDATE SET sample_count = EXCLUDED.sample_count
                """,
                (version, "ChiFraud-derived competition dangerous-text dataset", len(rows)),
            )
            cursor.executemany(
                """
                INSERT INTO risk_text_samples(
                    risk_text_id, risk_text_title, risk_category_code,
                    risk_category_name, normalized_text, risk_signals,
                    key_phrases, year, source_dataset, dataset_status,
                    pii_checked, published_version_id
                ) VALUES (
                    %(risk_text_id)s, %(risk_text_title)s, %(risk_category_code)s,
                    %(risk_category_name)s, %(normalized_text)s, %(risk_signals)s,
                    %(key_phrases)s, %(year)s, %(source_dataset)s, %(dataset_status)s,
                    true, %(version)s
                )
                ON CONFLICT (risk_text_id) DO UPDATE SET
                    risk_text_title = EXCLUDED.risk_text_title,
                    normalized_text = EXCLUDED.normalized_text,
                    risk_signals = EXCLUDED.risk_signals,
                    key_phrases = EXCLUDED.key_phrases,
                    pii_checked = true,
                    published_version_id = EXCLUDED.published_version_id,
                    updated_at = now()
                """,
                [{**row, "version": version} for row in rows],
            )
            cursor.execute(
                "DELETE FROM risk_map_demo_stats WHERE simulation_version = %s",
                (map_data["simulation_version"],),
            )
            cursor.executemany(
                """
                INSERT INTO risk_map_demo_stats(
                    simulation_version, province_code, province_name,
                    sample_count, is_simulated, disclaimer
                ) VALUES (%s, %s, %s, %s, true, %s)
                """,
                [
                    (
                        map_data["simulation_version"],
                        row["province_code"],
                        row["province_name"],
                        row["sample_count"],
                        map_data["disclaimer"],
                    )
                    for row in map_data["provinces"]
                ],
            )
        connection.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--map", dest="map_path", type=Path, required=True)
    parser.add_argument("--version", default="kb_chifraud_competition_v1")
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    import_dataset(args.database_url, args.dataset, args.map_path, args.version)


if __name__ == "__main__":
    main()
