import { clone } from "../../../shared/data/demoData.js";
import { AI_LABEL } from "./aiParse.js";

// 챗봇 대화 상태 변경 규칙. DemoProvider.mutate()가 복제한 state를 넘겨준다.

export const emptyAiChat = () => ({ open: false, busy: false, messages: [], draft: {} });

export function aiPush(state, msg) {
  const c = state.aiChat;
  c.messages.push(msg);
  if (c.messages.length > 60) c.messages = c.messages.slice(-60);
}

export function aiMarkStale(state) {
  state.aiChat.messages.forEach((m) => {
    if (m.role === "bot" && ["summary", "ask", "fallback"].includes(m.type)) m.stale = true;
  });
}

export function aiStartTyping(state, label = "") {
  state.aiChat.busy = true;
  aiPush(state, { role: "bot", type: "typing", text: label });
}

export function aiStopTyping(state) {
  state.aiChat.messages = state.aiChat.messages.filter((m) => m.type !== "typing");
  state.aiChat.busy = false;
}

const CONFIRM =
  /^(응|네|넵|예|좋아|좋아요|ㅇㅇ|그래|오케이|ok|고고|매칭\s*(해|시작|실행|ㄱ)|찾아\s*줘|진행|실행)/i;

// 반환값 "run"이면 호출한 쪽이 aiRunResult()로 매칭을 실행한다.
export function aiReply(state, model, { text, slots, fest }) {
  const c = state.aiChat;
  const d = c.draft;
  const keys = Object.keys(slots);
  if (!keys.length && !fest.id && !fest.options.length && CONFIRM.test(text) && d.festivalId)
    return "run";
  const addMode = /추가|더\s*넣|도\s*(좋|추가|포함|넣|같이)/.test(text);
  keys.forEach((k) => {
    d[k] =
      k === "interests" && addMode
        ? [...new Set([...(d.interests || []), ...slots.interests])]
        : slots[k];
  });
  let festChanged = false;
  if (fest.id && fest.id !== d.festivalId) {
    d.festivalId = fest.id;
    festChanged = true;
  }
  aiMarkStale(state);
  if (!keys.length && !fest.id && !fest.options.length) {
    aiPush(state, {
      role: "bot",
      type: "fallback",
      text: "조건을 찾지 못했어요 🥲\n축제 이름·지역·날짜, 시작 시간, 예산, 관심사처럼 적어주시면 바로 정리해 드릴게요.",
    });
    return null;
  }
  if (!fest.id && fest.options.length && (!d.festivalId || /축제|페스티벌|마켓/.test(text))) {
    aiPush(state, {
      role: "bot",
      type: "ask",
      text:
        fest.options.length > 1
          ? "말씀하신 조건에 맞는 축제가 여러 개예요. 어느 축제로 갈까요?"
          : "이 축제가 맞나요?",
      options: fest.options,
      draft: clone(d),
    });
    return null;
  }
  if (!d.festivalId) {
    aiPush(state, {
      role: "bot",
      type: "ask",
      text: "좋아요! 조건은 기억해 둘게요. 어떤 축제에 함께 갈 동행을 찾으세요?",
      options: state.festivals.filter(model.active).slice(0, 6).map((f) => f.id),
      draft: clone(d),
    });
    return null;
  }
  const first = !c.messages.some((m) => m.type === "summary");
  const f = model.festival(d.festivalId);
  const changes = [
    ...(festChanged ? [`축제 ‘${f.name}’`] : []),
    ...keys.map((k) => AI_LABEL[k](d[k])),
  ];
  aiPush(state, {
    role: "bot",
    type: "summary",
    text: first
      ? `${f.name} 동행 조건을 이렇게 정리했어요.\n맞으면 ‘이 조건으로 매칭’을 눌러주세요!`
      : `${changes.join(", ")}${changes.length ? " 반영했어요." : "조건은 그대로예요."}\n업데이트된 조건이에요.`,
    draft: clone(d),
  });
  return null;
}

// 대화에서 인식한 조건을 매칭 폼(profile)에 반영
export function aiApply(state) {
  const d = state.aiChat.draft;
  const p = state.profile;
  if (d.festivalId) state.festivalId = d.festivalId;
  ["start", "budget", "style", "party", "joinMode"].forEach((k) => {
    if (d[k] != null) p[k] = d[k];
  });
  if (d.interests?.length) p.interests = [...d.interests];
  if (d.mbti) p.mbti = [...d.mbti];
}

// 매칭 실행 가능 여부 확인. 불가하면 축제 선택 질문을 남기고 false
export function aiCanRun(state, model) {
  const d = state.aiChat.draft;
  const f = d.festivalId && model.festival(d.festivalId);
  if (f && model.active(f)) return true;
  aiPush(state, {
    role: "bot",
    type: "ask",
    text: "먼저 함께 갈 축제를 골라주세요.",
    options: state.festivals.filter(model.active).slice(0, 6).map((x) => x.id),
    draft: clone(d),
  });
  return false;
}

export function aiRunResult(state, model) {
  aiMarkStale(state);
  aiApply(state);
  model.performMatch(true);
  aiPush(state, {
    role: "bot",
    type: "result",
    festivalId: state.festivalId,
    groupId: state.matchGroupId,
    scores: (state.matchScores || []).slice(0, 3).map((x) => ({ id: x.id, score: x.score })),
  });
}
