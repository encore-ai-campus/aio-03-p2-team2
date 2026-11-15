# FestaMate Backend

## 현재 인증 방식

보호된 REST API는 Supabase Auth access token을 요구합니다.

```http
Authorization: Bearer <supabase-access-token>
```

백엔드는 JWT의 `sub`를 `public.users.auth_user_id`와 연결해 애플리케이션 사용자를 결정합니다. `X-Demo-User-Id`와 WebSocket의 `demoUserId`는 더 이상 인증 수단으로 사용하지 않습니다. WebSocket은 `Authorization: Bearer ...` 헤더 또는 브라우저 환경을 위한 단기 `access_token` 쿼리 토큰을 사용합니다.

DB에는 [`db/supabase_auth_rls.sql`](db/supabase_auth_rls.sql)을 base schema 이후 실행해야 합니다. 이 마이그레이션은 Auth 사용자 매핑, 신규 사용자 생성 트리거, RLS 정책을 추가합니다. 백엔드의 asyncpg 연결은 요청 JWT를 `request.jwt.claims`에 전달하고 `authenticated`/`anon` 역할로 전환한 뒤, 연결 반환 전에 역할을 복원합니다.

필수 환경변수는 `SUPABASE_URL`, `SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWT_ISSUER`입니다. 비대칭 Supabase signing key를 사용할 때는 JWKS를 사용하므로 `SUPABASE_JWT_SECRET`은 비워 둡니다. 기존 HS256 프로젝트에서만 JWT secret을 별도로 설정합니다.

FestaMate 팀 개발용 FastAPI 백엔드입니다. React 프론트엔드(`aio-03-p2-2team-Frontend`)와 별도 레포로 관리하며, 프론트의 `DemoProvider → demoModel → localStorage` 목업 흐름을 향후 REST/WebSocket API로 교체할 수 있도록 API 계약을 구현합니다.

## 아키텍처 검토

현재 구조는 프론트와 백엔드를 기능별로 나눈 방향이 적절합니다.

```text
Frontend                                  Backend
React Router / DemoProvider               FastAPI /api/v1
  ├─ features/*                             ├─ features/auth
  ├─ shared/components                       ├─ features/festivals
  ├─ shared/data                             ├─ features/matching
  └─ shared/lib/demoModel                    ├─ features/groups
       ↕ localStorage                        ├─ features/chat
                                             ├─ features/schedules
                                             └─ features/alerts
```

향후 연결 구조는 다음 순서로 확장합니다.

```text
React
  ├─ Supabase Auth
  └─ FastAPI
       ├─ Supabase PostgreSQL / RLS
       ├─ 공식 축제·날씨 외부 API
       ├─ LangGraph + OpenAI
       └─ WebSocket 채팅
```

기능 API는 `get_repository()`를 통해 도메인별 Repository를 사용하며, `DATABASE_URL`이 설정되면 Supabase PostgreSQL의 실제 CRUD 쿼리를 실행합니다. `app/core/store.py`의 인메모리 데이터는 이전 데모 구현을 위한 레거시 샘플이며 현재 라우터에서는 호출하지 않습니다. 보호 API는 Supabase Auth JWT와 RLS를 사용합니다.

## 기술 스택

- Python 3.12+
- FastAPI, Uvicorn, WebSockets
- pydantic-settings
- uv (`pyproject.toml`, `uv.lock`)
- asyncpg (Supabase PostgreSQL 연결)

## 실행

