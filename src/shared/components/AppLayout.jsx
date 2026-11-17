import { NavLink, Outlet } from "react-router-dom";
import { useDemo, paths } from "../../app/DemoProvider.jsx";
import { useAuth } from "../../features/auth/AuthProvider.jsx";
import { Button } from "./Primitives.jsx";

// v4.3 · 모바일 하단 탭바 메뉴
const TABS = [
  ["discover", "🎪", "탐색"],
  ["match", "💞", "매칭"],
  ["community", "👥", "커뮤니티"],
  ["room", "💬", "채팅"],
  ["schedule", "🗓️", "일정"],
];

export default function AppLayout() {
  const { state, NAV, countPending, dispatch } = useDemo();
  const { user, signOut } = useAuth();
  const bell = countPending() + (state.weather?.type && !state.weather?.choice ? 1 : 0);

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
            {NAV.map(([id, emoji, label]) => (
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
          </div>
        </header>
        <main className="main">
          <Outlet />
        </main>
        <footer className="footer">
          FESTA MATE V4.4 · 2026 Festival Discovery & AI Matching
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
