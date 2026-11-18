# 축제 탐색부터 악천후 대체 일정까지

기존 API와 승인 절차는 유지한다. 추가 경로의 접두어는 `/api/v1`이며 Swagger의 `workflow` 태그에서 확인한다. 보호 API에는 로그인한 계정의 access token을 Authorize에 입력한다.

## Swagger 호출 순서

1. `GET /festivals`에서 진행 가능한 축제를 선택한다.
2. 계정 A로 `POST /agents/runs`를 호출한다. 매칭에서 시간이 없으면 `waiting_input`과 “몇 시에 참여하실 건가요?”를 반환한다.

   ```json
   {
     "intent": "matching",
     "message": "이 축제에 같이 갈 동행을 찾아줘",
     "festivalId": "조회한 축제 ID",
     "conditions": {"date": "축제 운영일 YYYY-MM-DD"}
   }
   ```

3. `POST /agents/runs/{runId}/resume`에 직전 `checkpointId`와 답변을 보낸다. `message: "오후 3시부터 가능해"`로 자연어 응답도 가능하다.

   ```json
   {"checkpointId": "직전 응답 값", "answers": {"startTime": "15:00"}}
   ```

4. `completed` 결과의 `candidate.items`를 확인한다. 후보는 규칙 기반 점수이며, 자동 초대하거나 가입시키지 않는다.
5. `POST /workflow/matching/{runId}/group`으로 모집글을 만든다.

   ```json
   {"title": "오후 3시 축제 동행", "postBody": "함께 축제를 즐겨요", "capacity": 4}
   ```

   선택 축제·날짜·시간과 선호 조건을 이어받는다. 가입 방식은 `approval`이다. 같은 매칭 실행으로 재요청하면 같은 모임을 반환한다. 다른 모집글을 만들려면 새 매칭 실행을 사용한다.

6. Authorize를 계정 B의 토큰으로 바꿔 `POST /groups/{groupId}/join-requests`를 호출한다.

   ```json
   {"message": "오후 3시부터 참여 가능합니다"}
   ```

   신청 메시지는 프로필의 가능 시간을 변경하지 않는다. 계정 B의 `/me/profile`에서 `availableFrom`도 정확하게 설정한다.

7. 계정 A로 전환해 `GET /groups/{groupId}/join-requests`를 확인하고 `POST /groups/{groupId}/join-requests/{requestId}/approve`에 현재 모임 `version`을 보낸다.

   ```json
   {"version": 1}
   ```

   응답의 `nextActions`가 참여자 조건으로 일정을 생성하는 경로를 제공한다. 참여 승인과 일정 승인은 별개이며, 참여 승인 결과는 일정 생성 실패 때문에 취소되지 않는다.

8. `POST /workflow/groups/{groupId}/schedule`에 `{}`를 보내면 기존 조건과 현재 참여자 가능 시간을 반영한 초안을 만든다. 필요한 경우 `conditions`를 명시한다.
9. `waiting_approval` 결과를 확인하고 기존 `/agents/runs/{runId}/resume`에 최신 `checkpointId`, `decision: "approve"`를 보내 일정을 확정한다.
10. `POST /workflow/groups/{groupId}/weather-check`로 현재 일정의 날씨를 확인한다. 개발 환경에서 악천후 알림을 재현하려면 다음 본문을 사용한다.

    ```json
    {"simulateRisk": true}
    ```

    실제 예보를 호출하지 않고 시험용 악천후 근거를 생성한다. 알림 제목에 `[테스트]`, 응답과 DB에 `isTest=true`가 기록된다. 운영 환경에서는 모의 요청을 403으로 거부한다. 일반 `demo` 날씨는 실제 위험 알림을 만들지 않는다.

