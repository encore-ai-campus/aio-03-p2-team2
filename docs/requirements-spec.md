# FestaMate 백엔드 요구사항명세서

## 1. 문서 개요

### 1.1 목적

본 문서는 `aio-03-p2-2team-Backend` 저장소의 현재 백엔드 코드와 기존 API·DB 검토 문서를 기준으로 FestaMate 백엔드의 기능·비기능 요구사항, API 계약, 데이터 규칙 및 구현 현황을 정리한 명세서다.

이 문서에서 **구현됨**은 현재 코드에서 확인되는 동작을 의미하며, **보완 필요**는 코드 또는 운영 전제상 추가 구현·확인이 필요한 항목을 의미한다.

### 1.2 분석 범위

- 실행 진입점: `app/main.py`
- 공통 계층: `app/core/*`
- 기능 계층: `app/features/auth`, `festivals`, `matching`, `groups`, `chat`, `schedules`, `alerts`
- 설정 및 의존성: `.env.example`, `pyproject.toml`
- 설계 검토 참고: `docs/api-db-review.md`

### 1.3 시스템 요약

FestaMate는 축제 정보를 탐색하고, 사용자 조건에 맞는 동행자를 매칭하며, 모임 생성·참여·채팅·일정 조율·축제 변경 알림을 제공하는 FastAPI 기반 백엔드다.

현재 코드는 다음 구조를 사용한다.

- Python 3.12+, FastAPI, Uvicorn
- 요청·응답 모델: Pydantic 기반 camelCase JSON 계약
- 영속 저장소: PostgreSQL/Supabase용 `asyncpg` Repository
- 인증 어댑터: Supabase Auth JWT 및 WebSocket access token
- 실시간 통신: 그룹 채팅 WebSocket
- 관리성 작업: 개발 환경에서만 축제·날씨·공지 동기화 작업 생성

## 2. 사용자 및 권한

| 사용자 유형 | 설명 | 주요 권한 |
|---|---|---|
| 비인증/공개 사용자 | 축제 및 공개 모임 탐색 사용자 | 축제 목록·상세·캘린더, 공개 모임 목록·상세 조회 |
| 인증 사용자 | Supabase Auth JWT의 `sub`와 `users.auth_user_id`로 연결되는 사용자 | 본인 프로필·동의 수정, 매칭, 모임 생성·신청, 댓글·채팅, 일정·알림 이용 |
| 모임장 | 모임을 생성한 사용자 | 모임 수정, 참여 신청 조회·승인·거절, 일정 검증·제안·승인·거절 |
| 모임 멤버 | 모임에 승인되었거나 즉시 참여한 사용자 | 모임 채팅, 일정 조회, 모임 탈퇴 |
| 개발 관리자 | `development`, `local`, `test` 환경에서 관리 API를 호출하는 주체 | 축제·날씨·공지 동기화 작업 생성 |
| 외부 작업/시스템 | 축제·날씨·공지 데이터를 공급하거나 알림을 생성하는 시스템 | 동기화 작업 상태 갱신, 위험·변경 알림 생성 |

### 2.1 인증·인가 요구사항

- REQ-AUTH-001 **[구현됨]** 인증이 필요한 REST 요청은 유효한 Supabase Auth Bearer JWT를 받아야 한다.
- REQ-AUTH-002 **[구현됨]** JWT subject는 `users.auth_user_id`의 활성 사용자로 조회되어야 하며, 토큰이 없거나 유효하지 않으면 `401`, 매핑되지 않으면 `403`을 반환한다.
- REQ-AUTH-003 **[구현됨]** 사용자 프로필·알림 동의 수정은 대상 사용자 ID와 JWT로 확인한 현재 사용자 ID가 동일해야 한다. 불일치 시 `403 USER_FORBIDDEN`을 반환한다.
- REQ-AUTH-004 **[구현됨]** 모임장 전용 작업은 그룹의 `leaderId`와 요청 사용자가 일치해야 한다.
- REQ-AUTH-005 **[구현됨]** 멤버 전용 작업은 현재 멤버 목록에 요청 사용자가 포함되어야 한다.
- REQ-AUTH-006 **[구현됨]** 보호 API는 Supabase Auth JWT 및 RLS 기반 인증을 사용한다.
- REQ-AUTH-007 **[구현됨]** 관리 API는 JWT의 `app_metadata.role`이 `admin` 또는 `service_role`인 경우에만 접근할 수 있다.

