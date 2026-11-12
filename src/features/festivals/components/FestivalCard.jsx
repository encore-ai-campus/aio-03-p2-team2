import { Fragment } from "react";
import { Card } from "../../../shared/components/Primitives.jsx";
export function FestivalCard({ demo, f }) {
  const { btn, active, status, dday, period } = demo;
  let past = !active(f);
  let gradient =
    {
      미식: "linear-gradient(135deg,#ffcc93,#f58b79)",
      음악: "linear-gradient(135deg,#a9acff,#f39a9f)",
      문화: "linear-gradient(135deg,#8dd6d1,#8d9ded)",
      전통: "linear-gradient(135deg,#ffd8a1,#d99d8d)",
      자연: "linear-gradient(135deg,#b0dc96,#90c9bb)",
    }[f.category] || "linear-gradient(135deg,#ffba89,#ef8f82)";
  return (
    <>
      <Card as="article" className="card fest-card">
        <div
          className="cover"
          style={{
            background: gradient,
          }}
        >
          <span className="symbol">{f.emoji || "🎪"}</span>
          <span className={`flag ${past ? "past" : status(f) === "live" ? "live" : ""}`}>
            {dday(f)}
          </span>
        </div>
        <div className="fest-body">
          <h3>{f.name}</h3>
          <div className="metadata">
            {"📍 "}
            {f.region} {f.city}
            {" \xA0 📅 "}
            {period(f)}
          </div>
          <p
            style={{
              marginTop: "10px",
            }}
          >
            {f.description}
          </p>
          <div className="tagline">
            {(f.tags || []).slice(0, 3).map((x, index) => (
              <Fragment key={index}>
                <span className="tag">#{x}</span>
              </Fragment>
            ))}
          </div>
          <div className="fest-foot">
            <span className="muted tiny">{f.category}</span>
            {past
              ? btn("종료 · 정보 보기", `festival:${f.id}`, "btn small")
              : btn("AI 동행 찾기 →", `festival:${f.id}`, "btn small soft")}
          </div>
        </div>
      </Card>
    </>
  );
}
