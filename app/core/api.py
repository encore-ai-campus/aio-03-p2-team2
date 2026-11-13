from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse


def request_id(request: Request) -> str:
    return getattr(request.state, "request_id", f"req_{uuid4().hex[:12]}")


def success(data: Any, request: Request, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"data": jsonable_encoder(data), "meta": {"requestId": request_id(request)}},
    )


class APIError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        super().__init__(message)


def error_response(error: APIError, request: Request) -> JSONResponse:
    body: dict[str, Any] = {
        "code": error.code,
        "message": error.message,
        "requestId": request_id(request),
    }
    if error.details is not None:
        body["details"] = error.details
    return JSONResponse(status_code=error.status_code, content={"error": body})
