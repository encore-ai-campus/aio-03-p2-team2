// 상단 종 → 알림 드롭다운 (목록형 · 전체/안 읽음 탭 · 오늘/이전 묶음 · 이전 알림 더 보기)
// 알림을 누르면 읽음 처리 후 관련 화면으로: rain → /alerts?groupId= / festival_changed → /groups?groupId=
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useNotifications } from "../hooks/useNotifications.js";
import "../notificationDropdown.css";

// 승인 알림도 festival_changed로 오므로 승인/변경을 제목으로 추측하지 않는다.
const ALERT_TYPES = {
  rain: { label: "날씨", icon: "ti-cloud-rain" },
  festival_changed: { label: "모임", icon: "ti-users-group" },
};
const DEFAULT_TYPE = { label: "소식", icon: "ti-bell" };
const enc = encodeURIComponent;
const targetOf = (item) =>
  !item.groupId ? null : item.type === "rain" ? `/alerts?groupId=${enc(item.groupId)}` : item.type === "festival_changed" ? `/groups?groupId=${enc(item.groupId)}` : null;
// 응답이 필요한 날씨 알림만 표시
const needsAnswer = (item) => item.type === "rain" && item.status !== "dismissed" && item.status !== "answered" && !item.choice;

// 상대 시간: 방금 / n분 전 / n시간 전 / 어제 / 11.16
const rtf = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
const dayKey = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
function relTime(value, now) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(+d)) return "";
  const min = Math.round((now - d) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return rtf.format(-min, "minute");
  if (dayKey(d) === dayKey(now)) return rtf.format(-Math.round(min / 60), "hour");
  const days = Math.round((new Date(dayKey(now)) - new Date(dayKey(d))) / 864e5);
  if (days === 1) return "어제";
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).replace(/\s/g, "").replace(/\.$/, "");
}

export default function NotificationDropdown({ userId, hidden = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const id = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [openKey, setOpenKey] = useState(0);
  const n = useNotifications({ userId, refreshKey: `${location.pathname}|${openKey}` });

  // 오늘 / 이전 묶음
  const groups = useMemo(() => {
    const now = new Date();
    const today = dayKey(now);
    const out = [["오늘", []], ["이전", []]];
    n.items.forEach((x) => {
      const d = x.createdAt ? new Date(x.createdAt) : null;
      out[d && !Number.isNaN(+d) && dayKey(d) === today ? 0 : 1][1].push(x);
    });
    return out.filter(([, list]) => list.length);
  }, [n.items]);
  const now = new Date();

  useEffect(() => {
    setOpen(false);
  }, [location.key, hidden]);

  const close = (focusBell) => {
    setOpen(false);
    if (focusBell) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus({ preventScroll: true });
    const outside = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const keys = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
        return;
      }
      // ↑↓로 알림 사이 이동
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const rows = [...(listRef.current?.querySelectorAll(".nd-row") || [])];
      if (!rows.length) return;
      e.preventDefault();
      const i = rows.indexOf(document.activeElement);
      const next = e.key === "ArrowDown" ? (i + 1) % rows.length : (i <= 0 ? rows.length : i) - 1;
      rows[next].focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keys);
    };
  }, [open]);

  const openItem = (item) => {
    n.markRead(item);
    const to = targetOf(item);
    if (to) {
      setOpen(false);
      navigate(to);
    }
  };

  return (
    <div
      className="al-preview"
      ref={rootRef}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="gnb-bell"
        title="AI 알림"
        aria-label="AI 알림"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (!open) setOpenKey((v) => v + 1);
          setOpen((v) => !v);
        }}
      >
        <i className="ti ti-bell" aria-hidden="true" />
        <span className="gnb-badge" hidden={!n.unreadCount}>
          {n.unreadCount > 99 ? "99+" : n.unreadCount}
        </span>
      </button>
      {open && (
        <section id={id} className="al-preview-panel" role="dialog" aria-labelledby={id + "-title"} tabIndex={-1} ref={panelRef}>
          <header className="nd-head">
            <h2 id={id + "-title"}>알림</h2>
            <div className="nd-tabs" role="tablist" aria-label="알림 보기">
              {[["all", "전체"], ["unread", `안 읽음${n.unreadCount ? ` ${n.unreadCount}` : ""}`]].map(([v, label]) => (
                <button key={v} type="button" role="tab" aria-selected={n.tab === v} className={n.tab === v ? "on" : ""} onClick={() => n.setTab(v)}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="nd-close" aria-label="알림 닫기" onClick={() => close(true)}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </header>

          <div className="nd-body" aria-busy={n.status === "loading"} ref={listRef}>
            {n.status === "loading" ? (
              <ul className="nd-list" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="nd-skel">
                    <span />
                    <div>
                      <i />
                      <i />
                    </div>
                  </li>
                ))}
              </ul>
            ) : n.status === "error" ? (
              <div className="nd-state" role="status">
                <i className="ti ti-cloud-off" aria-hidden="true" />
                <strong>알림을 불러오지 못했어요</strong>
                <button type="button" className="nd-retry" onClick={n.retry}>
                  다시 시도
                </button>
              </div>
            ) : !n.items.length ? (
              <div className="nd-state">
                <i className="ti ti-bell-check" aria-hidden="true" />
                <strong>{n.tab === "unread" ? "읽지 않은 알림이 없어요" : "아직 받은 알림이 없어요"}</strong>
                <span>모임과 날씨 소식이 오면 여기에 모아 드려요.</span>
              </div>
            ) : (
              <>
                {groups.map(([title, list]) => (
                  <div key={title} className="nd-group">
                    <h3 className="nd-group-title">{title}</h3>
                    <ul className="nd-list">
                      {list.map((item) => {
                        const type = ALERT_TYPES[item.type] || DEFAULT_TYPE;
                        const unread = item.status === "unread";
                        const to = targetOf(item);
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              className={`nd-row ${unread ? "is-unread" : ""} ${to ? "" : "no-link"}`}
                              onClick={() => openItem(item)}
                              aria-label={`${unread ? "읽지 않음, " : ""}${type.label} 알림: ${item.title || "모임 알림"}`}
                            >
                              <span className={`nd-ico t-${item.type || "etc"}`} aria-hidden="true">
                                <i className={"ti " + type.icon} />
                              </span>
                              <span className="nd-copy">
                                <span className="nd-title">
                                  {item.title || "모임 알림"}
                                  {needsAnswer(item) ? <em className="nd-chip">응답 필요</em> : null}
                                </span>
                                {item.message ? <span className="nd-msg">{item.message}</span> : null}
                              </span>
                              <span className="nd-side">
                                <time dateTime={item.createdAt}>{relTime(item.createdAt, now)}</time>
                                {unread ? <span className="nd-dot" aria-hidden="true" /> : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {n.hasMore ? (
                  <button type="button" className="nd-more" onClick={n.loadMore} disabled={n.loadingMore}>
                    {n.loadingMore ? "불러오는 중…" : "이전 알림 더 보기"}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
