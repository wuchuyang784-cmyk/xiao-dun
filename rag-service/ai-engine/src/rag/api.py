from __future__ import annotations

import os
from dataclasses import asdict
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .embedding_client import (
    EmbeddingClient,
    ModelServiceEmbeddingClient,
    SentenceTransformerEmbeddingClient,
)
from .models import SearchRequest
from .postgres_repository import PostgresRiskTextRepository
from .repository import RiskTextRepository
from .service import RagSearchService


class RagSearchPayload(BaseModel):
    request_id: str | None = None
    query_text: str = Field(min_length=1, max_length=8000)
    query_embedding: list[float] | None = None
    top_k: int = Field(default=5, ge=1, le=20)
    candidate_k: int = Field(default=50, ge=1, le=100)
    risk_category_hint: str | None = None
    knowledge_base_version: str | None = None


def _default_repository() -> PostgresRiskTextRepository:
    return PostgresRiskTextRepository(
        os.environ.get(
            "DATABASE_URL",
            "postgresql://xiaodun:xiaodun@postgres:5432/xiaodun",
        ),
        embedding_model=os.environ.get("EMBEDDING_MODEL_ID", "embedding_default"),
        knowledge_base_version=os.environ.get(
            "KNOWLEDGE_BASE_VERSION",
            "kb_draft",
        ),
    )


def _default_embedding_client() -> EmbeddingClient:
    if os.environ.get("EMBEDDING_PROVIDER", "local") == "local":
        return SentenceTransformerEmbeddingClient(
            os.environ.get(
                "LOCAL_EMBEDDING_MODEL",
                "BAAI/bge-small-zh-v1.5",
            ),
            device=os.environ.get("EMBEDDING_DEVICE", "cpu"),
        )
    base_url = os.environ.get("MODEL_SERVICE_BASE_URL", "http://model-service:8002")
    return ModelServiceEmbeddingClient(
        f"{base_url.rstrip('/')}/internal/v1/model/embeddings"
    )


def create_app(
    repository: RiskTextRepository | None = None,
    embedding_client: EmbeddingClient | None = None,
) -> FastAPI:
    app = FastAPI(title="xiao_dun AI Engine", version="0.1.0")
    risk_text_repository = repository or _default_repository()
    embedder = embedding_client or _default_embedding_client()
    service = RagSearchService(risk_text_repository)

    def error_envelope(
        request: Request,
        *,
        status_code: int,
        code: int,
        message: str,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status_code,
            content={
                "code": code,
                "message": message,
                "data": None,
                "request_id": request.headers.get("X-Request-ID", "unknown"),
            },
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(
        request: Request,
        error: HTTPException,
    ) -> JSONResponse:
        code = 50004 if error.status_code == 503 else 40001
        return error_envelope(
            request,
            status_code=error.status_code,
            code=code,
            message=str(error.detail),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request,
        error: RequestValidationError,
    ) -> JSONResponse:
        first_error = error.errors()[0] if error.errors() else {}
        message = first_error.get("msg", "invalid request")
        return error_envelope(
            request,
            status_code=400,
            code=40001,
            message=str(message),
        )

    @app.get("/internal/v1/ai/health")
    def health() -> dict:
        return {
            "code": 0,
            "message": "success",
            "data": {"status": "ok"},
            "request_id": "health",
        }

    @app.get("/internal/v1/rag/map-stats")
    def map_stats() -> dict:
        try:
            data = risk_text_repository.list_map_stats()
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        return {
            "code": 0,
            "message": "success",
            "data": data,
            "request_id": "rag-map-stats",
        }

    @app.post("/internal/v1/rag/search")
    def search(
        payload: RagSearchPayload,
        x_request_id: Annotated[str | None, Header()] = None,
    ) -> dict:
        request_id = payload.request_id or x_request_id
        if not request_id:
            raise HTTPException(status_code=400, detail="request_id is required")
        try:
            embedding = (
                tuple(payload.query_embedding)
                if payload.query_embedding
                else embedder.embed(payload.query_text, request_id)
            )
            request = SearchRequest(
                request_id=request_id,
                query_text=payload.query_text,
                query_embedding=embedding,
                top_k=payload.top_k,
                candidate_k=payload.candidate_k,
                risk_category_hint=payload.risk_category_hint,
                knowledge_base_version=payload.knowledge_base_version,
            )
            result = service.search(request)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

        return {
            "code": 0,
            "message": "success",
            "data": asdict(result),
            "request_id": request_id,
        }

    return app


app = create_app()
