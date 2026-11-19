// 동행 커뮤니티 상태·API — 목록/상세 조회, 참여 신청·승인·거절·댓글 처리, 주소(필터·정렬·선택 글) 관리
// 모임장 판단은 GET /me 의 users.id 와 group.leaderId 비교 (JWT sub와 다름)
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { getGroup, listGroups, listJoinRequests } from "../api/groupsApi.js";
import { communityError, SORTS } from "../lib/communityFormat.js";

export function useCommunity({ festivals, onFail, onCloseNew }) {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("groupId");
  const filter = params.get("status") || "all";
  const sort = SORTS.some(([v]) => v === params.get("sort")) ? params.get("sort") : "latest";
  const [groups, setGroups] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [joinMsg, setJoinMsg] = useState("");
  const [comment, setComment] = useState("");
  const [requests, setRequests] = useState([]); // 모임장일 때만 불러오는 대기 신청 목록
  const [requested, setRequested] = useState(() => new Set()); // 내가 이번에 신청한 모임 (상세 응답엔 신청 목록이 없음)
  const festival = (id) => festivals.find((f) => f.id === id);
  const [created, setCreated] = useState(""); // 방금 만든 모집글 id → 상세에 안내

  // 「＋ 직접 모임 만들기」 완료 → 창 닫고 새 글 상세로 이동, 목록 새로 불러오기
  const onCreated = (group) => {
    onCloseNew?.();
    setCreated(group.id);
    setParams({ groupId: group.id });
    window.scrollTo(0, 0);
    loadList();
  };

  // 상세에서 확인한 최신 값(인원·신청 대기) — 목록 API 값이 늦게 반영돼도 목록에 덮어쓴다
  const patchRef = useRef(null);
  const applyPatch = (list) => {
    const p = patchRef.current;
    return p ? list?.map((x) => (x.id === p.id ? { ...x, ...p } : x)) : list;
  };
  const loadList = useCallback(
    () =>
      listGroups()
        .then((list) => setGroups(applyPatch(list)))
        .catch((e) => {
          console.warn("[groups] 목록 API 조회 실패", e);
          onFail?.();
        }),
    [onFail],
  );
  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    () =>
      selectedId
        ? getGroup(selectedId)
            .then(async (group) => {
              setDetail(group);
              // 신청 목록은 상세에 없어서 모임장일 때만 따로 조회
              const reqs = me && group.leaderId === me.id ? await listJoinRequests(group.id) : [];
              setRequests(reqs);
              patchRef.current = {
                id: group.id,
                memberCount: group.memberCount,
                capacity: group.capacity,
                status: group.status,
                ...(me && group.leaderId === me.id ? { pendingRequestCount: reqs.length } : {}),
              };
              setGroups(applyPatch);
            })
            .catch((e) => setNotice(communityError(e)))
        : null,
    [selectedId, me],
  );
  useEffect(() => {
    setDetail(null);
    setNotice("");
    setJoinMsg("");
    setComment("");
    loadDetail();
  }, [loadDetail]);

  // 처리 후 목록·상세 다시 불러오기
  async function act(fn, done) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await fn();
      if (done) setNotice(done);
      await Promise.all([loadList(), loadDetail()]);
    } catch (e) {
      console.warn("[groups] 요청 실패", e);
      setNotice(communityError(e));
      if (e.code === "RESOURCE_VERSION_CONFLICT") loadDetail();
    } finally {
      setBusy(false);
    }
  }

  // 이번 화면에서 신청한 모임으로 표시 (상세 응답엔 신청 목록이 없음)
  const markRequested = (id) => setRequested((s) => new Set(s).add(id));

  // 필터·정렬은 주소에 남겨서 「목록으로」를 눌러도 유지
  const listParams = (next = {}) => {
    const st = next.status ?? filter;
    const so = next.sort ?? sort;
    return { ...(st !== "all" ? { status: st } : {}), ...(so !== "latest" ? { sort: so } : {}) };
  };
  const keepFilter = listParams();
  const openGroup = (id) => {
    setParams({ ...keepFilter, groupId: id });
    window.scrollTo(0, 0);
  };
  const backToList = () => setParams(keepFilter);
  const changeList = (next) => setParams(listParams(next));

  return {
    me, selectedId, filter, sort, groups, detail, busy, notice, joinMsg, comment, requests, requested, created,
    festival, setJoinMsg, setComment, onCreated, act, markRequested, openGroup, backToList, changeList,
  };
}
