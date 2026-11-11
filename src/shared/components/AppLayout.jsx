import { NavLink, Outlet } from "react-router-dom";
import { useDemo, paths } from "../../app/DemoProvider.jsx";
import DemoActorSelect from "../../features/auth/components/DemoActorSelect.jsx";
import { Button } from "./Primitives.jsx";
export default function AppLayout() {
  const { state, NAV, countPending, actorProps, dispatch } = useDemo();
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
                  <span
                    className="pill red"
                    style={{
                      marginLeft: "auto",
                      padding: "3px 7px",
                    }}
                  >
                    {countPending()}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="sidefoot">
          <b>🧪 2026.11.11 · 3차 UI</b>
          <p>
            모임 생성·참여·승인·채팅·일정 조정은 실제로 체험 가능한 로컬
            시뮬레이션입니다.
          </p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            FESTA MATE / <b>{NAV.find((row) => row[0] === state.page)?.[2]}</b>
          </div>
          <div className="top-right">
            <span className="demo-mark">가상 데이터 · 프론트엔드 데모</span>
            <DemoActorSelect {...actorProps} />
            <Button
              className="toplink"
              title="알림 센터"
              aria-label="알림 센터"
              onClick={() => dispatch("nav:alerts")}
            >
              🔔
            </Button>
            <Button
              className="btn small"
              title="전체 데모 데이터 초기화"
              onClick={() => dispatch("reset")}
            >
              ↺ 초기화
            </Button>
          </div>
        </header>
        <main className="main">
          <Outlet />
        </main>
        <footer className="footer">
          FESTA MATE V3 · 2026 Festival Discovery & AI Matching · 학습 및 시연용
          예시 데이터
        </footer>
      </div>
    </div>
  );
}
