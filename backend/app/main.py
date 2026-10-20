"""Run with: python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000."""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from .database import Database
from .routes.ai import router as ai_router
from .routes.workspace import router as workspace_router
from .services.provider import AIProvider
from .services.settings import SettingsStore
from .services.validation import validation_detail

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def local_url(value: str, *, host_only: bool = False) -> bool:
    try:
        parsed = urlsplit("http://" + value if host_only else value)
        parsed.port
        return (
            parsed.scheme in ("http", "https")
            and parsed.hostname in LOCAL_HOSTS
            and not parsed.username and not parsed.password
            and not parsed.query and not parsed.fragment
            and parsed.path in ("", "/")
        )
    except ValueError:
        return False


def create_app(data_dir: str | Path | None = None) -> FastAPI:
    directory = Path(data_dir or os.environ.get("NOOKMI_DATA_DIR") or Path(__file__).resolve().parents[2] / ".local")
    app = FastAPI(title="Nookmi local API", version="0.6.1", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.database = Database(directory)
    app.state.settings = SettingsStore(directory)
    app.state.provider = AIProvider(app.state.settings)

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        origin = request.headers.get("origin")
        if (
            not local_url(request.headers.get("host", ""), host_only=True)
            or (origin is not None and not local_url(origin))
            or request.headers.get("sec-fetch-site") == "cross-site"
        ):
            return JSONResponse({"detail": "仅允许本机教学工作台访问此服务。"}, status_code=403)
        if request.method in ("POST", "PUT", "PATCH"):
            raw_length = request.headers.get("content-length", "")
            if raw_length and (not raw_length.isdigit() or int(raw_length) > 20_000_000):
                return JSONResponse({"detail": "请求数据过大，最多 20 MB。"}, status_code=413)
            body = await request.body()
            if len(body) > 20_000_000:
                return JSONResponse({"detail": "请求数据过大，最多 20 MB。"}, status_code=413)
        if request.method == "OPTIONS":
            response = Response(status_code=204)
        else:
            response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "GET, PUT, POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        # Pydantic's default detail includes rejected input, which could be an API key.
        return JSONResponse(
            {"detail": validation_detail(request.url.path, error.errors())},
            status_code=422,
        )

    app.include_router(workspace_router)
    app.include_router(ai_router)
    return app


app = create_app()
