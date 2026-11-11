# FestaMate Backend

FestaMate 팀 개발을 위한 FastAPI 초기 프로젝트입니다. 프론트엔드 레포는 `aio-03-p2-2team-Frontend`입니다.

## 기술 스택

Python 3.12 이상, FastAPI, Uvicorn, pydantic-settings, uv를 사용합니다. 의존성은 `pyproject.toml`과 `uv.lock`으로 관리합니다.

Supabase, OpenAI, LangGraph, WebSocket 구현과 관련 라이브러리는 아직 추가하지 않았습니다.

## 실행

Python 3.12와 uv를 준비한 뒤 이 레포의 루트에서 실행합니다.

```powershell
uv sync
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

기본값으로 실행할 때 `.env`는 없어도 됩니다. 설정을 변경하려면 **기존 `.env`가 없는 경우에만** 예시를 복사한 뒤 편집합니다.

```powershell
Copy-Item .env.example .env
```

macOS/Linux에서는 `cp .env.example .env`를 사용합니다. 실제 `.env`는 Git에 올리지 않습니다.

## 현재 엔드포인트

기본 주소는 `http://127.0.0.1:8000`입니다.

| 경로 | 용도 |
| --- | --- |
| `GET /health` | HTTP 200, `{"status":"ok"}` |
| `/docs` | Swagger UI |
| `/openapi.json` | OpenAPI 명세 |

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

**실제 기능용 엔드포인트는 아직 없습니다.** 기능별 APIRouter의 접두어와 태그만 등록했습니다. `/api/v1/auth`, `/api/v1/festivals` 등은 내부 경로가 비어 있어 현재 404를 반환합니다. Swagger에는 사용자 정의 기능 API로 `/health`만 표시됩니다. 프론트엔드는 아직 이 서버를 호출하지 않습니다.

## 폴더 구조

```text
app/
├── __init__.py
├── main.py                   # 앱·CORS·health·라우터 등록
├── core/
│   └── config.py             # 환경 설정
└── features/
    ├── auth/
    ├── festivals/
    ├── matching/
    ├── groups/
    ├── chat/
    ├── schedules/
    └── alerts/
.env.example
.python-version
pyproject.toml
uv.lock
```

각 기능 폴더에는 `router.py`와 라우터를 내보내는 `__init__.py`가 있습니다. 현재 필요하지 않은 service/repository 빈 파일은 만들지 않았습니다.

## 환경 설정

`app/core/config.py`에서 다음 값을 읽습니다.

| 변수 | 기본값 |
| --- | --- |
| `APP_NAME` | `FestaMate API` |
| `APP_ENV` | `development` |
| `API_PREFIX` | `/api/v1` |
| `CORS_ORIGINS` | `["http://localhost:5173","http://127.0.0.1:5173"]` |

`CORS_ORIGINS`는 JSON 배열입니다. 프론트엔드의 포트나 origin을 변경하면 허용 목록도 맞춰야 합니다. CORS는 사용자 인증을 제공하지 않습니다.

## 팀 개발과 문서 분담

향후 작업은 다음과 같습니다.

1. 기능별 요청·응답·오류·권한 API 계약 합의
2. Supabase PostgreSQL 스키마, Auth와 RLS
3. 사용자·축제·모임·댓글·일정의 실제 API와 CRUD
4. 참여 승인·정원 동시성·채팅 접근 권한의 서버 검증
5. 외부 축제·기상 데이터 연동
6. OpenAI·LangGraph와 모임장 일정 승인 흐름
7. WebSocket 채팅과 시스템 공지

라이브러리와 service/repository 계층은 실제 구현에 필요해질 때 추가합니다.

이 레포에는 **백엔드 실행법·환경 변수·API 계약·향후 DB/인증 문서**를 둡니다. API를 추가하면 FastAPI 스키마와 `/docs`를 함께 갱신합니다. 화면·프론트엔드 실행 문서는 프론트엔드 레포에, 전체 기획·역할 분담·일정은 팀 공용 문서에 둡니다.

`.venv/`, `__pycache__/`, 실제 `.env`는 Git에 포함하지 않습니다. 배포 구성은 아직 없습니다.
