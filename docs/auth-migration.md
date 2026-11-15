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
