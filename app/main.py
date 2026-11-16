import logging
from contextlib import asynccontextmanager
from uuid import uuid4

import asyncpg

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.core.api import APIError, error_response
from app.core.config import get_settings
from app.core.database import Database, database_status
from app.features.alerts.router import admin_router as alerts_admin_router, router as alerts_router
from app.features.auth.router import auth_router, users_router
from app.features.chat.router import router as chat_router
from app.features.festivals.router import admin_router as festivals_admin_router, router as festivals_router
from app.features.groups.router import router as groups_router
from app.features.matching.router import router as matching_router
from app.features.schedules.router import router as schedules_router

from app.core.config import Settings
from app.core.repositories import SupabaseRepository, RepositoryError
from app.core.auth import JWTVerifier
from app.features.agents.service import AgentService
from app.features.agents.router import router as agents_router
from app.features.agents.tools import ToolFailure

logger = logging.getLogger(__name__)

_POSTGRES_ERRORS: tuple[tuple[type[Exception], int, str, str], ...] = (
    (asyncpg.InsufficientPrivilegeError, 403, "DB_PERMISSION_DENIED", "이 작업을 수행할 권한이 없습니다."),
    (asyncpg.UniqueViolationError, 409, "DB_DUPLICATE", "이미 존재하는 데이터입니다."),
    (asyncpg.ForeignKeyViolationError, 409, "DB_REFERENCE_INVALID", "연결된 데이터가 없거나 사용 중입니다."),
    (asyncpg.CheckViolationError, 400, "DB_INVALID_VALUE", "허용되지 않는 값입니다."),
    (asyncpg.NotNullViolationError, 400, "DB_INVALID_VALUE", "필수 값이 비어 있습니다."),
    (asyncpg.StringDataRightTruncationError, 400, "DB_INVALID_VALUE", "값이 너무 깁니다."),
    (asyncpg.InvalidTextRepresentationError, 400, "DB_INVALID_VALUE", "값의 형식이 올바르지 않습니다."),
)


def _postgres_error(exc: Exception) -> tuple[int, str, str]:
    for error_type, status_code, code, message in _POSTGRES_ERRORS:
        if isinstance(exc, error_type):
            return status_code, code, message
    return 500, "DB_ERROR", "데이터베이스 처리 중 오류가 발생했습니다."


def create_app(settings: Settings | None = None, *, repository=None, model=None, tools=None, agent_storage=None):
    settings = settings or get_settings()
    database = Database(settings)

    @asynccontextmanager
    async def lifespan(app):
        if not settings.database_url and settings.app_env not in {"development","local","test"}:
            raise RuntimeError("Demo mode is limited to local development")
        await database.connect()
        app.state.database = database
        app.state.repository = repository if repository is not None else SupabaseRepository(database)
        agents = None
        try:
            agents = AgentService(app.state.repository,settings,model=model,tools=tools,storage=agent_storage)
            await agents.open()
            app.state.agents = agents
            yield
        finally:
            if agents is not None:
                await agents.close()
            await database.close()

    app = FastAPI(title="FestaMate API + Agent Workflow",version="2.0.0",lifespan=lifespan)
    app.state.settings = settings
    app.state.jwt_verifier = JWTVerifier(settings)
    app.add_middleware(CORSMiddleware,allow_origins=settings.cors_origins,allow_credentials=True,allow_methods=["GET","POST","PUT","PATCH","DELETE","OPTIONS"],allow_headers=["*"])

    @app.exception_handler(RepositoryError)
    async def repository_error_handler(request,exc):
        return error_response(APIError(exc.status_code,exc.code,exc.message,exc.details),request)

    @app.exception_handler(ToolFailure)
    async def tool_error_handler(request,exc):
        return error_response(APIError(503 if exc.retryable else 422,exc.code,exc.message),request)

    @app.exception_handler(asyncpg.PostgresError)
    async def postgres_error_handler(request: Request, exc: asyncpg.PostgresError):
        # DB 제약·RLS 위반을 500 대신 의미 있는 상태 코드로 돌려준다 (SQL 원문·값은 노출하지 않음).
        status_code, code, message = _postgres_error(exc)
        details = {"constraint": exc.constraint_name} if getattr(exc, "constraint_name", None) else None
        if status_code >= 500:
            logger.error("Unhandled PostgreSQL error %s (%s)", type(exc).__name__, getattr(exc, "sqlstate", None))
        return error_response(APIError(status_code, code, message, details), request)

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok", "repositoryMode": "database" if settings.database_url else "demo"}


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


    for feature in (agents_router, auth_router, users_router, festivals_router, matching_router, groups_router, chat_router, schedules_router, alerts_router):
        app.include_router(feature, prefix=settings.api_prefix)

    app.include_router(festivals_admin_router, prefix=settings.api_prefix)
    app.include_router(alerts_admin_router, prefix=settings.api_prefix)
    return app


app = create_app()
