import { useMemo } from "react";
import { useFestivals } from "../../festivals/hooks/useFestivals.js";
import { badge, todayStr } from "../lib/homeContent.js";

// 참여 가능 + 사진 있는 축제를 시작일 순으로
export function usePreviewFestivals() {
  const { festivals, source } = useFestivals();
  const list = useMemo(() => {
    const today = todayStr();
    return festivals
      .filter((f) => f.end >= today && (f.thumbnailUrl || f.imageUrl))
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 6)
      .map((f) => ({ ...f, img: f.thumbnailUrl || f.imageUrl, badge: badge(f, today) }));
  }, [festivals]);
  return { list, source };
}
