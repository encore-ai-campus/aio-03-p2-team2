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
