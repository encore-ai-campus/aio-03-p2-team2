// 챗봇 답변을 실시간으로 쓰는 것처럼 한 글자씩 보여 준다 (처음 나타날 때 한 번만)
import { useEffect, useState } from "react";

export const REDUCED = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function TypeText({ text }) {
  const full = String(text || "");
  const [n, setN] = useState(REDUCED ? full.length : 0);
  useEffect(() => {
    if (n >= full.length) return undefined;
    const step = Math.max(1, Math.ceil(full.length / 45)); // 길이와 상관없이 약 0.8초 안에 끝남
    const t = setTimeout(() => setN((x) => Math.min(full.length, x + step)), 18);
    return () => clearTimeout(t);
  }, [n, full.length]);
  return (
    <>
      {full.slice(0, n)}
      {n < full.length && <span className="ai-caret" aria-hidden="true" />}
    </>
  );
}
