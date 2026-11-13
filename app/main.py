from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.core.api import APIError, error_response
from app.core.config import get_settings
from app.core.database import Database, database_status
from app.features import alerts, auth, chat, festivals, groups, matching, schedules

settings = get_settings()
database = Database(settings)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await database.connect()
    _app.state.database = database
    yield
    await database.close()


app = FastAPI(title="FestaMate MVP API (No Auth)", version="1.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db", tags=["health"], operation_id="databaseHealth")
async def database_health():
    if database.pool is not None:
        return await database.check()
    return database_status(database)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request.state.request_id = request.headers.get("X-Request-Id", f"req_{uuid4().hex[:12]}")
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    return response


@app.exception_handler(APIError)
async def api_error_handler(request: Request, exc: APIError):
    return error_response(exc, request)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": "REQUEST_VALIDATION_ERROR",
                "message": "요청 값이 올바르지 않습니다.",
                "details": jsonable_encoder(exc.errors()),
                "requestId": getattr(request.state, "request_id", None),
            }
        },
    )


for feature in (auth, festivals, matching, groups, chat, schedules, alerts):
    app.include_router(feature.router, prefix=settings.api_prefix)

app.include_router(festivals.admin_router, prefix=settings.api_prefix)
app.include_router(alerts.admin_router, prefix=settings.api_prefix)
