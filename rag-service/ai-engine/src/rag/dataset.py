from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections.abc import Iterable
from pathlib import Path
from typing import Any

CONTACT_MASK = "【联系方式已脱敏】"

_MASK_VARIANT = re.compile(
    r"[【\[\（(]{1,2}\s*联系方式已脱敏\s*[】\]\）)]{1,2}"
)
_MASK_WITH_TAIL = re.compile(
    rf"({re.escape(CONTACT_MASK)})(?:[A-Za-z]{{0,8}}\d[A-Za-z0-9_.·\- ]{{0,24}})"
)
_CONTACT_ID = re.compile(
    r"(?:客服\s*)?(?:微信|微|薇|威|V信|VX|vx|QQ|qq|抠抠|秋秋|主管|"
    r"联系(?:方式)?|添加|电(?:话)?|手機|手机)"
    r"[\s,:：;；/\\._\-【】()\[\]]*"
    r"(?:[A-Za-z]{1,10}\d{4,}|[A-Za-z]{0,4}\d{6,19})",
    re.IGNORECASE,
)
_CONTACT_SEGMENTED_NUMBER = re.compile(
    r"(?:微信|微|薇|威|V信|VX|vx|QQ|qq|抠抠|秋秋|主管|"
    r"联系(?:方式)?|添加|电(?:话)?|電話|手機|手机)"
    r"[\s,:：;；/\\._\-【】()\[\]]*"
    r"(?:\d[\s\-`·._{}（）()]{0,3}){6,19}",
    re.IGNORECASE,
)
_CONTACT_FRAGMENT_SUFFIX = re.compile(
    r"[【\[(]?(?:微信|微|薇|威|V信|VX|vx|QQ|qq|抠抠|秋秋)\s*$",
    re.IGNORECASE,
)
_CONTACT_FRAGMENT_PREFIX = re.compile(
    r"^[A-Za-z]{1,10}\d{4,}[】\])）]?",
    re.IGNORECASE,
)
_MOBILE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
_SEPARATED_LONG_DIGITS = re.compile(
    r"(?<!\d)(?:\d[\s\-`·._{}（）()]{0,3}){6,19}(?!\d)"
)
_PLAIN_LONG_DIGITS = re.compile(r"(?<!\d)\d{6,19}(?!\d)")
_DUPLICATE_MASK = re.compile(
    rf"(?:{re.escape(CONTACT_MASK)}[\s,，;；:/\\]*){{2,}}"
)
_EMPTY_WRAPPER = re.compile(
    rf"[【\[\（(]\s*{re.escape(CONTACT_MASK)}\s*[】\]\）)]"
)
_MASK_REMAINDER = re.compile(
    rf"{re.escape(CONTACT_MASK)}(?:[A-Za-z]{{0,8}}\d{{2,}})"
)


