import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { listAlerts, subscribeToAlertChanges } from "../api/alertsApi.js";
import { isVisibleAlert, needsWeatherResponse } from "../lib/alertStatus.js";
import "../notificationDropdown.css";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul",
});
function alertTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? dateFormatter.format(date) : "";
}

export default function NotificationDropdown({ userId, hidden = false }) {
  const location = useLocation();
  const id = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState({ status: "loading", items: [] });
  const pending = result.items.filter(needsWeatherResponse).length;

  useEffect(() => subscribeToAlertChanges(() => setRefresh((value) => value + 1)), []);

  // 기존 벨과 동일하게 화면 이동 시 갱신하고, 미리보기를 열 때도 최신 상태를 확인한다.
  useEffect(() => {
    let alive = true;
    setResult((previous) => ({ ...previous, status: "loading" }));
    listAlerts()
      .then((items) => { if (alive) setResult({ status: "ready", items: items.filter(isVisibleAlert) }); })
      .catch(() => { if (alive) setResult({ status: "error", items: [] }); });
    return () => { alive = false; };
  }, [location.pathname, userId, refresh]);

  useEffect(() => { setOpen(false); }, [location.key, hidden]);

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus({ preventScroll: true });
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="al-preview" ref={rootRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={triggerRef} type="button" className="gnb-bell" title="AI 알림" aria-label="AI 알림"
        aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
        onClick={() => {
          if (!open) setRefresh((value) => value + 1);
          setOpen((value) => !value);
        }}>
        <i className="ti ti-bell" aria-hidden="true" />
        <span className="gnb-badge" hidden={!pending}>{pending}</span>
      </button>
      {open && (
        <section id={id} className="al-preview-panel" role="dialog" aria-labelledby={id + "-title"} tabIndex={-1} ref={panelRef}>
          <header className="al-preview-head">
            <div>
              <h2 id={id + "-title"}>AI 알림</h2>
              <p>{result.status === "ready" ? (pending ? "응답 대기 " + pending + "건 · 최근 알림" : "최근 알림") : "모임과 일정에 관한 소식"}</p>
            </div>
            <button type="button" className="al-preview-close" aria-label="알림 미리보기 닫기" onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
            }}><i className="ti ti-x" aria-hidden="true" /></button>
          </header>
          <div className="al-preview-body" aria-busy={result.status === "loading"}>
            {result.status === "loading" ? (
              <p className="al-preview-state" role="status">알림을 불러오고 있어요.</p>
            ) : result.status === "error" ? (
              <div className="al-preview-state" role="status">
                <p>알림을 불러오지 못했어요.</p>
                <button type="button" className="al-preview-retry" onClick={() => setRefresh((value) => value + 1)}>다시 시도</button>
              </div>
            ) : !result.items.length ? (
              <div className="al-preview-state">
                <i className="ti ti-bell-check" aria-hidden="true" />
                <strong>아직 받은 알림이 없어요</strong>
                <p>모임과 일정에 관한 소식이 도착하면 알려드려요.</p>
              </div>
            ) : (
              <ul className="al-preview-list">
                {result.items.slice(0, 5).map((item) => (
                  <li key={item.id} className="al-preview-item">
                    <div className="al-preview-meta">
                      <span>{needsWeatherResponse(item) ? "응답 대기" : item.type === "rain" ? "응답 완료" : "안내"}</span>
                      {alertTime(item.createdAt) && <time dateTime={item.createdAt}>{alertTime(item.createdAt)}</time>}
                    </div>
                    <h3>{item.title || "모임 알림"}</h3>
                    {item.message && <p>{item.message}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link className="al-preview-all" to="/alerts" onClick={() => setOpen(false)}>
            알림 전체 보기<i className="ti ti-arrow-right" aria-hidden="true" />
          </Link>
        </section>
      )}
    </div>
  );
}
