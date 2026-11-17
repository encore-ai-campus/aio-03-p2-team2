import { useCallback, useEffect, useRef, useState } from "react";

// 가로로 넘치는 영역을 앱처럼 다루는 훅
// - 넘칠 때만 왼쪽/오른쪽 「더 있음」 상태(canLeft·canRight)를 알려 줌 → 흐림·화살표 표시용
// - 마우스 끌어서 넘기기, 세로 휠을 가로 이동으로 바꾸기
// - scrollToEl(el, offset): 특정 칸이 보이도록 부드럽게 이동 (예: 첫 비 시간)
export default function useHorizontalScroll(deps = []) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ canLeft: false, canRight: false });

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { canLeft: el.scrollLeft > 2, canRight: el.scrollLeft < max - 2 };
    setEdges((cur) => (cur.canLeft === next.canLeft && cur.canRight === next.canRight ? cur : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    el.addEventListener("scroll", sync, { passive: true });
    // 세로 휠 → 가로 이동 (넘칠 때만, 페이지 스크롤은 막지 않음)
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    // 마우스로 끌어서 넘기기
    let startX = 0;
    let startLeft = 0;
    let dragging = false;
    const down = (e) => {
      if (e.pointerType !== "mouse" || el.scrollWidth <= el.clientWidth) return;
      dragging = true;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      el.classList.add("dragging");
      el.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (dragging) el.scrollLeft = startLeft - (e.clientX - startX);
    };
    const up = () => {
      dragging = false;
      el.classList.remove("dragging");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", sync);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollByPage = useCallback((dir) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.6, behavior: "smooth" });
  }, []);

  const scrollToEl = useCallback((target, offset = 0) => {
    const el = ref.current;
    if (!el || !target || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: Math.max(0, target.offsetLeft - offset), behavior: "smooth" });
  }, []);

  return { ref, ...edges, scrollByPage, scrollToEl };
}
