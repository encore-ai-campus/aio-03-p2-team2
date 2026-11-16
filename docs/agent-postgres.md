> 2026-11-15 수정: 체크포인트 DDL의 모든 테이블 이름에 `agent_storage`를 명시하고 버전 테이블을 조회 전에 생성하도록 변경했습니다. SQL Editor의 기존 쿼리를 수정 파일 전체로 교체해 실행하세요. 정적 회귀 검사 2개가 통과했습니다. 수정판의 로컬 PostgreSQL 재실행은 Windows 애플리케이션 제어가 DB 라이브러리를 차단해 완료하지 못했으며 원격 Supabase 실행 결과 확인이 필요합니다.

# DB 담당자 전달: 에이전트 PostgreSQL 적용

에이전트 체크포인트·사용자 선호·세션·실행 소유권을 **기존 서비스와 같은 Supabase PostgreSQL**에 저장합니다. 서버 실행 중 SQLite는 사용하지 않습니다.

## DB 담당자가 할 일

1. 기존 FestaMate v4.3 SQL이 적용된 프로젝트의 SQL Editor를 엽니다.
2. [001_agent_postgres.sql](sql/001_agent_postgres.sql)을 **전체 실행**합니다.
3. 마지막 조회 결과에 `agent_storage` 스키마의 테이블 7개, `rowsecurity=true`, 체크포인터 버전 `9`가 표시되는지 확인합니다.
4. 백엔드 담당자에게 해당 프로젝트의 **Direct 또는 Session pooler DB 연결 문자열**을 안전하게 전달합니다. 비밀번호·연결 문자열을 Notion·Git에 올리지 않습니다.

기존 v4.3 SQL 전체를 다시 실행하거나 기존 테이블을 삭제할 필요가 없습니다. 추가 SQL은 기존 `public` 테이블·RLS·승인 함수를 변경하지 않습니다. 외래 키가 참조하는 `public.users`가 먼저 있어야 합니다. 같은 추가 SQL은 재실행할 수 있으며 로컬 DB에서 두 번 실행해 확인했습니다.

## 추가되는 테이블

| 스키마·테이블 | 역할 |
| --- | --- |
| `agent_storage.sessions` | 사용자별 대화 조건·요약·최근 메시지 |
| `agent_storage.preferences` | 명시적으로 확인한 장기 선호 |
| `agent_storage.executions` | runId·소유자·세션·제안 연결·진행 상태 |
| `agent_storage.checkpoints` | LangGraph 실행 체크포인트 |
| `agent_storage.checkpoint_blobs` | 체크포인트 채널 값 |
| `agent_storage.checkpoint_writes` | 실행 중 기록·중단 후 재개 정보 |
| `agent_storage.checkpoint_migrations` | 공식 체크포인터 스키마 버전 |

Supabase Table Editor의 스키마 선택에서 `agent_storage`를 확인할 수 있습니다. 이 스키마를 Data API의 exposed schemas에 추가하지 않습니다. 익명·일반 로그인 사용자에게 스키마 접근 권한을 주지 않으며 7개 테이블 모두 RLS가 켜져 있습니다. 백엔드 DB 관리자 연결 또는 서버 역할만 접근합니다.

기존 **`public.agent_runs`, `public.agent_steps`는 삭제·덮어쓰기하지 않습니다.** 기존 두 테이블은 감사·분석용 설계이고, 새 `executions`는 그래프 재개·소유권·세션·제안 연결에 필요한 실행 등록부입니다. 노드·도구 실행 기록은 현재 PostgreSQL 체크포인트에 보존하며, 기존 공개 스키마의 감사 테이블로 별도 적재하는 연결은 이번 변경에 포함하지 않았습니다.

공식 체크포인터 테이블은 `langgraph-checkpoint-postgres==3.2.1`의 migrations 0~9를 기준으로 생성했습니다. SQL Editor에서 한 트랜잭션으로 실행하도록 공식 `CREATE INDEX CONCURRENTLY`를 일반 `CREATE INDEX`로 바꿨습니다. 라이브러리 업데이트 시 담당자가 SQL도 검토해야 하며, 서버가 시작할 때 자동으로 `setup()`이나 DDL을 실행하지 않습니다.

## 백엔드 설정과 실행

