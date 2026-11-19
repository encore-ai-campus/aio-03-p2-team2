# 페스로움(Fesroam) 에이전트 시험 결과 보고서 (v0.2)

> 근거: [`docs/agent-evaluation.json`](agent-evaluation.json)(측정 2026-11-19 04:09 UTC, 제출 저장소 9b46964 코드로 재실행) · `backend/scripts/evaluate_agent.py` · 실행 기록 [`docs/runs/`](runs/)
> 재현 확인: 11/13 측정본(`backend/docs/agent-evaluation.json`, 과거 기록)과 4개 지표가 동일하게 재현됨
> 표기: **미측정** = 아직 측정하지 않은 항목

## 1. 시험 구분
| 구분 | 방식 | 모델·외부 API | 이 보고서에서의 용도 |
|---|---|---|---|
| A. 통제 실험(오류 주입) | 같은 입력 6개 상황을 성찰 OFF/ON으로 각 1회 실행 | 규칙 모델(rules), 데모 저장소, 인메모리 체크포인터 | 성찰(자가 수정) 효과 비교 — **실제 LLM 성능 수치 아님** |
| B. 실제 연동 실행 | 배포/로컬 서버에서 프론트로 실행 → `GET /agents/runs/{id}` 기록 | OpenAI·Open-Meteo·Supabase | 대표 요청·대표 성찰 실행 기록(5장) |
| C. 자동 테스트 | `pytest`, `npm test` | 모의 응답 | 회귀 확인(6장) |

## 2. 통제 실험 조건 (A)
- 실행 명령: `uv run python -m scripts.evaluate_agent --output data/agent-evaluation.json` (backend 폴더에서). 제출본은 그 결과를 `docs/agent-evaluation.json`으로 복사함
- API 키·DB 없이 실행됨(규칙 모델·데모 저장소·임시 저장소) → 누구나 같은 명령으로 재현 가능
- 공통 조건: 요청 "오후 2시 이후 일정 생성", start_time 14:00, 데모 축제 `fst_demo_music`, 모임 정원 4
- 고정값: `AGENT_MAX_ITERATIONS=2`, `AGENT_TOOL_RETRIES=1`, 같은 검증기·도구 정책
- Before = 성찰 OFF: 오류를 감지하면 바로 중단(reflect가 항상 stop) / After = 성찰 ON: 오류 코드별 수정 전략 적용
- **같은 코드에서 성찰 OFF/ON만 바꾼 비교**이며, 특정 PR 적용 전후 비교가 아님
- 오류 주입: 첫 후보(iteration 0)에만 주입, 재생성 시 정상 후보 반환 → 개선 폭은 **수정 루프의 작동 여부**를 보여줄 뿐 모델의 수정 능력을 뜻하지 않음

## 3. 상황별 결과 (성찰 OFF/ON)
JSON의 case 이름: 1 `normal` · 2 `too_early` · 3 `wrong_date` · 4 `overlap` · 5 `transient` · 6 `outage`

| # | 상황 | 입력(주입 오류) | 기대 결과 | Before 실제 | After 실제 | After 노드 흐름(요약) |
|---|---|---|---|---|---|---|
| 1 | 정상 | 오류 없음 | 승인 대기 도달 | ✅ waiting_approval | ✅ waiting_approval | 도구 3개 → 생성 → 검증 통과 → save_proposal |
| 2 | 시작 시간 위반 | 첫 일정 00:00 | TIME_CONFLICT 감지 → 재생성 → 승인 대기 | ❌ failed (stop) | ✅ waiting_approval, 재생성 1회 | validate(TIME_CONFLICT) → reflect(regenerate) → 생성 → 통과 |
| 3 | 날짜 위반 | 첫 일정 2000-01-01 | DATE_MISMATCH 감지 → 재생성 | ❌ failed | ✅ waiting_approval, 재생성 1회 | validate(DATE_MISMATCH) → regenerate → 통과 |
| 4 | 일정 겹침 | 두 항목 같은 시각 | TIMELINE_ORDER 감지 → 재생성 | ❌ failed | ✅ waiting_approval, 재생성 1회 | validate(TIMELINE_ORDER) → regenerate → 통과 |
| 5 | 일시적 통신 실패 | 날씨 API 처음 2회 실패 | 통신 재시도 소진 후 refresh_tools로 재조회 → 성공 | ❌ failed (재시도 1회 후 stop) | ✅ waiting_approval, 통신 재시도 1회 | execute(TOOL_NETWORK_ERROR) → reflect(refresh_tools) → 재조회 성공 → 통과 |
| 6 | 지속 통신 실패 | 날씨 API 계속 실패 | 한도 도달 후 실패 종료(임의 값 대체 금지) | ❌ failed | ❌ failed (의도된 결과) | refresh_tools ×2 → 판단 한도 도달 → stop → finalize |

