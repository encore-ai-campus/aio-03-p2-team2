// 축제 목록을 실제 API에서 불러오고, 실패하면 기존 데모 데이터로 화면을 유지한다.
// source: "loading" | "api" | "demo"(서버 연결 실패) | "empty"(DB에 축제 없음)
import { useEffect, useState } from "react";
import { fetchAllFestivals } from "../api/festivalsApi.js";
import { DEMO_MODE } from "../../../shared/lib/demoMode.js";

export function useFestivals(demoFestivals) {
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
        console.warn("[festivals] API 실패 → 데모 데이터 사용", error);
        setResult({ festivals: null, source: "demo", error });
      });
    return () => {
      alive = false;
    };
  }, []);

  // 데모 모드가 아니면 로딩·실패 중에도 예시 축제를 섞지 않는다 (빈 목록 + source로 화면이 상태를 그림)
  const fallback = DEMO_MODE ? demoFestivals : [];
  return { festivals: result.festivals ?? fallback, source: result.source, error: result.error, demoMode: DEMO_MODE };
}

export const SOURCE_LABEL = {
  loading: ["⏳ 축제 불러오는 중", "pill"],
  api: ["🟢 실제 축제 데이터", "pill green"],
  demo: ["🧪 데모 데이터 (서버 연결 실패)", "pill"],
  empty: ["🧪 데모 데이터 (DB에 축제 없음)", "pill"],
};
