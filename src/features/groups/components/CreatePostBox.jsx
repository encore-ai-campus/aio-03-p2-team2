// 매칭 결과 다음 단계 — 「모집글 만들기」 (POST /groups)
// 에이전트·직접 매칭 둘 다 모임을 만들지 않으므로, 결과 확인 후 여기서 모집글을 생성한다.
// 만든 사람이 모임장이 되고, 생성 후 동행 커뮤니티에서 해당 모집글을 연다.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGroup } from "../api/groupsApi.js";

const ERROR_TEXT = {
  FESTIVAL_NOT_AVAILABLE: "종료되었거나 이용할 수 없는 축제예요.",
};

export default function CreatePostBox({ festival, partySize, joinMode = "approval", summary }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    title: `${festival?.name || "축제"} 함께할 동행 모집 🌟`.slice(0, 45),
    postBody: [
      "AI 매칭으로 시작된 동행 모집이에요!",
      festival && `🎪 ${festival.name}${festival.start ? ` (${festival.start} ~ ${festival.end})` : ""}`,
      summary && `📋 ${summary}`,
      "함께 갈 분은 댓글로 인사하고 참여를 신청해 주세요.",
    ]
      .filter(Boolean)
      .join("\n"),
    capacity: Math.min(8, Math.max(2, Number(partySize) || 4)),
    joinMode,
  }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: k === "capacity" ? Number(e.target.value) : e.target.value }));

  if (!festival) return null;
  if (!open)
    return (
      <button type="button" className="btn small primary" onClick={() => setOpen(true)}>
        ✍️ 이 조건으로 모집글 만들기
      </button>
    );

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.postBody.trim()) return setError("제목과 내용을 입력해 주세요.");
    setBusy(true);
    setError("");
    try {
      const group = await createGroup({ festivalId: festival.id, ...form, title: form.title.trim(), postBody: form.postBody.trim() });
      navigate(`/groups?groupId=${encodeURIComponent(group.id)}`);
    } catch (err) {
      console.warn("[groups] 생성 실패", err);
      setError(ERROR_TEXT[err.code] || err.message || "모집글을 만들지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="note" onSubmit={submit} style={{ display: "grid", gap: "8px", marginTop: "10px" }}>
      <strong>✍️ 모집글 확인 후 저장</strong>
      <input className="input" maxLength={45} value={form.title} onChange={set("title")} aria-label="모집글 제목" />
      <textarea className="input" rows={4} maxLength={2000} value={form.postBody} onChange={set("postBody")} aria-label="모집글 내용" />
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <select className="input" value={form.capacity} onChange={set("capacity")} aria-label="정원">
          {[2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>
              정원 {n}명
            </option>
          ))}
        </select>
        <select className="input" value={form.joinMode} onChange={set("joinMode")} aria-label="참여 방식">
          <option value="approval">모임장 승인제</option>
          <option value="instant">즉시 참여제</option>
        </select>
      </div>
      {error && (
        <div className="tiny" role="alert">
          ⚠️ {error}
        </div>
      )}
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="submit" className="btn small primary" disabled={busy}>
          {busy ? "저장 중…" : "모집글 저장"}
        </button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>
          취소
        </button>
      </div>
    </form>
  );
}
