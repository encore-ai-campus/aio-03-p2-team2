// 직접 조건 매칭 실행 상태 관리 — 실행 당시 조건(key)을 함께 저장해,
// 조건이 바뀌면 이전 결과를 숨긴다.
import { useState } from "react";
import { createMatchingRun } from "../api/matchingApi.js";

const ERROR_TEXT = {
  FESTIVAL_NOT_AVAILABLE: "매칭할 수 없는 축제예요 (취소되었거나 없는 축제).",
  AUTH_USER_NOT_LINKED: "로그인 계정이 앱 사용자와 연결되지 않았어요. 다시 로그인해 주세요.",
  AUTH_USER_INVALID: "로그인 계정이 앱 사용자와 연결되지 않았어요. 다시 로그인해 주세요.",
};

export const conditionKey = (festivalId, profile) => JSON.stringify([festivalId, profile]);

export function useMatchingRun() {
  const [run, setRun] = useState({ status: "idle", key: null, result: null, error: null });

  async function execute(festivalId, profile) {
    const key = conditionKey(festivalId, profile);
    setRun({ status: "loading", key, result: null, error: null });
    try {
      const result = await createMatchingRun({ festivalId, profile });
      setRun({ status: "done", key, result, conditions: result.conditions, error: null });
    } catch (error) {
      console.warn("[matching] API 실패", error);
      const message = ERROR_TEXT[error.code] || error.message || "매칭 중 오류가 났어요. 잠시 후 다시 시도해 주세요.";
      setRun({ status: "error", key, result: null, error: message });
    }
  }

  return { run, execute };
}
