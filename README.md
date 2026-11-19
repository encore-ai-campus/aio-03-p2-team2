# 페스로움 (Fesroam)

> 가고 싶은 축제에 함께 갈 사람을 찾고, 날씨까지 확인해 모임 일정을 짜 주는 AI 에이전트 서비스
> AIO 3기 단위 프로젝트 2 · 팀 삼각김박

- 배포 주소(페스로움 운영 화면): https://aio-03-p2-2team-frontend.onrender.com/
- 백엔드 API 문서: https://aio-03-p2-2team-backend.onrender.com/docs
- 폴더별 상세 실행 안내: [프런트엔드](frontend/README.md) · [백엔드](backend/README.md) (설치, DB 설정, 테스트 절차)
- 제출 저장소: https://github.com/encore-ai-campus/aio-03-p2-team2 (frontend·backend 커밋 이력 포함)
- 원본 저장소(PR 기록): [Frontend](https://github.com/joel10195/aio-03-p2-2team-Frontend) / [Backend](https://github.com/joel10195/aio-03-p2-2team-Backend)

## 제출 산출물
| 산출물 | 위치 |
|---|---|
| 에이전트 아키텍처 설계서 | [docs/agent-architecture.md](docs/agent-architecture.md) |
| 에이전트 시험 결과 보고서 | [docs/agent-test-report.md](docs/agent-test-report.md) |
| 성찰 OFF/ON 평가 결과(11/19 재실행) | [docs/agent-evaluation.json](docs/agent-evaluation.json) |
| 실행 기록 원본 | [docs/runs/](docs/runs/) (실제 매칭 1건 · 성찰 사례 1건) |
| 발표 자료 | ⚠️ |

이전 시험 기록은 `backend/docs/agent-test-report.md`에 과거 기록으로 보존합니다. 최종본은 `docs/agent-test-report.md`입니다.

## 주요 기능
- **AI 동행 매칭**: 챗봇으로 날짜·시간·취향을 받아 함께 갈 동행 추천 → 모집글 작성
- **AI 모임 일정**: 참여자 가능 시간·운영시간·날씨를 조회해 일정 초안 생성 → 검증 실패 시 자가 성찰로 재생성 → 모임장 승인 후 재검증·확정
- **날씨 위험 대응**: 비 예보 시 진행 여부를 사용자에게 확인 → 대체 축제 추천
- 축제 탐색(TourAPI), 커뮤니티 모집글, 모임 채팅

## 저장소 구조
```
frontend/   React(Vite) 웹
backend/    FastAPI + LangGraph 에이전트
docs/       설계서·시험 보고서·실행 기록
```

## 실행 방법
요구 사항: Python 3.12 이상(`.python-version` 3.12), uv, Node.js

### Backend
```bash
cd backend
cp .env.example .env      # 값 입력 (아래 설정 참고)
# 최초 1회: Supabase SQL Editor에서 docs/sql/001_agent_postgres.sql 적용 (agent_storage 스키마, 없으면 서버가 시작되지 않음)
uv sync
uv run python -m app --reload --host 127.0.0.1 --port 8000
```
API 문서: http://127.0.0.1:8000/docs

### Frontend
```bash
cd frontend
cp .env.example .env      # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL
npm install
npm run dev               # vite --host 127.0.0.1
```

### 테스트·평가
```bash
cd backend && uv run python -m pytest tests -q        # 247 passed, 7 skipped
cd backend && uv run python -m scripts.evaluate_agent --output data/agent-evaluation.json
cd frontend && npm test                                # 54 passed
```

## 주요 설정 (.env, 값은 Git에 올리지 않음)
| 변수 | 설명 |
|---|---|
| `DATABASE_URL` | Supabase PostgreSQL 연결 문자열 |
| `SUPABASE_URL` | Supabase 프로젝트 주소(JWT는 JWKS로 검증) |
| `SUPABASE_KEY` | Supabase 공개 클라이언트 키(회원가입·로그인 API용, JWT 검증에는 쓰지 않음) |
| `SUPABASE_JWT_SECRET` | (선택) 레거시 HS256 검증용 |
| `AGENT_MODEL_PROVIDER` | `rules`(LLM 없이 규칙) / `openai` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | openai 모드에서 필요 |
| `AGENT_WEATHER_PROVIDER` | `demo`(코드 기본값) / `openmeteo`(실제 예보, `.env.example` 값) |
| `TOUR_API_SERVICE_KEY` | TourAPI 축제 조회·동기화 |
| `AGENT_MAX_ITERATIONS`(3) · `AGENT_TOOL_RETRIES`(2) · `AGENT_MAX_TOOL_ROUNDS`(8) · `AGENT_MAX_TOOL_CALLS`(12) | 에이전트 반복·재시도 한도 |
| Frontend `VITE_API_BASE_URL` | 백엔드 주소 |
| Frontend `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase 공개 키(비밀값 아님) |

전체 변수 이름은 `backend/.env.example`, `frontend/.env.example` 참고.

## 사용 흐름
1. 회원가입 → 온보딩(성별·나이대·관심사)
2. 축제 탐색에서 축제 선택
3. AI 동행 매칭: 챗봇에 날짜·시간 입력 → 추천 동행 선택 → 모집글 만들기
4. 모임 참여 승인 → 모임장이 AI 일정 생성 → 초안 확인 후 승인
5. 비 예보 알림 → 기존 축제 유지 또는 대체 축제 추천

## 팀원별 역할·기여
| 이름 (GitHub) | 역할 | 주요 기여 |
|---|---|---|
| 김민철 (joel10195) | PM · 저장소 관리 | 팀원 PR 통합, 날짜 저장, TourAPI 운영시간·날씨 도구 연동, 비로그인 홈·모집글 초안 유지 |
| 박은지 (ej-park-dev) | 프론트엔드 | 전 화면 구현·실서버 API 연결(인증·매칭·에이전트·채팅·날씨 알림)·디자인 개편·컴포넌트 분리, 온보딩 완료 API, 매칭 후보 조회 N+1 제거(54초→3.6초) |
| 김수용 (power9869) | 백엔드 · 에이전트 품질 | 매칭 점수 개편, AI 조건 추출 정규화, 자가 성찰 우선 적용(시간 충돌 시 재생성 먼저), DB 조회 최적화 |
| 김재현 (94JayKim) | 백엔드 구조 · DB | router/service/repository 계층 구조, Swagger 인증, TourAPI 조회·동기화, 정원·승인 동시성 처리 |

상세 작업 이력: 이 저장소의 커밋 기록 참고 (frontend·backend 원본 커밋·PR 병합 이력 포함)
