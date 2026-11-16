# FestaMate Backend

React 프론트와 별도 레포로 관리하는 FastAPI 백엔드입니다. 기능별 API와 LangGraph 에이전트를 함께 제공합니다.

## 기술 스택

Python 3.12+, FastAPI, uv, Supabase PostgreSQL/Auth, LangGraph를 사용합니다. OpenAI·Open-Meteo·TourAPI는 설정에 따라 사용합니다.

## 실행

기존 `.env`가 없을 때만 `.env.example`을 복사하고 설정을 입력합니다.

```powershell
uv sync
uv run python -m app --reload --host 127.0.0.1 --port 8000
```

- 상태: http://127.0.0.1:8000/health
- DB 상태: http://127.0.0.1:8000/health/db
- Swagger: http://127.0.0.1:8000/docs
- OpenAPI: http://127.0.0.1:8000/openapi.json

Windows에서는 위 실행 명령으로 psycopg에 필요한 Selector 이벤트 루프를 사용합니다.

## DB·인증 설정

DB 담당자가 기존 스키마를 준비한 뒤 `db/supabase_auth_rls.sql`과 `docs/sql/001_agent_postgres.sql`을 검토·적용해야 합니다. SQL 파일 수정만으로 원격 Supabase가 변경되지는 않습니다. 기존 테이블 생성 SQL 전체를 다시 실행하지 않습니다.

- `DATABASE_URL`: Supabase PostgreSQL Direct 또는 Session pooler 연결 문자열. Transaction pooler(6543)는 지원하지 않습니다.
- 동시성 RPC: 기본 스키마와 `db/supabase_auth_rls.sql` 적용 후 `db/concurrency_rpc.sql`도 적용해야 합니다. 정원 변경·참여 승인·일정 승인은 이 migration의 PostgreSQL RPC에서 행 잠금, 트랜잭션, 낙관적 버전 검사를 함께 수행합니다.
- `SUPABASE_URL`: 해당 프로젝트의 Project URL. DB 연결 문자열과 다릅니다.
- `SUPABASE_JWT_ISSUER`: 미설정 시 Project URL에서 계산합니다.
- `SUPABASE_JWT_SECRET`: HS256 레거시 프로젝트만 설정합니다. JWKS signing key 프로젝트는 비워 둡니다. DB 비밀번호·API key와 다른 값입니다.

보호된 API는 `Authorization: Bearer <access-token>`을 사용합니다. Swagger의 **Authorize**에 로그인 access token을 입력합니다. JWT의 `sub`를 `public.users.auth_user_id`에 연결하며 `X-Demo-User-Id`는 지원하지 않습니다.

일반 repository는 요청 claims와 `anon`/`authenticated` 역할을 사용합니다. 에이전트 체크포인트·기억은 서버 전용 `agent_storage`에 저장합니다. 서버는 테이블을 자동 생성하지 않으며 SQLite·인메모리로 자동 전환하지 않습니다.

도구 선택 한도는 `AGENT_MAX_TOOL_ROUNDS=8`, 논리적 호출 한도는 `AGENT_MAX_TOOL_CALLS=12`가 기본값입니다. `.env`에 추가하지 않아도 기본값을 사용합니다.

자세한 안내: [인증 전환](docs/auth-migration.md), [에이전트 DB 설정](docs/agent-postgres.md).

## 에이전트 흐름

```text
요청 → 기억·조건 확인 → OpenAI 도구 선택 ⇄ 도구 실행·결과 전달 → 후보 생성 → 독립 검증
                             ↑                ↓ 오류
                             └─ 재조회·수정 ──┘
정상 일정 → 초안 → 모임장 승인 대기 → 최신 조건 재검증 → 트랜잭션 반영
```

OpenAI 모드에서는 `choose_tools`가 Function Calling으로 다음 도구를 선택하고 결과를 확인하며 반복합니다. 서버는 필수 조회·인자·접근 범위·호출 한도를 검증합니다. 승인 단계의 최신 정보 조회는 기존대로 서버가 강제합니다.

입력·승인 대기는 LangGraph interrupt/resume과 PostgreSQL 체크포인트를 사용합니다. 승인 전 확정 일정은 유지하고, 조건이 달라지면 새 초안으로 다시 승인받습니다. 기존 일정 API도 같은 그래프를 호출하며 생성·승인 응답은 실행 객체입니다.

## 실제 연동과 시뮬레이션

| 설정 | 동작 |
| --- | --- |
| `AGENT_MODEL_PROVIDER=rules` | LLM 호출 없는 규칙 기반 생성 |
| `AGENT_MODEL_PROVIDER=openai` | OpenAI로 조건 해석·도구 선택·일정 생성·수정 전략 생성 |
| `AGENT_WEATHER_PROVIDER=demo` | 고정 시험 날씨 |
| `AGENT_WEATHER_PROVIDER=openmeteo` | 실제 예보 조회 |
| `TOUR_API_SERVICE_KEY` 설정 | TourAPI 대체 축제 검색 |