def sanitize_text(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = _MASK_VARIANT.sub(CONTACT_MASK, text)
    text = _CONTACT_FRAGMENT_SUFFIX.sub(CONTACT_MASK, text)
    text = _CONTACT_FRAGMENT_PREFIX.sub(CONTACT_MASK, text)
    text = _EMPTY_WRAPPER.sub(CONTACT_MASK, text)
    text = _MASK_WITH_TAIL.sub(r"\1", text)
    text = _CONTACT_ID.sub(CONTACT_MASK, text)
    text = _CONTACT_SEGMENTED_NUMBER.sub(CONTACT_MASK, text)
    text = _MOBILE.sub(CONTACT_MASK, text)
    text = _SEPARATED_LONG_DIGITS.sub(CONTACT_MASK, text)
    text = _PLAIN_LONG_DIGITS.sub(CONTACT_MASK, text)
    text = _MASK_WITH_TAIL.sub(r"\1", text)
    text = _DUPLICATE_MASK.sub(CONTACT_MASK, text)
    text = re.sub(rf"{re.escape(CONTACT_MASK)}[】\]]+", CONTACT_MASK, text)
    text = re.sub(rf"[【\[]+{re.escape(CONTACT_MASK)}", CONTACT_MASK, text)
    text = _MASK_WITH_TAIL.sub(r"\1", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _sanitize_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = sanitize_text(str(value))
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            result.append(cleaned)
    return result


def _build_title(category_name: str, normalized_text: str) -> str:
    compact = re.sub(r"\s+", " ", normalized_text).strip()
    return f"{category_name} - {compact[:60]}"


def prepare_records(rows: Iterable[dict[str, Any]]) -> tuple[list[dict], dict]:
    prepared: list[dict] = []
    seen_texts: set[str] = set()
    duplicate_ids: list[str] = []

    for row in rows:
        normalized_text = sanitize_text(str(row.get("normalized_text", "")))
        if not normalized_text:
            continue
        if normalized_text in seen_texts:
            duplicate_ids.append(str(row.get("risk_text_id", "")))
            continue
        seen_texts.add(normalized_text)

        category_name = str(row.get("risk_category_name", "")).strip()
        prepared.append(
            {
                "risk_text_id": str(row.get("risk_text_id", "")).strip(),
                "risk_text_title": _build_title(category_name, normalized_text),
                "risk_category_code": str(
                    row.get("risk_category_code", "")
                ).strip(),
                "risk_category_name": category_name,
                "normalized_text": normalized_text,
                "risk_signals": _sanitize_list(row.get("risk_signals")),
                "key_phrases": _sanitize_list(row.get("key_phrases")),
                "year": int(row.get("year")),
                "source_dataset": str(
                    row.get("source_dataset", "ChiFraud")
                ).strip(),
                "dataset_status": "processed",
                "pii_check": "yes",
            }
        )

    validate_records(prepared)
    return prepared, {
        "input_count": len(list(rows)) if isinstance(rows, list) else None,
        "output_count": len(prepared),
        "removed_duplicate_count": len(duplicate_ids),
        "removed_duplicate_ids": duplicate_ids,
    }


def validate_records(rows: list[dict]) -> None:
    ids: set[str] = set()
    texts: set[str] = set()
    errors: list[str] = []

    for index, row in enumerate(rows):
        risk_text_id = row.get("risk_text_id")
        normalized_text = str(row.get("normalized_text", ""))
        combined = "\n".join(
            [
                str(row.get("risk_text_title", "")),
                normalized_text,
                *row.get("risk_signals", []),
                *row.get("key_phrases", []),
            ]
        )
        if risk_text_id in ids:
            errors.append(f"duplicate risk_text_id at row {index}")
        ids.add(risk_text_id)
        if normalized_text in texts:
            errors.append(f"duplicate normalized_text at row {index}")
        texts.add(normalized_text)
        if _MASK_REMAINDER.search(combined):
            errors.append(f"masked contact has numeric tail: {risk_text_id}")
        if _CONTACT_ID.search(combined):
            errors.append(f"contact identifier remains: {risk_text_id}")
        if _MOBILE.search(combined):
            errors.append(f"mobile number remains: {risk_text_id}")
        if _PLAIN_LONG_DIGITS.search(combined):
            errors.append(f"long digit sequence remains: {risk_text_id}")
        if not isinstance(row.get("risk_signals"), list):
            errors.append(f"risk_signals is not an array: {risk_text_id}")
        if not isinstance(row.get("key_phrases"), list):
            errors.append(f"key_phrases is not an array: {risk_text_id}")

    if errors:
        raise ValueError("; ".join(errors[:20]))


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def build_delivery(
    input_path: Path,
    map_input_path: Path,
    output_dir: Path,
) -> dict:
    source_rows = _load_json(input_path)
    if not isinstance(source_rows, list):
        raise ValueError("dataset JSON must contain a top-level array")
    rows, report = prepare_records(source_rows)

    map_document = _load_json(map_input_path)
    provinces = map_document.get("provinces", [])
    if len(provinces) != 34:
        raise ValueError("risk map must contain 34 province-level regions")
    if not all(row.get("is_simulated") is True for row in provinces):
        raise ValueError("every risk map row must be marked as simulated")

    output_dir.mkdir(parents=True, exist_ok=True)
    _write_json(output_dir / "xiaodun_risk_text_dataset.json", rows)
    _write_json(output_dir / "xiaodun_risk_text_sample.json", rows[:50])
    _write_json(output_dir / "risk_map_demo.json", map_document)

    quality = {
        **report,
        "unique_id_count": len({row["risk_text_id"] for row in rows}),
        "unique_text_count": len({row["normalized_text"] for row in rows}),
        "pii_check_passed": True,
        "map_is_simulated": True,
        "map_declared_total": map_document.get("total_samples"),
    }
    _write_json(output_dir / "quality_report.json", quality)
    return quality


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--map-input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    quality = build_delivery(args.input, args.map_input, args.output_dir)
    print(json.dumps(quality, ensure_ascii=False))


if __name__ == "__main__":
    main()
