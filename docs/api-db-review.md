> 이 문서는 기존 API/DB 설계 검토 기록입니다. 아래 인메모리 전환·일정 RPC 관련 계획은 현재 구현과 다를 수 있습니다. 최신 에이전트·일정 계약과 검증 범위는 [agent-workflow.md](agent-workflow.md), [시험 보고서](agent-test-report.md)를 확인하세요.

# API · DB 설계 일치 검토

검토 대상은 다음 문서입니다.

- `261113 API 설계서.md`: MVP API 계약
- `DB설계서_v4.3_API기준.md`: PostgreSQL/Supabase 저장 모델과 트랜잭션
- `festamate_schema_v4.3.txt`: 실행 가능한 PostgreSQL DDL/RLS/함수
- `DB테이블_역할정리.md`: 테이블별 책임과 데이터 흐름
- `261112_festamate_v5 (1).html`: 프론트 발표용 목업

## 결론

API 설계서와 DB 설계서는 큰 도메인 범위와 핵심 상태 전이가 일치합니다. 특히 사용자·축제·모임·멤버·신청·메시지·일정·매칭·알림 테이블의 대응, Supabase Auth 사용, `version` 낙관적 잠금, 정원 조건부 갱신, 일정 제안 승인 후 반영, 사용자별 알림 행 생성이 서로 일치합니다.

다만 API 문서는 프론트 계약 중심이고 DB 문서는 영속성·동시성·RLS 중심이므로 다음 항목은 서버 구현에서 변환하거나 보강해야 합니다.

| 항목 | API 계약 | DB 설계 | 판단 및 조치 |
| --- | --- | --- | --- |
| 축제 `status` | `past/live/upcoming` 응답 | 저장하지 않고 오늘 날짜로 계산하는 뷰 | 응답 시 계산하도록 구현. KST 기준 계산은 PostgreSQL의 `kst_today()`를 사용 |
| 축제 장소·운영시간 | `venue`, `operatingHours` 중첩 JSON | `venue_*` 컬럼과 `festival_operating_hours` 행 | Repository에서 조립해야 함 |
| 사용자 인증 | Supabase Auth Bearer JWT | `users.auth_user_id` + Supabase Auth/RLS | JWT `sub`를 앱 사용자로 매핑하고 DB 세션의 `auth.uid()`로 RLS 적용 |
| 프로필 값 | camelCase JSON | snake_case, `travel_style`/MBTI CHECK | 요청 스키마에 DB 허용값과 길이 제약 반영 |
| 모임 정원 | `capacity`, `memberCount`, `full` | `member_count` 조건부 증가 + 행 잠금/버전 | Repository 트랜잭션에서 행 잠금·정원 확인·버전 증가를 함께 수행 |
| 멤버 탈퇴 | `DELETE /membership` | `left_at` 소프트 탈퇴 | DB Repository는 삭제 대신 `left_at` 갱신해야 함 |
| 일정 | 일정 항목과 검증 결과 | `group_schedules.items` JSONB + 별도 `version` | API 응답 조립 시 `items`와 검증 필드를 합쳐야 함 |
| 제안 ID | `proposalId` | `prp_` 접두사 | 서버 생성 ID를 `prp_`로 통일 |
| 채팅 | `clientMessageId`, 시스템 메시지 | `sender_id IS NULL` 시스템 행 | Repository에서 advisory transaction lock + 재조회로 멱등 삽입 처리 |
| 외부 작업 | `202 { jobId }` | `external_sync_runs`, `GET /jobs/{jobId}` | 작업 조회 API를 추가하고 worker가 상태를 갱신해야 함 |
| 중복 요청 | 선택적 `Idempotency-Key` | `idempotency_keys` | 생성·승인·알림 응답에 middleware/repository 적용 필요 |
| 기록 | API에는 일부만 명시 | `audit_logs`, `agent_runs`, `agent_steps` | 승인·일정 확정·관리자 작업은 DB 트랜잭션 안에서 기록 필요 |

## 현재 코드에 반영한 부분

- `DATABASE_URL`이 있으면 FastAPI startup에서 Supabase PostgreSQL connection pool을 생성합니다.
- `/health/db`에서 연결 상태와 필수 스키마 누락 테이블을 확인합니다.
- `DATABASE_REQUIRED=true`이면 연결 실패 또는 핵심 테이블 누락 시 서버 startup을 실패시킵니다.
- 기능 라우터는 `get_repository()`를 통해서만 데이터에 접근하며 `app/core/store.py`는 런타임 경로에서 사용하지 않습니다. DB 미설정 시 기능 API는 `503 DATABASE_UNAVAILABLE`을 반환합니다.
- 프로필·모임·댓글·채팅 길이, 예산·여행 스타일·정원 범위를 DB CHECK 제약과 맞췄습니다.
- 축제 `status`는 저장값이 아니라 조회 시 날짜로 계산합니다.
- 일정 확정 알림은 DB 설계의 `schedule_changed` 타입을 사용합니다.
- 외부 수집 작업 조회 경로 `GET /api/v1/jobs/{jobId}`를 제공합니다.

## Repository 구현 결과 및 남은 운영 작업

현재 기능 라우터는 도메인별 Repository를 통해 실제 PostgreSQL CRUD를 수행합니다.

1. 첨부된 `festamate_schema_v4.3.txt`를 Supabase SQL Editor에서 실행합니다. `auth.users` 트리거와 RLS 정책도 함께 적용해야 합니다.
2. 댓글·참여 신청·매칭 후보 목록은 Repository에서 서버 측 페이지네이션 쿼리를 실행합니다.
3. 모임 생성·신청·승인·거절·탈퇴는 PostgreSQL 트랜잭션과 행 잠금으로 원자 처리합니다.
4. 일정 제안 승인도 `group_schedules.version`과 모임 `version`을 검사해 충돌을 차단합니다.
5. 채팅은 현재 스키마에 맞춰 `clientMessageId`별 PostgreSQL advisory transaction lock과 재조회를 사용해 재시도 멱등성을 보장합니다.
6. 외부 수집 작업은 `external_sync_runs`에 저장하고 `/jobs/{jobId}`가 DB 상태를 반환합니다. 실제 worker와 운영 재시도 정책은 별도 작업입니다.
7. 운영 배포 경로는 Supabase Auth JWT와 RLS를 사용하며, 세부 SQL은 `db/supabase_auth_rls.sql`에 있습니다.

## HTML 목업의 취급

HTML의 데모 사용자 전환, 강수·취소 즉시 주입, JSON 업로드, localStorage 초기화·복원, 화면용 샘플 데이터는 발표용 목업 기능입니다. API·DB 영속성 요구사항으로 그대로 옮기지 않고, 개발 환경용 admin sync/import로만 제한합니다.