> 6번은 After에서도 실패가 **정답**입니다. 날씨 없이 일정을 확정하지 않는 것이 설계 의도입니다.

## 4. 지표
| 지표 | 산정 기준 | Before (성찰 OFF) | After (성찰 ON) |
|---|---|---|---|
| 태스크 완료율 | 검증된 초안으로 **승인 대기**(`waiting_approval`) 도달 사례 / 6 | 16.7% (1/6) | **83.3% (5/6)** |
| 도구 선택 정확도 | 도구를 요청한 모든 선택 라운드에서 정답 3개(get_festival, get_availability, get_weather)와 일치한 사례 / 6 | 100% | 100% |
| 응답 일관성 점수(조건 검증 통과율) | 최종 후보가 독립 검증(`validate_plan`)을 모두 통과한 사례 / 6 | 16.7% | **83.3%** |
| 평균 판단 재실행 횟수 | 첫 후보 이후 추가 generate_candidate 실행 수 평균 | 0.00 | 0.50 |

해석
- 완료 기준은 "승인 가능한 검증된 초안"이며, 자동 일정 확정이 아닙니다(확정은 사람 승인 후 재검증).
- 도구 선택은 rules 모드에서 서버 정책이 정하므로 전후 차이가 없습니다. OpenAI Function Calling 모드의 도구 선택 정확도는 **미측정**입니다.
- 일관성 점수는 조건·형식 검증 통과율이며, 같은 입력 반복 실행의 통계적 재현성 평가가 아닙니다(반복 실행 시험 **미측정**).
- 통신 재시도(`toolRetries`)와 판단 재실행(`reasoningReruns`)은 따로 기록합니다. 6번은 통신 재시도 3회, 판단 재실행 0회입니다.

## 5. 실행 기록
| 구분 | 기록 | 조건 | 노드 순서(trace) | 도구 호출 | 결과 |
|---|---|---|---|---|---|
| 대표 요청(매칭) · **실제 연동(B)** | [`runs/matching-run.json`](runs/matching-run.json) · `run_a988b28c129a403db61531f1ee93d677` (2026-11-19 04:04 UTC) | 배포 서버 · `modelProvider=openai` · `repositoryMode=database` · date 2026-11-22, start_time 15:00 | load_context → parse_request → plan_tools → choose_tools R1 → execute_tools → choose_tools R2 → execute_tools → choose_tools R3(요청 없음·필수 충족) → generate_candidate → validate_candidate(오류 0) → finalize (11단계) | R1 `get_festival`(festival_repository) · R2 `get_candidates`(user_profiles) · 모두 attempt 1, `selectedBy=openai_function_calling` | completed · 동행 5명 추천 · iteration 0 |
| 대표 성찰(일정, 시간 충돌 → 재생성) · **통제 실험(A) 2번** | [`runs/repair-time-conflict.json`](runs/repair-time-conflict.json) (`agent-evaluation.json` after `too_early`) | rules · 데모 저장소 · 첫 후보에 00:00 시작 주입 | … choose_tools R1 → execute_tools → choose_tools R2 → generate_candidate(it 0) → **validate_candidate: TIME_CONFLICT** → **reflect_and_repair: regenerate** → generate_candidate(it 1) → **validate_candidate: 오류 0** → save_proposal | R1 get_festival·get_availability·get_weather (각 attempt 1, ok) | waiting_approval · 판단 재실행 1회 · 통신 재시도 0회 |

