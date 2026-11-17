import { Fragment } from "react";
import { Card } from "../../../shared/components/Primitives.jsx";

// 「부산광역시 수영구」 → 「부산 수영구」처럼 지역 꼬리를 줄인다
const shortRegion = (r) =>
  String(r || "")
    .replace(/특별자치시|특별자치도|특별시|광역시/g, "")
    .replace(/(충청|전라|경상)(남|북)도/g, (_, a, b) => ({ 충청: "충", 전라: "전", 경상: "경" })[a] + b)
    .replace(/도$/, "")
    .trim();

export function FestivalCard({ demo, f }) {
  const { btn, active, status, dday, period } = demo;
  let past = !active(f);
  // TourAPI 사진: 원본 대표 이미지 우선(썸네일은 작아서 깨짐)
  const photo = f.imageUrl || f.thumbnailUrl;
  // 1/1~12/31 상설 행사는 기간 대신 「상시 운영」
  const allYear = f.start?.slice(5) === "01-01" && f.end?.slice(5) === "12-31";
  const place = [shortRegion(f.region), f.city].filter(Boolean).join(" ");
  let gradient =
    {
      미식: "linear-gradient(135deg,#ffcc93,#f58b79)",
      음악: "linear-gradient(135deg,#a9acff,#f39a9f)",
      문화: "linear-gradient(135deg,#8dd6d1,#8d9ded)",
      전통: "linear-gradient(135deg,#ffd8a1,#d99d8d)",
      자연: "linear-gradient(135deg,#b0dc96,#90c9bb)",
    }[f.category] || "linear-gradient(135deg,#ffba89,#ef8f82)";
  return (
    <Card as="article" className="card fest-card fc2">
      <div className={`fc2-cover ${photo ? "has-photo" : ""}`} style={{ background: photo ? "#f1eeec" : gradient }}>
        {photo ? (
          <img src={photo} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : (
          <span className="fc2-symbol">{f.emoji || "🎪"}</span>
        )}
        <span className={`fc2-flag ${past ? "past" : status(f) === "live" ? "live" : ""}`}>{dday(f)}</span>
      </div>
      <div className="fc2-body">
        <h3 className="fc2-title">{f.name}</h3>
        <div className="fc2-meta">
          <i className="ti ti-map-pin" aria-hidden="true" />
          <span>{place || "지역 미정"}</span>
          <span className="fc2-dot">·</span>
          <span>{allYear ? "상시 운영" : period(f)}</span>
        </div>
        {/* 설명은 상세 화면에서만 — 카드는 사진·이름·장소·기간으로 고르게 */}
        <div className="fc2-foot">
          <div className="fc2-tags">
            {(f.tags || []).slice(0, 2).map((x, index) => (
              <Fragment key={index}>
                <span>#{x}</span>
              </Fragment>
            ))}
          </div>
          {past ? <span className="fc2-ended">기간 종료</span> : btn("AI 동행 찾기 →", `festival:${f.id}`, "btn small soft")}
        </div>
      </div>
    </Card>
  );
}
