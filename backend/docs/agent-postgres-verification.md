# PostgreSQL 전환 검증 결과

검증일: 2026-11-14 (KST). 실제 원격 Supabase가 아닌 격리된 로컬 PostgreSQL 17.6에서 검증했습니다.

| 항목 | 결과 |
| --- | --- |
| 팀 v4.3 SQL 전체 실행 | 성공. 로컬에서 Supabase 역할·Auth 최소 스텁을 준비하여 적용 |
| 에이전트 추가 SQL 실행·재실행 | 두 번 모두 성공 |
| PostgreSQL 저장을 사용하는 전체 테스트 | **28 passed** |
| DB 없는 단위·흐름 시험 | **24 passed, 4 skipped**. PostgreSQL 전용 시험 4개만 미실행 |
| 실제 SQL repository와 HTTP 일정 승인 | 검증된 초안 생성·승인 후 일정 버전·모든 항목·시스템 메시지 저장 확인 |
| 모임당 초안 1개 제약 | 두 번째 실행은 409 PROPOSAL_ALREADY_PENDING, DB 제약 유지 |
| 서버 프로세스 재시작 | 승인 대기 실행을 저장한 서버 종료 후 새 프로세스에서 같은 체크포인트 조회·승인 완료 |
| 서로 다른 서비스 인스턴스 | 같은 실행 조회, advisory lock 충돌 409, 잠금 해제 후 재개 확인 |
| 사용자 기억 | 선호의 동시 JSON 병합, 세션 소유권, 요약·메시지 제한 확인 |
| RLS·스키마 접근 | 테이블 7개 모두 RLS 활성화, anon/authenticated의 스키마 USAGE 권한 없음 |
| 실행기 | Windows `python -m app`, `python -m app --reload` 모두 실행·HTTP 확인 |
| 상태·문서 | /health, /health/db, /docs, /openapi.json 모두 HTTP 200. DB status=connected, missingTables=[] |
| 의존성·문법 | uv sync --locked, compileall, git diff --check 통과 |
| SQLite 의존 | app/scripts/pyproject/uv.lock에서 sqlite·aiosqlite 참조 없음 |

오프라인 평가 스크립트는 개발용 InMemorySaver를 명시적으로 주입하여 실행했습니다. API 서버가 선택하는 대체 저장소는 아니며 PostgreSQL 연동 시험과 구분합니다.

실제 Supabase 프로젝트의 SQL 실행·원격 DSN·SSL·권한·연결 제한은 자격 증명이 없어 확인하지 않았습니다. 추가 SQL 적용 및 원격 연결 확인은 [DB 담당자 안내](agent-postgres.md)를 따릅니다. 기존 SQLite 파일·데이터는 보존했고 자동 이관하지 않았습니다.
