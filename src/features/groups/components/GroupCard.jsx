import { Button } from "../../../shared/components/Primitives.jsx";
export function GroupCard({ demo, g }) {
  const { state, pill, dispatch, festival, period, groupClosed, formatDate } =
    demo;
  const f = festival(g.festivalId),
    closed = groupClosed(g);
  return (
    <>
      <Button
        type="button"
        className={
          "" + "room-summary " + (state.selectedGroup === g.id ? "active" : "")
        }
        data-action={"" + "selectGroup:" + g.id}
        onClick={(event) => {
          dispatch("" + "selectGroup:" + g.id);
        }}
      >
        <div className="btnrow">
          {pill(closed ? "모집 마감" : "모집 중", closed ? "dark" : "green")}
          {pill(
            g.joinMode === "approval" ? "모임장 승인" : "즉시 참여",
            g.joinMode === "approval" ? "purple" : "blue",
          )}
        </div>
        <h3>{g.title}</h3>
        <div className="metadata">
          {"🎪 "}
          {f?.category || "축제"}
          {" \xA0 📍 "}
          {f?.region || "미정"}
          {" \xA0 📅 "}
          {f ? period(f) : "-"}
        </div>
        <div className="meter">
          <div
            style={{
              width: "" + Math.min(100, (g.members.length / g.max) * 100) + "%",
            }}
          />
        </div>
        <div className="lower">
          <span className="tiny muted">
            {"👤 "}
            {g.members.length}/{g.max}
            {"명 · 신청 대기 "}
            {g.pending.length}명
          </span>
          <span className="tiny muted">{formatDate(g.created)}</span>
        </div>
      </Button>
    </>
  );
}
