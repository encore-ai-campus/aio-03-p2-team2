# FestaMate Frontend

FestaMate V3 HTML의 디자인과 기능을 React로 옮긴 프론트엔드 초기 프로젝트입니다. 백엔드 레포는 `aio-03-p2-2team-Backend`입니다.

## 기술 스택

React 19, Vite 7, JavaScript, React Router 7, npm을 사용합니다. Node.js 22.12 이상이 필요합니다.

## 실행

이 레포의 루트에서 실행합니다.

```powershell
npm install
npm run dev
```

개발 주소는 `http://127.0.0.1:5173`입니다.

```powershell
npm test         # 상태·API 연결·화면 회귀 테스트 및 테스트 전용 규칙 검증
npm run build    # dist/ 생성
npm run preview  # 빌드 결과 미리보기
```

`index.html`은 Vite 진입 파일입니다. `src/main.jsx`가 React 앱을 연결하고, 실제 화면은 `src`의 컴포넌트가 렌더링합니다.

## 폴더 구조

```text
src/
├── main.jsx
├── app/
│   ├── App.jsx               # 화면 경로
│   ├── AppStateProvider.jsx  # 화면 상태·폼·localStorage·화면 이동
│   └── appState.js          # UI 기본값·저장 설정 복원·필터와 캘린더 액션
├── features/
│   ├── auth/
│   ├── festivals/
│   ├── matching/
│   ├── groups/
│   ├── chat/
│   ├── schedules/
│   └── alerts/
└── shared/
    ├── components/           # 버튼·카드·모달·레이아웃
    ├── lib/                 # API 클라이언트 등 공통 함수
    └── styles/app.css
tests/fixtures/              # 가상 축제·사용자·모임·규칙 기반 매칭 (테스트 전용)
tests/*.test.js
```

## 현재 구현 범위

- 반응형 스타일, React Router 화면 이동, 비로그인 축제 탐색
- 실제 축제 API 조회·검색·필터·캘린더
- 백엔드 챗봇 매칭·직접 조건 매칭·확인 후 모집글 생성
- 공개 댓글, 참여 신청·승인·거절·즉시 참여·정원 마감
- 참여자 채팅 화면, 메시지 입력, 시스템 공지
- 일정 충돌 검증·대안 생성·모임장 최종 승인
- 실제 날씨 확인·진행 여부 확인·대체 축제 추천, 개발용 악천후 시뮬레이션
- 필터·매칭 입력값의 localStorage 저장·복원

화면은 실제 백엔드 API를 사용합니다. 서버 오류나 빈 DB를 가상 축제·모임·추천으로 대체하지 않습니다. `?demo=1`과 `VITE_DEMO_MODE`로 사용자 화면을 가상 데이터로 바꾸는 기능은 제거했습니다. 테스트용 가상 데이터와 규칙은 `tests/fixtures`에만 유지합니다.

UI 저장 키는 `festamate_ui_v1`입니다. 이전 저장소에서는 필터와 매칭 입력값만 가져오며, 데모 축제 선택·모임·대화·추천 점수는 가져오지 않습니다. localhost/127.0.0.1 또는 포트가 다르면 저장 공간도 달라집니다. DB 데이터와 인증 세션은 이 UI 저장소에 포함되지 않습니다.

## 팀 개발과 문서 분담

화면은 각 `features/<기능>/pages`, 컴포넌트는 `components`에서 개발합니다. 공통 UI는 `shared/components`에 둡니다. API 호출은 기능별 `api`에서 관리하며, 화면 상태에 서버 엔티티의 가상 기본값을 추가하지 않습니다.

이 레포에는 **화면 구조·프론트엔드 실행법·UI 개발 문서**를 둡니다. 백엔드 실행·환경 변수·API 문서는 백엔드 레포에서, 전체 기획·역할 분담·일정은 팀 공용 문서에서 관리합니다. 실제 API가 추가되면 백엔드 `/docs`의 계약을 기준으로 연동합니다.

Rollup/esbuild는 Windows 네이티브 실행 정책을 고려해 공식 WASM 패키지의 npm alias/override를 사용합니다. `node_modules/`, `dist/`, 실제 `.env`는 Git에 포함하지 않습니다. 배포 설정은 아직 없습니다.
