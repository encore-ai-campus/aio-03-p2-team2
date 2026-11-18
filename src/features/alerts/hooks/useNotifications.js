// 알림 드롭다운 상태 — 탭(전체/안 읽음)·페이지 이어 받기·안 읽음 수·단건 읽음 처리(낙관적 업데이트)
// 서버: GET /alerts?page&pageSize[&status=unread] → { items, total } / PATCH /alerts/{id}/read
// 「모두 읽음」 API는 없어서 제공하지 않음
import { useCallback, useEffect, useRef, useState } from "react";
import { listAlertsPage, markAlertRead } from "../api/alertsApi.js";
import { isVisibleAlert } from "../lib/alertStatus.js";

const PAGE_SIZE = 10;

export function useNotifications({ userId, refreshKey }) {
  const [tab, setTab] = useState("all"); // all | unread
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadingMore, setLoadingMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [reload, setReload] = useState(0);
  const [lastFull, setLastFull] = useState(false);
  const seq = useRef(0); // 늦게 도착한 이전 요청이 최신 목록을 덮어쓰지 않게

  const fetchPage = useCallback((p) => listAlertsPage({ page: p, pageSize: PAGE_SIZE, status: tab === "unread" ? "unread" : undefined }), [tab]);

  // 종 숫자: 서버의 안 읽음 total 기준
  const loadUnread = useCallback(
    () =>
      listAlertsPage({ page: 1, pageSize: 1, status: "unread" })
        .then((r) => setUnreadCount(r.total ?? r.items.length))
        .catch(() => {}),
    [],
  );

  // 첫 페이지 (탭 변경·화면 이동·다시 시도·드롭다운 열 때)
  useEffect(() => {
    const id = ++seq.current;
    setStatus("loading");
    fetchPage(1)
      .then((r) => {
        if (id !== seq.current) return;
        setItems(r.items.filter(isVisibleAlert)); // 거절(dismiss)한 알림은 숨김
        setTotal(r.total);
        setLastFull(r.items.length === PAGE_SIZE);
        setPage(1);
        setStatus("ready");
      })
      .catch(() => {
        if (id === seq.current) setStatus("error");
      });
    loadUnread();
  }, [fetchPage, loadUnread, userId, refreshKey, reload]);

  // 다른 탭·창에서 돌아오면 다시 조회
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setReload((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // 이전 알림 더 보기
  const loadMore = () => {
    if (loadingMore) return;
    const id = seq.current;
    setLoadingMore(true);
    fetchPage(page + 1)
      .then((r) => {
        if (id !== seq.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...r.items.filter((x) => isVisibleAlert(x) && !seen.has(x.id))];
        });
        setTotal(r.total);
        setLastFull(r.items.length === PAGE_SIZE);
        setPage((n) => n + 1);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };
  // 숨긴 알림이 있어도 끝을 정확히 알도록 받은 페이지 수 기준 (total이 없으면 마지막 페이지가 꽉 찼는지로)
  const hasMore = total != null ? page * PAGE_SIZE < total : lastFull;

  // 읽음 처리: unread만, 즉시 화면 반영 → 실패하면 되돌림
  const markRead = (item) => {
    if (item.status !== "unread") return;
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: "read" } : x)));
    setUnreadCount((n) => Math.max(0, n - 1));
    markAlertRead(item.id).catch(() => {
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: "unread" } : x)));
      setUnreadCount((n) => n + 1);
    });
  };

  return {
    tab, setTab, items, status, unreadCount, hasMore, loadingMore, loadMore, markRead,
    retry: () => setReload((n) => n + 1),
  };
}