OpenAI 모드에는 `OPENAI_API_KEY`, `OPENAI_MODEL`이 필요합니다. 매칭 점수·대체 후보 정렬은 규칙 기반입니다. `DemoRepository`와 인메모리 체크포인터는 테스트에서만 명시적으로 주입합니다. 프론트의 DemoProvider/localStorage는 별도 실제 API 연동이 필요합니다.

## 폴더 구조

```text
app/
├── main.py                    # 앱 팩토리·시작·종료
├── __main__.py                # Windows 호환 실행
├── core/                      # 설정·JWT 인증·응답·DB·repository 구성
└── features/
    ├── agents/                # graph·state·policy·providers·tools·memory·service
    ├── auth/
    ├── festivals/
    ├── matching/
    ├── groups/
    ├── chat/
    ├── schedules/             # 그래프 연결 API·일정 저장
    └── alerts/
db/supabase_auth_rls.sql        # 인증 정책·회원가입 트리거
docs/sql/001_agent_postgres.sql # 체크포인트·기억 저장소
scripts/                       # HTTP 시연·격리 평가
tests/                         # 그래프·인증·저장소 테스트
```

## 터미널 대화형 LangGraph 시험 (Auth 불필요)

```powershell
uv run python -m scripts.agent_console
```

`.env`의 모델 설정을 사용합니다. OpenAI 모드는 실제 API를 호출하며 비용이 발생합니다. 서버나 로그인 토큰은 필요하지 않습니다. API 호출 없이 연습하려면 다음 명령을 사용합니다.

```powershell
uv run python -m scripts.agent_console --provider rules
```

`일정 만들어줘` 입력 → 모임은 Enter로 `demo` 선택 → 표시된 시험 날짜 선택 → 시작 `15:00`, 종료 `18:00` 입력 → 초안 확인 후 `approve` 입력으로 중단·재개·승인 흐름을 확인합니다. `reject`는 거절, `cancel`은 취소입니다. `/memory`로 세션 기억 확인, `/new`로 새 세션, `/exit`로 종료합니다.

실제 AgentService·StateGraph를 사용하되 사용자·축제·날씨·저장소는 시험용으로 주입합니다. 공유 Supabase와 실제 일정은 변경하지 않습니다. 실행 기록·기억은 프로세스 종료 시 사라집니다. API 서버의 JWT·PostgreSQL 설정은 그대로 유지합니다. 실제 로그인·RLS·외부 축제/날씨 연동을 검증하는 명령은 아닙니다.

대화형 입력 시험: 규칙 모드에서 추가 질문 후 승인, 거절, 취소, 잘못된 시간 수정, 입력 종료(EOF) 처리 5개 시나리오를 확인했습니다.

## 테스트·시연

```powershell
uv run python -m pytest tests -q
uv run python -m scripts.agent_demo --group-id YOUR_GROUP_ID
uv run python -m scripts.evaluate_agent --output data/agent-evaluation.json
```

외부 축제·날씨 동기화 Worker는 API 서버와 별도 프로세스로 실행합니다. `DATABASE_URL`과
`TOUR_API_SERVICE_KEY`를 설정하고 `db/external_sync_worker.sql`을 적용한 뒤 다음 명령을 실행합니다.

```powershell
uv run python -m app.sync_worker
```

시연 스크립트는 `SUPABASE_ACCESS_TOKEN` 환경변수로 로그인 토큰을 받습니다. `--approve` 옵션은 실제 일정을 변경합니다. 토큰을 Git이나 문서에 저장하지 않습니다.

DB 통합 테스트는 별도로 준비한 시험 DB의 `TEST_AGENT_DATABASE_URL`이 필요합니다. 공유 서비스 DB를 시험 DB로 지정하지 않습니다. HTTP RLS 시험에는 테스트 사용자의 Auth 연결도 필요합니다.

현재 병합 검증 범위와 미확인 항목은 [PR 통합 검증](docs/pr2-integration.md)에 정리했습니다. 과거 시험 결과는 각 시험 보고서에 기록되어 있습니다.

## 팀에서 이어갈 작업

- 프론트: Supabase 로그인, JWT API 요청, 추가 질문·승인·실패 화면 연결.
- 백엔드: 실제 로그인 통합 검증, 참여·위험 이벤트의 실행 연결, API 계약 조율.
- DB: 인증·에이전트 SQL 검토 및 적용, 역할 권한·RLS 검증, 기억 보존 정책.
- 에이전트: 실제 모델·축제 데이터 시험, 이동시간·비용 검증 확장.

OpenAI 도구 선택 변경·시험 결과: [Function Calling 통합](docs/agent-tool-calling.md).

상세 노드·API 계약: [에이전트 워크플로우](docs/agent-workflow.md).
