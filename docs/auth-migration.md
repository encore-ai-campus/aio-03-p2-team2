# Supabase Auth/RLS 적용 안내

## 요청 헤더

보호된 REST API는 다음 형식의 Supabase access token을 사용합니다.

```http
Authorization: Bearer <access-token>
```

백엔드는 토큰의 `sub`를 `public.users.auth_user_id`와 매핑하고, API 입력값이나 URL의 사용자 ID를 현재 사용자로 사용하지 않습니다. 인증되지 않은 요청은 `401`, 연결된 앱 사용자가 없으면 `403`입니다.

WebSocket은 `Authorization` 헤더를 우선 사용합니다. 브라우저의 native WebSocket에서 헤더를 설정할 수 없는 경우에만 단기 access token을 `access_token` 쿼리 값으로 전달할 수 있습니다. `demoUserId`는 지원하지 않습니다.

## 설정 순서

1. Supabase SQL Editor에서 base schema를 실행합니다.
2. [`db/supabase_auth_rls.sql`](../db/supabase_auth_rls.sql)을 실행합니다.
3. 기존 `public.users` 행에 실제 `auth.users.id`를 `auth_user_id`로 연결합니다.
4. 백엔드에 `SUPABASE_URL`, `SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWT_ISSUER`를 설정합니다.
5. 비대칭 signing key를 사용하는 기본 Supabase 프로젝트는 JWKS를 사용하므로 `SUPABASE_JWT_SECRET`을 비워 둡니다. HS256 레거시 프로젝트에서만 JWT secret을 설정합니다.
6. 관리자 작업은 JWT `app_metadata.role`이 `admin` 또는 `service_role`인 사용자만 호출할 수 있습니다.

DB 연결은 요청의 JWT claims를 PostgreSQL `request.jwt.claims`에 넣고, 인증 요청은 `authenticated`, 공개 요청은 `anon` 역할로 실행합니다. 연결을 풀에 반환할 때 claims와 role을 초기화합니다.

## 프론트엔드 전환

Supabase client의 `getSession()` 또는 `onAuthStateChange()`로 access token을 얻은 뒤, API client의 모든 보호 요청에 `Authorization` 헤더를 추가합니다. 기존 `X-Demo-User-Id` 헤더와 `demoUserId` 쿼리 파라미터는 제거해야 합니다.


## 에이전트 통합

- `/agents/*`와 기존 일정 API 모두 같은 JWT 인증을 사용합니다. 데모 사용자 헤더는 허용하지 않습니다.
- 일정 생성·승인 라우터는 LangGraph를 호출합니다. repository는 검증된 초안·확정 결과 저장만 담당합니다.
- `app/main.py`의 앱 팩토리와 에이전트 시작·종료, PostgreSQL 체크포인터를 유지합니다.
- 별도로 `docs/sql/001_agent_postgres.sql`을 적용해야 합니다. `agent_storage`는 클라이언트가 직접 접근하지 않습니다.
- `db/supabase_auth_rls.sql`은 그룹별 정책의 외부 테이블 참조를 명시하고, 회원가입 시 프로필·알림 설정을 함께 생성합니다. 기존 값은 덮어쓰지 않습니다.
- JWT는 인증 설정, DATABASE_URL은 PostgreSQL 연결 설정입니다. 기존 `.env`는 자동 변경하지 않습니다.

DB 담당자는 인증 SQL의 변경 사항을 검토하고 Supabase에 적용해야 합니다. 기존 테이블 생성 SQL 전체를 재실행하지 않습니다.
