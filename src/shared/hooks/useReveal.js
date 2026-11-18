// 화면에 들어온 요소에 .in 클래스를 붙여 서서히 나타나게 한다 (홈 1단계 연출).
// 사용: const ref = useReveal(); <section ref={ref}> 안의 .reveal 요소들이 대상
// 「동작 줄이기」 설정이면 CSS에서 연출을 끈다.
import { useEffect, useRef } from "react";

export function useReveal(deps = []) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const targets = root.querySelectorAll(".reveal:not(.in)");
    if (typeof IntersectionObserver === "undefined") {
      targets.forEach((el) => el.classList.add("in"));
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.15 },
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