- 매칭 기록에서 `get_weather`를 호출하지 않은 것은 정상입니다. matching 의도는 `avoid_rain` 조건이 있을 때만 날씨가 필수입니다(설계서 4장).
- 모델이 도구를 한 번에 하나씩 고르면, 서버가 `missingRequired`(R1: get_festival·get_candidates → R2: get_candidates → R3: 없음)로 남은 필수 도구를 알려 줍니다. 그 결과 2라운드 만에 필수 도구를 모두 채웠습니다.
- 성찰 사례는 실제 OpenAI 응답에서 시간 충돌이 재현되지 않아 통제 실험 기록으로 제시합니다. 실제 API 결과와 구분합니다.
- `runs/matching-run.json`은 `GET /agents/runs/{id}` 응답의 **발췌·비식별 처리본**입니다. runId, 상태, 조건, trace, toolCalls, sources는 원문 그대로이고, 추천 사용자 이름·ID가 들어 있는 candidate·candidateHistory·sessionId는 제외해 `candidateSummary`(인원 수)로 대체했습니다.
- `runs/repair-time-conflict.json`은 `agent-evaluation.json`의 after `too_early` 사례 원문 그대로입니다.

> 구분: 비 예보 시 "그래도 진행할까요?"는 `confirm_weather`에서 **사용자 결정을 기다리는 흐름(HITL)**이며 자가 성찰이 아닙니다. 자가 성찰 사례는 검증 노드가 오류를 감지하고 수정 전략을 골라 재생성·재검증한 기록으로 제시합니다.

## 6. 자동 테스트 (C)
제출 레포에서 실행한 결과입니다.
| 대상 | 명령 | 결과 |
|---|---|---|
| Backend | `uv run python -m pytest tests -q` | 247개 통과 · 7개 스킵 |
| Frontend | `npm test` | 54개 통과 |

## 7. 수정 이력 (시험 결과에 영향을 준 변경)
| PR | 내용 | 이유 | 효과 |
|---|---|---|---|
| BE #23 | AI 조건 추출 정규화 | 모델이 추출한 조건 형식이 흔들려 검증 실패 | 조건 스키마 일관화 |
| BE #24 | 자가 성찰 우선 + 대체 축제 운영시간 필터 | 기본 일정으로 바로 대체하면 성찰 루프가 작동하지 않음 → 성찰 1회 후에만 기본 일정 대체 | 시간 충돌 시 성찰(재생성)이 먼저 실행되도록 순서 보장. ※ 4장 16.7%→83.3%는 이 PR의 전후가 아니라 **같은 코드의 성찰 OFF/ON 비교** |
| BE #18·#19 | 매칭 기준선 80→60, 후보 조회 N+1 제거 | 관심사 0점 문제(실DB 110명 진단), 쿼리 111회 | 매칭 응답 54초 → 3.6초 |

## 8. 미측정·한계
- 통제 실험(A)은 제출 기준 코드로 재실행해 수치 재현을 확인함(규칙 모드 한정)
- 관찰된 불일치: 매칭 실제 기록에서 choose_tools R3의 모델 안내 문구(`summary`)가 "11/28"이라고 적었지만, 추출된 조건은 `date=2026-11-22`였음. 추천 결과는 도구 결과와 조건으로 만들어지므로 영향이 없지만, 모델의 자유 문장은 검증 대상이 아님 → 자유 문장도 조건과 대조하는 검증은 향후 과제
- OpenAI 모드의 도구 선택 정확도, 반복 실행 일관성, 토큰·비용: **미측정**
- 실제 LLM의 할루시네이션 품질: 검증기(`validate_plan`)로 도구 결과에 없는 후보를 차단하는 구조만 확인
- LLM 기반 대화 요약 미구현(최근 메시지 6개 + 구조화 요약)
- 추론 깊이 조정(BE PR #25)은 제출본에 포함하지 않음(revert 결정). 매칭 응답 시간 단축 수치는 제출본 기준이 아니므로 기재하지 않음
- 이전 시험 기록은 `backend/docs/agent-test-report.md`에 과거 기록으로 보존
