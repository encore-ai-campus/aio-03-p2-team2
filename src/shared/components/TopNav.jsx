// 상단 내비게이션 — 메뉴 4개(축제 탐색 / AI 동행 매칭 / 커뮤니티 ▾ / 내 모임 ▾)
// 드롭다운: 마우스 올림 + 클릭 + 키보드(Esc·포커스 이탈 닫기), 열린 지 0.4초 안의 클릭은 무시
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

export const MENU = [
  { label: "축제 탐색", to: "/festivals" },
  { label: "AI 동행 매칭", to: "/matching" },
  {
    label: "커뮤니티",
    items: [
      { to: "/groups", icon: "ti-message-circle", label: "동행 커뮤니티", desc: "모집글을 보고 참여를 신청해요" },
      { to: "/chat", icon: "ti-messages", label: "모임 채팅방", desc: "참여한 모임과 대화해요" },
    ],
  },
  {
    label: "내 모임",
    items: [
      { to: "/schedules", icon: "ti-calendar-event", label: "일정 확인·조정", desc: "모임 일정과 운영 시간을 맞춰요" },
      { to: "/alerts", icon: "ti-cloud-rain", label: "AI 알림·대안", desc: "비 예보와 대체 축제를 확인해요" },
    ],
  },
];

function Dropdown({ menu, pathname }) {
  const [open, setOpen] = useState(false);
  const openedAt = useRef(0);
  const timer = useRef();
  const wrap = useRef(null);
  const btn = useRef(null);
  const current = menu.items.some((it) => pathname.startsWith(it.to));

  const set = (next) => {
    if (next && !open) openedAt.current = Date.now();
    setOpen(next);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => setOpen(false), [pathname]); // 다른 화면으로 가면 닫기

  return (
    <div
      ref={wrap}
      className={`gnb-mi ${open ? "open" : ""} ${current ? "on" : ""}`}
      onMouseEnter={() => { clearTimeout(timer.current); set(true); }}
      onMouseLeave={() => { timer.current = setTimeout(() => setOpen(false), 120); }}
      onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } }}
      onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <button
        ref={btn}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          // 마우스로 막 열린 직후의 클릭은 닫지 않음(열림 → 바로 닫힘 방지)
          if (open && Date.now() - openedAt.current < 400) return;
          set(!open);
        }}
      >
        {menu.label} <i className="ti ti-chevron-down" aria-hidden="true" />
      </button>
      <div className="gnb-dd" role="menu">
        {menu.items.map((it) => (
          <NavLink key={it.to} to={it.to} role="menuitem" className={({ isActive }) => (isActive ? "cur" : "")}>
            <i className={`ti ${it.icon}`} aria-hidden="true" />
            <div><b>{it.label}</b><span>{it.desc}</span></div>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export default function TopNav({ hidden, right }) {
  const { pathname } = useLocation();
  return (
    <header className={`gnb ${hidden ? "hide" : ""}`}>
      <div className="gnb-in">
        <Link to="/" className="gnb-logo" aria-label="페스로움 홈">
          <img src="/brand/fesroam_logo_horizontal.png" alt="페스로움" />
        </Link>
        <nav className="gnb-menu" aria-label="주요 메뉴">
          {MENU.map((m) =>
            m.items ? (
              <Dropdown key={m.label} menu={m} pathname={pathname} />
            ) : (
              <div key={m.label} className={`gnb-mi ${pathname.startsWith(m.to) ? "on" : ""}`}>
                <NavLink to={m.to}>{m.label}</NavLink>
              </div>
            ),
          )}
        </nav>
        <div className="gnb-util">{right}</div>
      </div>
    </header>
  );
}
