import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useDemo, paths } from "../../app/DemoProvider.jsx";
import { useAuth } from "../../features/auth/AuthProvider.jsx";
import DemoActorSelect from "../../features/auth/components/DemoActorSelect.jsx";
import { Button } from "./Primitives.jsx";

// v4.3 · 모바일 하단 탭바 메뉴
const TABS = [
  ["discover", "🎪", "탐색"],
  ["match", "💞", "매칭"],
  ["community", "👥", "커뮤니티"],
  ["room", "💬", "채팅"],
  ["schedule", "🗓️", "일정"],
];
const ACTOR_LABELS = {
  me: "나 · 모임장",
  haneul: "하늘 · 신청자",
  guest: "새 참가자",
  minji: "민지 · 전주 모임장",
  junho: "준호 · 강릉 모임장",
};

export default function AppLayout() {
  const { state, NAV, countPending, actorProps, dispatch } = useDemo();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const bell = countPending() + (state.weather?.type && !state.weather?.choice ? 1 : 0);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const esc = (e) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  // 데모 메뉴 항목은 실행 후 메뉴를 닫는다
  const menuAction = (action) => () => {
    setMenuOpen(false);
    dispatch(action);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandicon">F</div>
          <div>
            <b>페스타메이트</b>
            <small>FESTA MATE · AI TRAVEL</small>
          </div>
        </div>
        <div>
          <div className="side-caption">FESTIVAL JOURNEY</div>
          <nav className="nav">
            {NAV.filter(([id]) => id !== "team").map(([id, emoji, label]) => (
              <NavLink
                key={id}
                to={paths[id]}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                <span className="ico">{emoji}</span>
                {label}
                {id === "community" && countPending() > 0 && (
                  <span className="pill red" style={{ marginLeft: "auto", padding: "3px 7px" }}>
                    {countPending()}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="sidefoot">
          <b>처음 오셨나요?</b>
          <p>축제 고르기 → AI 동행 매칭 → 모임 참여·채팅 순서로 이용해 보세요.</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <b>{NAV.find((row) => row[0] === state.page)?.[2] || "축제 탐색"}</b>
          </div>
          <div className="top-right">
            <span className="auth-user" title={user?.email}>
              {user?.user_metadata?.display_name || user?.email}
            </span>
            <NavLink to="/profile" className="btn small">
              내 프로필
            </NavLink>
            <Button className="btn small" onClick={signOut}>
              로그아웃
            </Button>
            <Button
              className="toplink bell"
              title="AI 알림"
              aria-label="AI 알림"
              onClick={() => dispatch("nav:alerts")}
            >
              🔔
              <span className="bell-badge" hidden={!bell}>
                {bell}
              </span>
            </Button>
            <div className="demo-ctl" ref={menuRef}>
              <Button
                className="btn small demo-btn"
                aria-haspopup="true"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                🧪 <span>{ACTOR_LABELS[state.actor] || "데모"}</span> ▾
              </Button>
              <div className="demo-menu" hidden={!menuOpen}>
                <div className="demo-menu-head">
                  <b>데모 컨트롤</b>
                  <span>가상 데이터 · 발표 시연용</span>
                </div>
                <label className="demo-label" htmlFor="actor">
                  계정 전환
                </label>
                <DemoActorSelect {...actorProps} />
                <div className="demo-label">시연 시나리오</div>
                <button type="button" onClick={menuAction("demoConflict")}>
                  일정 충돌 시연 (부산 모임 승인)
                </button>
                <button type="button" onClick={menuAction("resetConflict")}>
                  시연 일정 되돌리기
                </button>
                <button type="button" onClick={menuAction("nav:alerts")}>
                  악천후·취소 알림 시연
                </button>
                <div className="demo-label">데이터·문서</div>
                <button type="button" onClick={menuAction("upload")}>
                  2026 축제 JSON 가져오기
                </button>
                <button type="button" onClick={menuAction("nav:team")}>
                  팀 협업 안내
                </button>
                <button type="button" className="danger" onClick={menuAction("reset")}>
                  전체 데이터 초기화
                </button>
                <p>
                  기본 축제 목록은 가상 예시예요. 실제 전체 목록은 공식 축제 API로 수집한 뒤 JSON으로
                  불러오세요. 계정·데이터는 이 브라우저에만 저장돼요.
                </p>
              </div>
            </div>
          </div>
        </header>
        <main className="main">
          <Outlet />
        </main>
        <footer className="footer">
          FESTA MATE V4.4 · 2026 Festival Discovery & AI Matching · 학습 및 시연용 예시 데이터
        </footer>
      </div>
      <nav className="tabbar" aria-label="주요 메뉴">
        {TABS.map(([id, emoji, label]) => (
          <NavLink key={id} to={paths[id]} className={({ isActive }) => (isActive ? "active" : "")}>
            <span>{emoji}</span>
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
