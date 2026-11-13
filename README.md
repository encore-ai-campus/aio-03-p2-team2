# FestaMate Backend

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

현재 프론트와 백엔드는 아직 자동 연결하지 않습니다. 이번 백엔드 MVP는 프론트가 API 계약을 확인할 수 있도록 데모 사용자와 인메모리 샘플 데이터를 제공합니다. 따라서 프로세스를 재시작하면 데이터가 초기화됩니다. Supabase Auth, PostgreSQL, 외부 API 수집, OpenAI/LangGraph 연동은 다음 단계입니다.

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

연결 확인은 `GET /health/db`에서 합니다. 응답이 `disabled`이면 `DATABASE_URL`이 없는 인메모리 데모 모드이고, `connected`이면 연결과 필수 핵심 테이블 확인까지 통과한 상태입니다. `schema_missing`이면 연결은 됐지만 DB 설계서의 필수 테이블이 아직 생성되지 않은 상태입니다.

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

인증 기능은 아직 구현하지 않습니다. 데모 사용자가 필요한 REST 요청은 다음 헤더를 사용합니다.

```http
X-Demo-User-Id: usr_demo_01
```

기본 데모 사용자는 `usr_demo_01`, `usr_demo_02`, `usr_demo_03`입니다. WebSocket은 브라우저 제약으로 다음 쿼리를 사용합니다.

```text
/api/v1/ws/groups/{groupId}/chat?demoUserId=usr_demo_01
```

이 식별자는 신원 확인이나 공개 서비스 보안 수단이 아닙니다. 실제 배포 전 Supabase Auth와 RLS로 교체해야 합니다.

### 상태 전이와 권한

- 공개 축제·모임·댓글 조회는 사용자 ID 없이 가능합니다.
- 프로필 변경, 참여 신청, 알림은 대상 데모 사용자와 헤더 ID가 일치해야 합니다.
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
│   └── store.py                     # 현재 MVP 인메모리 저장소·샘플 데이터
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

1. 프론트 API client와 `X-Demo-User-Id` 연결
2. Supabase PostgreSQL 스키마와 RLS 도입
3. 외부 축제·날씨 수집 worker 및 job 상태 조회 API 추가
4. OpenAI/LangGraph 기반 매칭·일정 제안으로 교체
5. WebSocket 브로커/Redis와 rate limit, 감사 로그, 콘텐츠 sanitizing 보강
6. Supabase Auth 도입 후 데모 헤더 제거