```powershell
uv sync
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

기본 설정에서는 `.env`가 없어도 실행됩니다. 설정을 바꿀 때만, 기존 `.env`를 덮어쓰지 않도록 파일이 없는 경우에 복사합니다.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

macOS/Linux:

```bash
test -f .env || cp .env.example .env
```

실제 `.env`, `.venv/`, `__pycache__/`는 Git에 포함하지 않습니다.

## PostgreSQL 연결

`.env`에 Supabase PostgreSQL 연결 문자열을 설정하면 FastAPI startup 때 asyncpg pool을 엽니다.

```dotenv
# Local persistent FastAPI backend: use Direct or Session pooler (port 5432).
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<pooler-host>:5432/postgres
DATABASE_REQUIRED=true
DATABASE_POOL_MIN_SIZE=1
DATABASE_POOL_MAX_SIZE=5
```

연결 확인은 `GET /health/db`에서 합니다. `connected`이면 연결과 필수 테이블 확인까지 통과한 상태이며, `schema_missing`이면 연결은 됐지만 DB 설계서의 필수 테이블이 아직 생성되지 않은 상태입니다. `DATABASE_URL`이 없으면 기능 API는 자동으로 인메모리로 전환되지 않고 `503 DATABASE_UNAVAILABLE`을 반환합니다. 로컬에서도 실제 CRUD를 검증하려면 Supabase/PostgreSQL 연결을 설정해야 합니다.

Supabase SQL Editor에는 제공된 `festamate_schema_v4.3.txt`를 먼저 실행해야 합니다. 이 SQL은 `auth.users`, RLS, 승인 트랜잭션 함수를 포함하므로 운영 환경에서는 service-role 키와 RLS 정책을 함께 관리해야 합니다. API·DB 상세 불일치 검토는 [`docs/api-db-review.md`](docs/api-db-review.md)에 기록했습니다.

## 기본 엔드포인트

| 경로 | 설명 |
| --- | --- |
| `GET /health` | `{"status":"ok"}` |
| `/docs` | Swagger UI |
| `/openapi.json` | OpenAPI 3.1 명세 |

API 기능 경로의 기본 접두어는 `/api/v1`입니다. 성공 응답은 `{ "data": ..., "meta": { "requestId": ... } }` 형식이며, 목록은 `items`, `page`, `pageSize`, `total`을 사용합니다. 오류는 `{ "error": { "code", "message", "details", "requestId" } }` 형식입니다.

## 구현된 MVP API

- 사용자: `/users/{userId}`, 프로필·알림 동의 PATCH
- 축제: 목록/검색, 캘린더, 상세, 대체 축제, 개발용 sync/import
- 매칭: 자연어 슬롯 추출, 후보 점수, 매칭 실행 조회, 필요 시 모임 생성
- 모임: 생성·조회·수정, 공개 댓글, 참여 신청/즉시 참여, 승인·거절, 탈퇴
- 채팅: 참여자 전용 메시지 조회·등록, 이벤트 폴백, WebSocket
- 일정: 참여 가능 시간 검증, 일정 제안 생성·승인·거절
- 알림: 목록, 읽음, 의사 응답, 대체 축제, 개발용 날씨/공지 sync

### 개발용 사용자 식별

보호 API는 Supabase Auth access token이 필요합니다. REST 요청은 다음 헤더를 사용합니다.

```http
Authorization: Bearer <supabase-access-token>
```

WebSocket은 `Authorization` 헤더를 우선 사용하고, 브라우저 native WebSocket에서 헤더를 설정할 수 없는 경우에만 `access_token` 쿼리를 사용합니다.

```text
/api/v1/ws/groups/{groupId}/chat?access_token=<supabase-access-token>
```

JWT 서명과 RLS가 신원 및 데이터 접근 범위를 검증합니다. `X-Demo-User-Id`와 `demoUserId`는 지원하지 않습니다.

### 상태 전이와 권한

- 공개 축제·모임·댓글 조회는 사용자 ID 없이 가능합니다.
- 프로필 변경, 참여 신청, 알림은 JWT로 확인된 현재 사용자만 수행할 수 있습니다.
- 채팅·일정 조회는 모임 멤버만 가능합니다.
- 참여 신청 승인·거절과 일정 제안·확정은 모임장만 가능합니다.
- 정원이 차면 모임 상태가 `full`이 되며, 멤버 추가는 원자적 저장소 구역에서 정원을 다시 확인합니다.
- 모임·일정 변경은 `version` 또는 `If-Match`를 검사하여 `409 RESOURCE_VERSION_CONFLICT`를 반환합니다.
- `/admin/*`는 `development`, `local`, `test` 환경에서만 활성화됩니다.

## 폴더 구조

```text
app/
├── main.py                         # 앱, CORS, 오류 형식, 라우터 등록
├── core/
│   ├── api.py                       # 표준 응답·오류
│   ├── config.py                    # 환경 설정
│   ├── schemas.py                   # 공통 요청 모델
│   ├── database.py                   # Supabase PostgreSQL pool 및 스키마 health check
│   ├── repository.py                 # 공통 DB 오류·타입 변환
│   ├── repositories.py               # 도메인 Repository facade
│   └── store.py                      # 레거시 데모 샘플(기능 API에서 미사용)
└── features/
    ├── auth/                        # 현재 /users 계약, 인증은 별도 과제
    ├── festivals/
    ├── matching/
    ├── groups/
    ├── chat/
    ├── schedules/
    └── alerts/
```

## 다음 작업

1. 프론트 API client에 Supabase Auth access token 연결
2. Supabase PostgreSQL 스키마와 RLS 도입
3. 외부 축제·날씨 수집 worker 및 job 상태 조회 API 추가
4. OpenAI/LangGraph 기반 매칭·일정 제안으로 교체
5. WebSocket 브로커/Redis와 rate limit, 감사 로그, 콘텐츠 sanitizing 보강
6. Supabase Auth/RLS 운영 키와 정책 검증, 사용자 매핑 데이터 backfill