## 3. 공통 API 요구사항

### 3.1 기본 경로 및 응답 형식

- 기본 API 경로는 `/api/v1`이다.
- 성공 응답은 다음 형식을 따른다.

```json
{
  "data": {},
  "meta": { "requestId": "req_..." }
}
```

- 목록 응답은 `data.items`, `data.page`, `data.pageSize`, `data.total`을 사용한다.
- 오류 응답은 다음 형식을 따른다.

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "사용자에게 표시할 메시지",
    "details": {},
    "requestId": "req_..."
  }
}
```

- 모든 HTTP 응답에는 `X-Request-Id` 응답 헤더가 포함되어야 한다. 요청 헤더에 ID가 없으면 서버가 `req_` 접두사의 ID를 생성한다.
- Pydantic 요청 모델은 snake_case 필드 입력과 camelCase alias를 모두 지원하며, 정의되지 않은 필드는 거부한다.
- 날짜는 `YYYY-MM-DD`, 시각은 `HH:mm`, 타임스탬프는 UTC ISO 8601 형식(`Z`)을 사용한다.

### 3.2 공통 오류 요구사항

- REQ-API-001 **[구현됨]** 요청 검증 오류는 HTTP 400과 `REQUEST_VALIDATION_ERROR`로 반환한다.
- REQ-API-002 **[구현됨]** 존재하지 않는 리소스는 도메인별 `*_NOT_FOUND` 코드와 HTTP 404로 반환한다.
- REQ-API-003 **[구현됨]** 권한 부족은 HTTP 403, 상태·동시성 충돌은 HTTP 409 또는 도메인 규칙에 따른 HTTP 422로 반환한다.
- REQ-API-004 **[구현됨]** 페이지 번호는 1 이상, 기본 페이지 크기는 20, 최대 페이지 크기는 100이다. 메시지는 기본 50건, 최대 100건이다.
- REQ-API-005 **[보완 필요]** 오류 코드·상태 코드·메시지 표를 OpenAPI와 별도 운영 문서로 고정해야 한다.

### 3.3 상태 확인 API

| ID | Method | Path | 인증 | 요구사항 |
|---|---|---|---|---|
| REQ-HEALTH-001 | GET | `/health` | 공개 | 애플리케이션이 요청을 처리할 수 있으면 `{"status":"ok"}`를 반환한다. |
| REQ-HEALTH-002 | GET | `/health/db` | 공개 | DB 설정 여부, 연결 상태, 필수 테이블 누락 여부를 반환한다. |

## 4. 기능 요구사항

### 4.1 사용자 프로필 및 알림 동의

### 기능 규칙

- 사용자는 자신의 기본 정보, 프로필, 알림 동의 정보를 조회할 수 있어야 한다.
- 프로필은 관심사, 예산(만원 단위), 여행 스타일, MBTI, 선호 인원 수, 참여 가능 시작 시각, 기본 참여 모드로 구성된다.
- 여행 스타일은 `여유롭게`, `활동적으로`, `계획적으로` 중 하나다.
- 기본 참여 모드는 `approval` 또는 `instant`다.
- 참여 가능 시작 시각은 `HH:mm` 형식이어야 한다.
- 알림 동의는 `push`, `email`, `riskAlert` 세 항목을 지원한다.

### API

| ID | Method | Path | 인증 | 요구사항 |
|---|---|---|---|---|
| REQ-USER-001 | GET | `/users/{userId}` | 본인 | 본인 사용자 정보를 조회한다. |
| REQ-USER-002 | PATCH | `/users/{userId}/profile` | 본인 | 전달된 프로필 필드만 부분 수정한다. |
| REQ-USER-003 | PATCH | `/users/{userId}/notification-consents` | 본인 | 전달된 알림 동의 필드만 부분 수정한다. |

### 입력 제약

- 예산: 1~1000만원
- 선호 파티 규모: 2~100명
- MBTI·관심사: 배열
- 빈 PATCH 요청은 현재 값 유지로 처리된다.

### 4.2 축제 탐색 및 동기화

### 기능 규칙

- 축제는 이름, 지역, 도시, 기간, 카테고리, 설명, 태그, 장소, 운영시간, 위험 상태를 가진다.
- 축제 상태는 저장값을 그대로 신뢰하지 않고 조회 시 날짜 기준으로 `past`, `live`, `upcoming`으로 계산되어야 한다.
- 이용 가능 축제는 종료일이 오늘 이후이고 위험 상태가 `cancelled`가 아닌 축제다.
- 축제 목록은 연도·월·기간·지역/도시·카테고리·키워드·상태로 필터링할 수 있어야 한다.
- 키워드는 이름·설명·태그를 대상으로 검색한다.
- 캘린더 조회는 해당 월의 축제 날짜별 이벤트를 반환한다.
- 대체 축제는 취소되지 않았고 원 축제와 카테고리 또는 태그가 겹치며 시작일이 가까운 순으로 제공한다.

### API

| ID | Method | Path | 인증 | 요구사항 |
|---|---|---|---|---|
| REQ-FEST-001 | GET | `/festivals` | 공개 | 축제 목록을 필터·페이지네이션하여 조회한다. |
| REQ-FEST-002 | GET | `/festivals/calendar` | 공개 | 연·월 기준 축제 캘린더 이벤트를 조회한다. `year`, `month`는 필수다. |
| REQ-FEST-003 | GET | `/festivals/{festivalId}` | 공개 | 축제 상세 및 운영시간·장소를 조회한다. |
| REQ-FEST-004 | GET | `/festivals/{festivalId}/alternatives` | 데모 사용자 | 대체 가능한 축제 목록을 조회한다. `groupId`는 선택이다. |
| REQ-FEST-005 | POST | `/admin/festivals/sync` | 개발 관리자 | 외부 축제 동기화 작업을 생성하고 `202` 및 `jobId`를 반환한다. |
| REQ-FEST-006 | POST | `/admin/festivals/import` | 개발 관리자 | 축제 배열을 검증·upsert하고 수락·거절 건수를 반환한다. |

### 수입·동기화 규칙

- 축제 수입 요청은 최소 1건이어야 한다.
- `endDate < startDate`인 항목은 저장하지 않고 거절 목록에 포함한다.
- 축제 import는 `festival_import` 작업을 생성한다.
- 현재 sync/import API는 작업 레코드 생성 및 import 처리는 수행하지만, 외부 수집 worker 연동은 별도 구현이 필요하다.

### 4.3 사용자 조건 기반 매칭

### 기능 규칙

- 자연어 조건을 축제, 시작 시각, 예산, 관심사, 여행 스타일, 선호 MBTI, 파티 규모, 참여 모드 슬롯으로 파싱한다.
- 매칭 실행 시 선택한 축제가 존재하고 취소되지 않았는지 검증한다.
- 본인을 제외한 활성 사용자를 후보로 삼는다.
- 후보 점수는 일정 25점, 관심사 20점, 예산 20점, 여행 스타일 15점, MBTI 10점, 파티 규모 10점 가중치를 사용한다.
- 결과는 상위 `topK`명까지 저장·반환하며 `topK` 범위는 1~20이다.
- 요청 시 매칭 실행과 함께 그룹을 생성할 수 있다. 이때 그룹 제목·본문이 필수다.
- MBTI 조건이 없거나 비교 대상 프로필이 없으면 MBTI 점수는 분모에서 제외된다.

### API

| ID | Method | Path | 인증 | 요구사항 |
|---|---|---|---|---|
| REQ-MATCH-001 | POST | `/matching/parse` | 데모 사용자 | 자연어 입력을 구조화된 조건 초안과 누락 슬롯으로 반환한다. |
| REQ-MATCH-002 | POST | `/matching/runs` | 데모 사용자 | 조건으로 매칭을 실행하고 결과를 저장한다. |
| REQ-MATCH-003 | GET | `/matching/runs/{runId}` | 실행 사용자 | 본인이 실행한 매칭 결과만 조회한다. |
| REQ-MATCH-004 | GET | `/matching/runs/{runId}/candidates` | 실행 사용자 | 매칭 후보를 페이지네이션하여 조회한다. |

### 입력 제약

- 자연어 텍스트: 1~2000자
- 예산: 1~1000만원
- 파티 규모: 2~100명
- 그룹 제목: 1~120자
- 그룹 본문: 1~5000자

현재 파서는 정규식·키워드 기반 `match-slot-v1`이며, OpenAI/LangGraph 기반 해석기는 아직 연결되어 있지 않다.

### 4.4 동행 모임

### 기능 규칙

- 모임은 축제, 제목, 본문, 모임장, 참여 방식, 정원, 상태, 멤버, 참여 신청, 댓글, 일정, 버전을 가진다.
- 모임 생성자는 자동으로 모임장이자 첫 멤버가 된다.
- 참여 방식은 승인제(`approval`)와 즉시 참여(`instant`)를 지원한다.
- 멤버 수가 정원 이상이면 상태는 `full`, 그 외에는 `open`이다. `closed`·`cancelled` 상태는 자동 갱신 대상에서 제외한다.
- 정원은 2~8명이며 현재 멤버 수보다 작게 변경할 수 없다.
- 모임 수정·참여 승인·거절은 `version` 또는 `If-Match`를 사용한 낙관적 동시성 제어를 적용한다.
- 모임장은 탈퇴할 수 없으며, 먼저 모임 종료 또는 양도 기능이 필요하다.
- 일반 멤버는 탈퇴할 수 있고, DB에서는 `left_at` 기반 소프트 탈퇴로 처리한다.
- 댓글은 작성할 수 있으며 작성자 또는 모임장만 삭제할 수 있다. 삭제는 soft delete다.
- 공개 조회에서는 멤버·신청·댓글·일정 등 내부 정보가 노출되지 않도록 목록 응답을 축약한다.

### API

| ID | Method | Path | 인증 | 요구사항 |
|---|---|---|---|---|
| REQ-GROUP-001 | GET | `/groups` | 공개 | 축제·상태·키워드로 모임을 검색하고 페이지네이션한다. |
| REQ-GROUP-002 | POST | `/groups` | 데모 사용자 | 이용 가능한 축제에 모임을 생성한다. |
| REQ-GROUP-003 | GET | `/groups/{groupId}` | 공개 | 모임 상세를 조회한다. |
| REQ-GROUP-004 | PATCH | `/groups/{groupId}` | 모임장 | 제목·본문·정원을 수정한다. |
| REQ-GROUP-005 | GET | `/groups/{groupId}/comments` | 공개 | 댓글을 cursor 기반으로 조회한다. |
| REQ-GROUP-006 | POST | `/groups/{groupId}/comments` | 데모 사용자 | 댓글을 작성한다. |
| REQ-GROUP-007 | DELETE | `/groups/{groupId}/comments/{commentId}` | 작성자/모임장 | 댓글을 삭제한다. |
| REQ-GROUP-008 | GET | `/groups/{groupId}/join-requests` | 모임장 | 참여 신청을 상태·페이지 기준으로 조회한다. |
| REQ-GROUP-009 | POST | `/groups/{groupId}/join-requests` | 데모 사용자 | 승인제 신청 또는 즉시 참여를 처리한다. |
| REQ-GROUP-010 | POST | `/groups/{groupId}/join-requests/{requestId}/approve` | 모임장 | 대기 신청을 승인하고 멤버 수·그룹 버전을 갱신한다. |
| REQ-GROUP-011 | POST | `/groups/{groupId}/join-requests/{requestId}/reject` | 모임장 | 대기 신청을 거절하고 사유를 저장한다. |
| REQ-GROUP-012 | DELETE | `/groups/{groupId}/membership` | 멤버 | 모임에서 탈퇴한다. |

### 상태 및 오류 규칙

- 이미 멤버면 `ALREADY_MEMBER`
- 동일 사용자의 대기 신청이 있으면 `JOIN_REQUEST_ALREADY_EXISTS`
- 정원 초과 시 `GROUP_CAPACITY_EXCEEDED`
- 종료·정원 초과·취소 모임 신청 시 `GROUP_CLOSED`
- 대기 상태가 아닌 신청 처리 시 `JOIN_REQUEST_NOT_PENDING`
- 버전 불일치 시 `RESOURCE_VERSION_CONFLICT`

### 4.5 그룹 채팅 및 이벤트

### 기능 규칙

- 그룹 멤버만 메시지를 조회·작성할 수 있다.
- 메시지는 1~1000자이며 선택적 `clientMessageId`를 지원한다.
- 동일 그룹·사용자·클라이언트 메시지 ID를 재전송하면 기존 메시지를 반환해 중복 생성을 방지한다.
- REST 메시지 작성 시 연결된 WebSocket 클라이언트에 생성 이벤트를 방송한다.
- WebSocket 연결 성공 시 `chat.connected` 이벤트를 전송한다.
- 잘못된 메시지는 연결을 끊지 않고 `chat.error` 이벤트를 반환한다.
- 멤버 승인과 같은 시스템 이벤트 메시지는 시스템 발신자로 저장할 수 있어야 한다.

### API 및 이벤트

| ID | Method/Protocol | Path | 인증 | 요구사항 |
|---|---|---|---|---|
| REQ-CHAT-001 | GET | `/groups/{groupId}/messages` | 멤버 | `before`, `after`, `limit` 기반으로 메시지를 조회한다. |
| REQ-CHAT-002 | POST | `/groups/{groupId}/messages` | 멤버 | 메시지를 저장하고 생성 이벤트를 방송한다. |
| REQ-CHAT-003 | GET | `/groups/{groupId}/events` | 멤버 | 최근 메시지를 이벤트 형태로 조회한다. |
| REQ-CHAT-004 | WebSocket | `/ws/groups/{groupId}/chat` + JWT | 멤버 | JWT로 인증된 멤버의 연결·송수신·해제를 처리한다. |

현재 WebSocket 연결 목록은 프로세스 메모리에만 보관되므로 다중 인스턴스 운영 시 Redis 등의 브로커가 필요하다.

### 4.6 그룹 일정 조율

### 기능 규칙

- 그룹 멤버는 현재 일정을 조회할 수 있다.
- 모임장은 모든 멤버의 `availableFrom`을 기준으로 일정 유효성을 검증할 수 있다.
- 모든 멤버가 현재 시작 시각을 만족하면 `valid`, 하나라도 만족하지 못하면 `conflict`다.
- 충돌 시 필요한 시작 시각, 현재 시작 시각, 사유, 검증 트리거를 반환한다.
- 모임장은 멤버 가능 시간 기반의 일정 제안을 생성할 수 있다.
- 축제 운영시간 밖의 제안은 `422 OUTSIDE_FESTIVAL_OPERATING_HOURS`로 거절한다.
- 제안은 `draft` 상태에서만 승인·거절할 수 있다.
- 승인 시 그룹 일정과 일정 버전, 그룹 버전을 갱신하고, 거절 시 사유를 저장한다.
- 일정 변경은 트랜잭션 안에서 처리되어야 한다.

### API

| ID | Method | Path | 인증 | 요구사항 |
|---|---|---|---|---|
| REQ-SCHEDULE-001 | GET | `/groups/{groupId}/schedule` | 멤버 | 현재 일정·검증 결과·제안 목록을 조회한다. |
| REQ-SCHEDULE-002 | POST | `/groups/{groupId}/schedule/validate` | 모임장 | 멤버 가능 시간으로 일정을 검증한다. |
| REQ-SCHEDULE-003 | POST | `/groups/{groupId}/schedule/proposals` | 모임장 | 일정 제안을 생성한다. |
| REQ-SCHEDULE-004 | POST | `/groups/{groupId}/schedule/proposals/{proposalId}/approve` | 모임장 | 일정 제안을 승인한다. |
| REQ-SCHEDULE-005 | POST | `/groups/{groupId}/schedule/proposals/{proposalId}/reject` | 모임장 | 일정 제안을 거절한다. |

### 4.7 알림 및 외부 데이터 작업

### 기능 규칙

- 사용자는 자신의 알림만 조회·변경할 수 있다.
- 알림은 유형, 축제/그룹 참조, 심각도, 제목, 메시지, 읽음 상태, 답변, 생성·답변 시각을 가진다.
- 알림 상태는 읽음 처리 또는 답변 처리로 변경한다.
- 답변 값은 `continue`, `find_alternative`, `dismiss` 중 하나다.
- 위험·변경 알림에 대해 대체 축제 목록을 조회할 수 있다.
- 외부 동기화 작업은 `jobId`와 상태를 반환하며 작업 상태를 조회할 수 있어야 한다.

### API

| ID | Method | Path | 인증 | 요구사항 |
|---|---|---|---|---|
| REQ-ALERT-001 | GET | `/alerts` | 데모 사용자 | 본인 알림을 상태·유형·페이지 기준으로 조회한다. |
| REQ-ALERT-002 | PATCH | `/alerts/{alertId}/read` | 알림 소유자 | 알림을 읽음 처리한다. |
| REQ-ALERT-003 | POST | `/alerts/{alertId}/answer` | 알림 소유자 | 알림에 행동을 답변한다. |
| REQ-ALERT-004 | GET | `/alerts/{alertId}/alternatives` | 알림 소유자 | 알림 축제의 대체 축제를 조회한다. |
| REQ-ALERT-005 | GET | `/alerts/jobs/{jobId}` | 공개 | 외부 동기화 작업 상태를 조회한다. |
| REQ-ALERT-006 | POST | `/admin/weather/sync` | 개발 관리자 | 날씨 동기화 작업을 생성한다. |
| REQ-ALERT-007 | POST | `/admin/festival-notices/sync` | 개발 관리자 | 축제 공지 동기화 작업을 생성한다. |

## 5. 데이터 요구사항

### 5.1 핵심 엔터티

| 엔터티 | 주요 속성 | 관계 |
|---|---|---|
| User | id, displayName, avatarUrl, status | Profile·Consent·GroupMember·Message·Alert와 연결 |
| UserProfile | interests, budgetManwon, travelStyle, mbti, preferredPartySize, availableFrom, defaultJoinMode | User 1:1 |
| NotificationConsent | push, email, riskAlert | User 1:1 |
| Festival | 기간, 지역, 카테고리, 태그, 장소, riskStatus | Group·Alert와 연결 |
| FestivalOperatingHours | date, open, close, note | Festival 1:N |
| Group | title, postBody, capacity, memberCount, status, version | Festival·User와 연결 |
| GroupMember | userId, role, joinedAt, leftAt | Group·User N:M |
| GroupJoinRequest | message, status, reason, decidedBy, decidedAt | Group·User와 연결 |
| GroupComment | author, text, deletedAt | Group·User와 연결 |
| GroupMessage | sender, type, text, clientMessageId, createdAt | Group·User와 연결 |
| GroupSchedule | items, version, validationStatus, conflict | Group 1:1 |
| ScheduleProposal | baseVersion, items, strategy, status | Group·User와 연결 |
| MatchingRun | conditions, topK, status, groupId | User·Festival와 연결 |
| MatchingCandidate | rank, score, parts, reasons | MatchingRun·User와 연결 |
| Alert | type, severity, status, choice, eventKey | User·Festival·Group와 연결 |
| ExternalSyncRun | kind, status, accepted, rejected, rejections | 외부 작업 추적 |

### 5.2 데이터 무결성

- 축제 종료일은 시작일보다 빠를 수 없다.
- 모임 정원은 2~8명이며 멤버 수보다 작을 수 없다.
- 활성 멤버의 그룹 중복 참여 정책은 DB 스키마와 제품 정책에서 명확히 정의해야 한다.
- 참여 승인·즉시 참여는 행 잠금과 트랜잭션으로 정원 초과를 방지해야 한다.
- 그룹·일정 변경은 `version`을 증가시켜 오래된 클라이언트의 갱신을 거부해야 한다.
- 메시지 중복 방지를 위해 `clientMessageId`의 유니크 범위를 그룹·발신자 단위로 유지해야 한다.
- 삭제 가능한 댓글은 물리 삭제 대신 `deleted_at`을 사용한다.

## 6. 비기능 요구사항

### 6.1 성능·확장성

- REQ-NFR-001 **[구현됨]** DB 접근은 비동기 connection pool을 사용한다.
- REQ-NFR-002 **[구현됨]** pool 크기는 `DATABASE_POOL_MIN_SIZE`, `DATABASE_POOL_MAX_SIZE`로 설정한다.
- REQ-NFR-003 **[보완 필요]** 축제·모임 목록은 현재 전체 조회 후 애플리케이션에서 페이지를 자르므로, 운영 규모에서는 DB `LIMIT/OFFSET` 또는 cursor 페이지네이션으로 변경해야 한다.
- REQ-NFR-004 **[보완 필요]** 메시지·WebSocket 방송을 다중 인스턴스에서 지원하려면 Redis 또는 동등한 pub/sub 계층을 사용해야 한다.

### 6.2 가용성·운영

- REQ-NFR-005 **[구현됨]** `/health`는 애플리케이션 상태를 반환한다.
- REQ-NFR-006 **[구현됨]** `/health/db`는 DB 연결 및 필수 테이블 존재 여부를 반환한다.
- REQ-NFR-007 **[구현됨]** `DATABASE_REQUIRED=true`이면 DB 연결 실패 또는 핵심 스키마 누락 시 시작을 실패시킨다.
- REQ-NFR-008 **[보완 필요]** 외부 동기화 작업은 실제 worker, 재시도, timeout, 실패 원인, 중복 실행 방지 정책을 가져야 한다.
- REQ-NFR-009 **[보완 필요]** 구조화 로그, 감사 로그, 지표, 알림을 운영 환경에 추가해야 한다.

### 6.3 보안

- REQ-NFR-010 **[구현됨]** CORS 허용 origin은 설정으로 관리한다.
- REQ-NFR-011 **[구현됨]** 데모 사용자 ID 헤더를 제거하고 Supabase Auth JWT·RLS를 적용한다.
- REQ-NFR-012 **[보완 필요]** 관리자 API에 역할 기반 접근 제어, rate limit, 감사 로그를 추가해야 한다.
- REQ-NFR-013 **[보완 필요]** 채팅 메시지에 대한 콘텐츠 정제, 욕설·개인정보·악성 링크 정책을 추가해야 한다.
- REQ-NFR-014 **[보완 필요]** 요청 크기 제한, WebSocket 연결 수 제한, 사용자별 메시지 rate limit을 적용해야 한다.

### 6.4 테스트·품질

- REQ-NFR-015 **[보완 필요]** 현재 저장소에서 자동화 테스트 디렉터리·테스트 파일이 확인되지 않으므로, 단위·통합·계약·동시성 테스트를 추가해야 한다.
- REQ-NFR-016 **[보완 필요]** OpenAPI 스냅샷과 프론트 API client 계약 테스트를 운영해야 한다.
- REQ-NFR-017 **[보완 필요]** 정원 경쟁, 중복 메시지, 버전 충돌, 일정 승인 경쟁, 권한 우회 시나리오를 필수 회귀 테스트로 지정해야 한다.

## 7. 운영 설정 요구사항

| 설정 | 기본값 | 설명 |
|---|---|---|
| `APP_NAME` | `FestaMate API` | 애플리케이션 이름 |
| `APP_ENV` | `development` | 실행 환경 및 관리자 API 허용 여부 |
| `API_PREFIX` | `/api/v1` | API 기본 경로 |
| `CORS_ORIGINS` | localhost 5173 계열 | 허용 프론트엔드 origin 목록 |
| `DATABASE_URL` | 없음 | PostgreSQL/Supabase 연결 문자열 |
| `DATABASE_REQUIRED` | `false` | DB 필수 여부 |
| `DATABASE_POOL_MIN_SIZE` | `1` | connection pool 최소 크기 |
| `DATABASE_POOL_MAX_SIZE` | `5` | connection pool 최대 크기 |

## 8. 구현 현황 및 주요 차이

### 8.1 현재 코드에서 확인된 구현

- 7개 기능 영역의 라우터·스키마·Repository가 분리되어 있다.
- 성공·오류 envelope와 request ID가 공통 처리된다.
- PostgreSQL Repository가 사용자·축제·모임·댓글·채팅·일정·알림·매칭을 조회·변경한다.
- 모임 참여 승인과 일정 제안 승인은 DB 트랜잭션과 버전 검사를 사용한다.
- WebSocket 채팅과 REST 이벤트 조회가 제공된다.
- DB 연결 상태 및 필수 테이블 점검 API가 제공된다.

### 8.2 즉시 확인이 필요한 차이·리스크

1. `app/core/store.py`에는 데모 인메모리 데이터와 저장소가 있으나, 현재 라우터는 `get_repository()`를 통해 `SupabaseRepository`만 사용한다. 따라서 `DATABASE_URL`이 없을 때 기능 API가 자동으로 인메모리 모드로 전환된다고 보기 어렵다. README 및 `docs/api-db-review.md`의 인메모리 fallback 설명과 현재 코드의 동작을 일치시켜야 한다.
2. `DATABASE_URL`이 설정되지 않았거나 필수 테이블이 없으면 Repository 호출 시 기능 API가 런타임 오류를 낼 수 있다. 애플리케이션 시작 시 명확한 degraded mode를 선택하거나 DB를 필수화해야 한다.
3. 관리자 API의 JWT 역할 클레임과 `is_admin()` RLS 정책은 Supabase Auth app metadata 설정과 함께 운영해야 한다.
4. 동기화 API는 작업을 생성하지만 외부 수집·worker·비동기 상태 갱신은 구현 범위 밖이다.
5. 매칭은 규칙 기반 점수 계산이며, README에 언급된 OpenAI/LangGraph 연동은 현재 코드에 없다.
6. WebSocket 연결 상태가 프로세스 로컬이며, 서버 수평 확장 시 메시지 방송이 분리될 수 있다.
7. 목록 페이지네이션 일부는 전체 결과를 읽은 뒤 메모리에서 자르므로 데이터 증가 시 성능 저하 가능성이 있다.

## 9. 우선순위별 후속 작업

### P0: 운영 전 필수

- Supabase Auth JWT 및 RLS 기반 인증으로 전환
- 관리자 역할 검증 추가
- DB 미설정 시 동작 모드 확정: 실제 인메모리 fallback 연결 또는 `DATABASE_REQUIRED=true` 강제
- 핵심 트랜잭션·권한·정원 경쟁 테스트 작성
- 외부 동기화 job worker 및 실패·재시도 정책 구현

### P1: 서비스 안정화

- 목록 DB 페이지네이션·인덱스 최적화
- Redis 기반 WebSocket pub/sub
- idempotency key, rate limit, 감사 로그, 구조화 로깅
- 채팅 콘텐츠 정제 및 운영 모니터링

### P2: 기능 고도화

- OpenAI/LangGraph 기반 자연어 매칭·일정 제안
- 알림 발송 채널(push/email) worker
- 모임장 양도·종료, 그룹 상태 관리 API
- API/DB 스키마와 OpenAPI 자동 계약 검증

## 10. 완료 판단 기준

다음 조건을 만족하면 본 명세서의 MVP 백엔드 요구사항이 충족된 것으로 판단한다.

- 모든 공개 API가 문서화된 요청·응답 envelope와 상태 코드를 준수한다.
- 인증이 필요한 모든 API가 사용자·모임장·멤버·알림 소유권을 검증한다.
- 축제 검색, 매칭, 모임 생명주기, 채팅, 일정 조율, 알림 기능이 DB에서 일관되게 동작한다.
- 정원 초과·중복 신청·중복 메시지·버전 충돌을 동시 요청에서도 방지한다.
- 외부 동기화 작업의 생성·상태 조회·실패 처리가 운영 가능한 수준으로 구현된다.
- 운영 환경에서 데모 인증과 개발 전용 관리자 경로가 제거 또는 보호된다.
- 핵심 도메인 및 오류 시나리오에 대한 자동화 테스트와 OpenAPI 계약 검증이 통과한다.

