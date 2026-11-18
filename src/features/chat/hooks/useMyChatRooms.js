// 내 모임방 찾기 — GET /groups 에는 참여자 정보가 없어 상세를 3개씩 조회 (DB 연결 풀 2 고려)
import { useEffect, useState } from "react";
import { getGroup, listGroups } from "../../groups/api/groupsApi.js";

export function useMyChatRooms(me, onFail) {
  const [all, setAll] = useState(null); // 전체 모임 요약
  const [rooms, setRooms] = useState([]); // 내가 참여한 모임(상세)
  const [roomsDone, setRoomsDone] = useState(false);

  useEffect(() => {
    if (!me) return;
    let alive = true;
    (async () => {
      try {
        const list = await listGroups();
        if (!alive) return;
        setAll(list);
        const found = [];
        for (let i = 0; i < list.length; i += 3) {
          const details = await Promise.all(list.slice(i, i + 3).map((g) => getGroup(g.id).catch(() => null)));
          if (!alive) return;
          details.forEach((d) => d && d.members.some((m) => m.userId === me.id) && found.push(d));
          setRooms([...found]);
        }
        setRoomsDone(true);
      } catch (e) {
        console.warn("[chat] 모임 목록 실패", e);
        if (alive) onFail?.();
      }
    })();
    return () => {
      alive = false;
    };
  }, [me, onFail]);

  return { all, rooms, roomsDone };
}
