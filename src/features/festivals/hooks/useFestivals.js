// 실제 API에서 축제 목록을 조회한다. 실패 시 오류 상태를 반환한다.
// source: "loading" | "api" | "error" | "empty"
import { useEffect, useState } from "react";
import { fetchAllFestivals } from "../api/festivalsApi.js";

export function useFestivals() {
  const [result, setResult] = useState({ festivals: null, source: "loading", error: null });

  useEffect(() => {
    let alive = true; // 화면이 닫힌 뒤 응답이 와도 상태를 바꾸지 않도록
    fetchAllFestivals()
      .then((list) => {
        if (!alive) return;
        setResult(list.length ? { festivals: list, source: "api", error: null } : { festivals: null, source: "empty", error: null });
      })
      .catch((error) => {
        if (!alive) return;
        console.warn("[festivals] API 조회 실패", error);
        setResult({ festivals: null, source: "error", error });
      });
    return () => {
      alive = false;
    };
  }, []);

  return { festivals: result.festivals ?? [], source: result.source, error: result.error };
}

export const SOURCE_LABEL = {
  loading: ["⏳ 축제 불러오는 중", "pill"],
  api: ["🟢 실제 축제 데이터", "pill green"],
  error: ["축제를 불러오지 못했어요", "pill"],
  empty: ["등록된 축제가 없어요", "pill"],
};
