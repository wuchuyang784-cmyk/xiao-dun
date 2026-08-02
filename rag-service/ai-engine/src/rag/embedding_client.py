from __future__ import annotations

import json
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class EmbeddingClient(Protocol):
    def embed(self, text: str, request_id: str) -> tuple[float, ...]:
        """Return one embedding for the supplied text."""

    def embed_document(self, text: str, request_id: str) -> tuple[float, ...]:
        """Return one document embedding compatible with the seeded corpus."""


class ModelServiceEmbeddingClient:
    def __init__(self, endpoint: str, timeout_seconds: float = 15.0) -> None:
        self._endpoint = endpoint
        self._timeout_seconds = timeout_seconds

    def embed(self, text: str, request_id: str) -> tuple[float, ...]:
        body = json.dumps(
            {"request_id": request_id, "input": [text]},
            ensure_ascii=False,
        ).encode("utf-8")
        request = Request(
            self._endpoint,
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Request-ID": request_id,
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError) as error:
            raise RuntimeError(f"embedding service unavailable: {error}") from error

        try:
            vector = payload["data"]["embeddings"][0]["embedding"]
        except (KeyError, IndexError, TypeError) as error:
            raise RuntimeError("embedding service returned an invalid response") from error
        if not isinstance(vector, list) or not vector:
            raise RuntimeError("embedding service returned an empty vector")
        return tuple(float(value) for value in vector)

    def embed_document(self, text: str, request_id: str) -> tuple[float, ...]:
        return self.embed(text, request_id)


class SentenceTransformerEmbeddingClient:
    QUERY_INSTRUCTION = "为这个句子生成表示以用于检索相关文章："

    def __init__(
        self,
        model_id: str = "BAAI/bge-small-zh-v1.5",
        *,
        device: str | None = None,
    ) -> None:
        self._model_id = model_id
        self._device = device
        self._model = None

    def _load_model(self):
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as error:
                raise RuntimeError(
                    "sentence-transformers is not installed"
                ) from error
            self._model = SentenceTransformer(
                self._model_id,
                device=self._device,
            )
        return self._model

    def embed(self, text: str, request_id: str) -> tuple[float, ...]:
        del request_id
        vector = self._load_model().encode(
            self.QUERY_INSTRUCTION + text,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return tuple(float(value) for value in vector)

    def embed_document(self, text: str, request_id: str) -> tuple[float, ...]:
        del request_id
        vector = self._load_model().encode(
            text,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return tuple(float(value) for value in vector)