`.env.example`의 `DATABASE_URL`을 기존 일반 API와 에이전트가 같이 사용합니다. Supabase URL·anon 키·service_role API 키를 넣는 칸이 아닙니다. **PostgreSQL DB 연결 문자열**이 필요합니다.

```dotenv
DATABASE_URL=postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@SESSION_POOLER_HOST:5432/postgres?sslmode=require
DATABASE_REQUIRED=true
AGENT_DATABASE_POOL_MAX_SIZE=5
AGENT_DATABASE_TIMEOUT=10
```

대시보드 Connect에서 프로젝트에 맞는 값을 가져옵니다. Direct 연결도 가능합니다. **Transaction pooler(6543)는 사용하지 않습니다.** 실행 재개 잠금이 세션 단위 PostgreSQL advisory lock을 사용하기 때문입니다. 앱은 Session pooler와 호환되도록 준비된 쿼리를 비활성화하고 각 연결의 search_path를 전용 스키마로 설정합니다.

```powershell
uv sync --locked
uv run python -m app --reload --host 127.0.0.1 --port 8000
```

Windows에서 psycopg가 요구하는 Selector 이벤트 루프를 시작 전에 설정하도록 `python -m app` 실행기를 추가했습니다. `/docs`, `/health/db`와 에이전트 API를 확인합니다. DB 연결이나 추가 스키마가 없으면 시작 시 명확히 실패하며 SQLite·인메모리로 자동 전환하지 않습니다.

사용자 ID는 `public.users.id`입니다. 기존 `usr_demo_01` 같은 테스트 사용자는 이 추가 SQL이 생성하지 않습니다. 실제 사용자 레코드나 DB 담당자가 준비한 테스트 사용자를 사용해야 합니다. 일반 서비스도 같은 DB에 연결하므로 모임 ID 역시 실제 `public.groups`에 있어야 합니다.

## 기존 SQLite 데이터

`data/memory.sqlite3`, `data/checkpoints.sqlite3`는 **삭제하지 않았습니다.** 앱이 더 이상 읽거나 갱신하지 않으며 자동 이관하지 않습니다. 이전 로컬 실행 ID·승인 대기는 PostgreSQL에서 그대로 재개되지 않습니다. 실제 DB 사용자·모임으로 새 실행을 시작합니다. 보존할 과거 선호가 있다면 사용자 ID 매핑을 확인한 별도 이관 작업이 필요합니다.

## 테스트와 확인 범위

```powershell
# DB 없는 규칙·흐름 시험: 테스트 전용 InMemorySaver 주입, SQLite 사용 없음
uv run python -m pytest tests -q

# 격리된 테스트 DB에 기존 v4.3 + 추가 SQL과 테스트 사용자를 준비한 뒤 실행
$env:TEST_AGENT_DATABASE_URL="postgresql://TEST_USER:TEST_PASSWORD@TEST_HOST:5432/TEST_DB"
uv run python -m pytest tests -q
```

통합 시험은 공유 운영 DB가 아닌 별도 테스트 DB에서 실행합니다. 기존 흐름 시험은 3개 데모 사용자(`usr_demo_01`~`03`)를 전제로 합니다. 테스트는 Supabase Auth UUID가 아닌 서비스 사용자 ID를 사용합니다. 테스트 SQL/사용자는 DB 담당자가 격리된 DB에 준비하며 앱이 자동으로 공용 DB 구조를 만들거나 지우지 않습니다.

실제 PostgreSQL 17.6에 팀의 전체 v4.3 SQL과 추가 SQL을 적용해 **28개 테스트가 통과**했습니다. 공식 체크포인터 저장·연결 종료 후 재개·장기 선호·사용자 격리·여러 서비스 인스턴스의 동시 재개 잠금·실제 SQL repository/HTTP 승인까지 확인했습니다. Supabase 원격 접속·인증·프로젝트별 연결 제한은 자격 증명이 없어 아직 확인하지 않았습니다.

추가로 기존 `모임당 draft 1개` 제약을 유지하고, 이미 제안이 있을 때는 서버가 `409 PROPOSAL_ALREADY_PENDING`을 반환하도록 맞췄습니다. DB 제약은 해제하지 않았습니다.

참고: [LangGraph PostgreSQL 체크포인터](https://docs.langchain.com/oss/python/langgraph/add-memory), [Supabase 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres), [psycopg 연결 풀](https://www.psycopg.org/psycopg3/docs/advanced/pool.html).