11. `GET /alerts`에서 알림을 확인한다. 현재 참여자 중 `riskAlert` 수신에 동의한 사용자에게만 생성하며, 같은 모임·축제·날짜의 알림은 중복 생성하지 않는다. 테스트와 실제 알림은 별개다.
12. 모임장 A가 `POST /alerts/{alertId}/risk-response`를 호출한다. 알림 없이 직접 실행하려면 `POST /workflow/groups/{groupId}/risk-response`도 사용할 수 있다. 알림 소유권·모임장 권한·현재 축제 일치 여부를 검사한다.
13. `candidate.items`에서 대체 축제를 선택해 `POST /workflow/risk-runs/{runId}/select`를 호출한다.

    ```json
    {"festivalId": "추천된 대체 축제 ID"}
    ```

    DB에서 모임 날짜가 운영 기간에 포함되고 취소되지 않은 축제를 추천한다. 추천된 축제만 선택할 수 있으며, 선택 시 DB의 최신 취소 상태와 상세 운영시간을 확인한다. 날짜 변경은 `conditions.date`로 명시해야 하며 사용자의 우천 회피 조건을 자동 완화하지 않는다.

14. 생성된 실행의 `comparison`과 `candidateHistory`를 확인한다. 기존처럼 최신 체크포인트로 승인하면 축제와 일정이 하나의 DB 트랜잭션으로 반영된다. 거절·취소·검증 실패 시 기존 축제와 일정은 유지한다.

## 비교 응답

- `comparison.before`: 실행 시작 시 기존 일정 스냅샷.
- `comparison.after`: 현재 생성된 후보. 아직 확정되었다는 뜻은 아니다.
- `candidateHistory` / `comparison.attempts`: 검증한 각 후보, 오류 목록, 해당 후보를 만들 때 적용한 수정 전략, iteration.
- `trace`: 조회·검증·성찰·승인 재검증 등 노드 실행 기록.

실제 위반이 발생해야 자가 수정 이력이 여러 개 생긴다. 정상 후보를 일부러 실패시키지는 않는다. 참여자 시간 변경·일정 충돌은 재생성하고, 악천후와 우천 회피 조건이 충돌하면 추가 질문으로 돌아간다.

## 자동 감시 설정

```dotenv
AGENT_WEATHER_PROVIDER=openmeteo
WEATHER_MONITOR_INTERVAL_SECONDS=300
```

서버 실행 중 5분마다 예정일이 향후 15일 이내인 진행 중 모임을 확인한다. 간격 0은 자동 감시를 끈다. 예보 조회 실패는 기록하고 다음 모임을 계속 확인한다. 서버 종료 시 감시 작업을 정리한다. 알림은 DB 내 앱 알림이며 외부 이메일·푸시는 발송하지 않는다.

감시와 수동 확인의 알림 쓰기는 서버 소유 DB 연결에서만 실행한다. HTTP에서는 먼저 JWT와 모임장 권한을 검증하고, 수신자는 서버가 현재 멤버와 수신 동의 테이블로 결정한다. 기존 요청 단위 RLS 처리는 유지한다. 다중 서버에서도 `(user_id,event_key)` 유일 제약으로 중복 알림을 방지한다.

새 테이블이나 스키마 마이그레이션은 없다. 대체 축제 ID는 기존 `schedule_proposals.validation` JSON에 저장하며, 승인 시 취소 여부·운영 날짜·모임/일정 버전을 다시 확인한다.

## 검증

```powershell
.venv/Scripts/python.exe -m pytest tests -q
```

질문·재개, 모집글 조건 전달·재요청, 사용자 격리, 대체 선택·승인·거절·취소·재검증, 수정 전후 이력, 모의 날씨 제한과 감시 종료를 격리 테스트한다. `tests/test_workflow_sql.py`는 `TEST_AGENT_DATABASE_URL`이 있을 때 임시 테이블과 롤백만 사용해 PostgreSQL의 원자적 반영과 알림 SQL을 추가 검증한다. OpenAI·실제 기상 API와 두 실제 계정의 전체 시연은 별도 통합 확인이 필요하다.
