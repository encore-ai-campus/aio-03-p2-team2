// 매칭 결과 다음 단계 — 「모집글 만들기」 (POST /groups)
// 에이전트·직접 매칭 둘 다 모임을 만들지 않으므로, 결과 확인 후 여기서 모집글을 생성한다.
// 만든 사람이 모임장이 되고, 생성 후 동행 커뮤니티에서 해당 모집글을 연다.
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGroup, createGroupFromRun } from "../api/groupsApi.js";

const ERROR_TEXT = {
  FESTIVAL_NOT_AVAILABLE: "종료되었거나 이용할 수 없는 축제예요.",
  MATCHING_REQUIRED: "완료된 매칭 결과가 필요해요. 다시 매칭해 주세요.",
  MATCHING_EMPTY: "추천 후보가 없어서 모집글을 만들 수 없어요. 조건을 바꿔 주세요.",
};

export default function CreatePostBox({ cta = false, festival, partySize, joinMode = "approval", summary, runId, date, startTime, selectedCompanions = [], onBusyChange }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
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
  // 선택 동행은 사용자 초안과 분리해, 선택을 바꿔도 작성한 내용이 사라지지 않게 한다.
  const companionNote = selectedCompanions.length ? `함께하고 싶은 동행: ${selectedCompanions.join(", ")}` : "";

  if (!festival) return null;
  if (!open)
    return (
      <button type="button" className={cta ? "btn primary block cta-btn" : "btn small primary"} onClick={() => setOpen(true)}>
        {cta ? (
          <>
            모집글 만들기 <i className="ti ti-arrow-right" aria-hidden="true" />
          </>
        ) : (
          "✍️ 이 조건으로 모집글 만들기"
        )}
      </button>
    );

  async function submit(e) {
    e.preventDefault();
    if (submitting.current) return;
    if (!form.title.trim() || !form.postBody.trim()) return setError("제목과 내용을 입력해 주세요.");
    const postBody = [form.postBody.trim(), companionNote].filter(Boolean).join("\n\n");
    if (postBody.length > 2000) return setError("선택한 동행 안내를 포함해 모집글 내용을 2,000자 이내로 줄여 주세요.");
    submitting.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const body = { ...form, title: form.title.trim(), postBody };
      // 에이전트 매칭이면 매칭 조건을 이어받는 workflow API, 직접 매칭이면 일반 모임 생성
      const group = runId
        ? await createGroupFromRun(runId, body)
        : await createGroup({ festivalId: festival.id, ...body, date, startTime });
      navigate(`/groups?groupId=${encodeURIComponent(group.id)}`);
    } catch (err) {
      console.warn("[groups] 생성 실패", err);
      setError(ERROR_TEXT[err.code] || err.message || "모집글을 만들지 못했어요.");
    } finally {
      submitting.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <form className="note" onSubmit={submit} style={{ display: "grid", gap: "8px", marginTop: "10px" }}>
      <strong>✍️ 모집글 확인 후 저장</strong>
      <input className="input" maxLength={45} value={form.title} onChange={set("title")} aria-label="모집글 제목" disabled={busy} />
      <textarea className="input" rows={4} maxLength={2000} value={form.postBody} onChange={set("postBody")} aria-label="모집글 내용" disabled={busy} />
      {companionNote && <div className="tiny" aria-live="polite">모집글에 함께 기재됩니다: {companionNote}</div>}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <select className="input" value={form.capacity} onChange={set("capacity")} aria-label="정원" disabled={busy}>
          {[2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>
              정원 {n}명
            </option>
          ))}
        </select>
        <select className="input" value={runId ? "approval" : form.joinMode} disabled={!!runId || busy} onChange={set("joinMode")} aria-label="참여 방식">
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
        <button type="button" className="btn small" disabled={busy} onClick={() => setOpen(false)}>
          취소
        </button>
      </div>
    </form>
  );
}
