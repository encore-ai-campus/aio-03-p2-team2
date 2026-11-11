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
npm test         # 핵심 목업 규칙 테스트
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
│   └── DemoProvider.jsx      # 공유 상태·폼·localStorage·액션 연결
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
    ├── data/demoData.js      # 초기 목업 데이터
    ├── lib/demoModel.js      # 로컬 시뮬레이션 규칙
    ├── pages/TeamPage.jsx    # 협업 안내
    └── styles/app.css
tests/demoModel.test.js
```

## 현재 구현 범위

- 기존 7개 메뉴, 반응형 스타일, React Router 화면 이동
- 축제 검색·필터·JSON 가져오기
- 선호 조건·MBTI 선택·규칙 기반 매칭·공개 모임 생성
- 공개 댓글, 참여 신청·승인·거절·즉시 참여·정원 마감
- 참여자 채팅 화면, 메시지 입력, 시스템 공지
- 일정 충돌 검증·대안 생성·모임장 최종 승인
- 강수·취소 알림과 대체 축제 추천 시뮬레이션
- 데모 사용자 전환, localStorage 저장·복원·초기화

**백엔드 API는 아직 연결하지 않았습니다.** 데이터와 동작은 같은 브라우저 안의 목업입니다. 실제 인증, DB CRUD, LLM 호출, LangGraph, WebSocket, 외부 축제·기상 API는 구현하지 않았습니다. 화면의 참여자 제한은 실제 서버 권한 검사를 대신하지 않습니다.

저장 키는 `festamate_v3_261111_demo`입니다. localhost/127.0.0.1 또는 포트가 다르면 저장 공간도 달라집니다. 축제 샘플은 2026년 기준이고 참여 가능 여부는 실행 당일로 판정합니다.

## 팀 개발과 문서 분담

화면은 각 `features/<기능>/pages`, 컴포넌트는 `components`에서 개발합니다. 공통 UI는 `shared/components`에 둡니다. API 계약이 정해지면 필요한 기능에 `api` 파일을 추가하고 목업 동작을 실제 통신으로 교체합니다. 실제 인증 상태, API 로딩·오류 처리, 서버 데이터, 실시간 채팅 연동이 향후 작업입니다.

이 레포에는 **화면 구조·프론트엔드 실행법·UI 개발 문서**를 둡니다. 백엔드 실행·환경 변수·API 문서는 백엔드 레포에서, 전체 기획·역할 분담·일정은 팀 공용 문서에서 관리합니다. 실제 API가 추가되면 백엔드 `/docs`의 계약을 기준으로 연동합니다.

Rollup/esbuild는 Windows 네이티브 실행 정책을 고려해 공식 WASM 패키지의 npm alias/override를 사용합니다. `node_modules/`, `dist/`, 실제 `.env`는 Git에 포함하지 않습니다. 배포 설정은 아직 없습니다.
