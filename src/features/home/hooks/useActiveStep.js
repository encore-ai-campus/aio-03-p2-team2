import { useEffect, useRef, useState } from "react";

// 2단계 연출: 화면 가운데 띠에 들어온 단계를 현재 단계로
export function useActiveStep(count) {
  const [step, setStep] = useState(0);
  const refs = useRef([]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setStep(Number(e.target.dataset.step))),
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.slice(0, count).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [count]);
  return [step, refs];
}
