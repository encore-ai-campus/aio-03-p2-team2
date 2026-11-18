import { clone } from "./demoData.js";
import { AI_LABEL } from "./aiParse.js";

// 챗봇 대화 상태 변경 규칙. DemoProvider.mutate()가 복제한 state를 넘겨준다.
// v4.4 조건 규칙
// - 필수(축제 → 시작 시간 → 희망 인원): 비어 있으면 하나씩 계속 다시 묻고 매칭하지 않음
// - 선택(예산·관심사·여행 스타일·MBTI): 처음 한 번만 한꺼번에 묻고, 이후 비어 있으면 점수에서 제외

export const OPTIONAL = ["budget", "interests", "style", "mbti"];
export const OPTIONAL_LABEL = { budget: "예산", interests: "관심사", style: "여행 스타일", mbti: "MBTI" };

export function aiPush(state, msg) {
  const c = state.aiChat;
  c.messages.push(msg);
  if (c.messages.length > 60) c.messages = c.messages.slice(-60);
}

export function aiMarkStale(state) {
  state.aiChat.messages.forEach((m) => {
    if (m.role === "bot" && ["summary", "ask", "askText", "fallback"].includes(m.type)) m.stale = true;
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

// 대화에서 말한 값(draft)을 우선하고, 없으면 직접 조건 설정(폼) 값을 사용
export function effective(state) {
  const d = state.aiChat.draft;
  const p = state.profile;
  return {
    festivalId: d.festivalId ?? state.festivalId ?? null,
    start: d.start ?? p.start ?? "",
    party: d.party ?? p.party ?? null,
    budget: d.budget ?? p.budget ?? null,
    interests: d.interests ?? p.interests ?? [],
    style: d.style ?? p.style ?? "",
    mbti: d.mbti ?? p.mbti ?? [],
  };
}

export function missingRequired(state, model) {
  return model.requiredMissing(effective(state));
}

export function missingOptional(state) {
  const e = effective(state);
  return OPTIONAL.filter((k) =>
    k === "interests" || k === "mbti" ? !e[k]?.length : e[k] == null || e[k] === "",
  );
}

const CONFIRM =
  /^(응|네|넵|예|좋아|좋아요|ㅇㅇ|그래|오케이|ok|고고|매칭\s*(해|시작|실행|ㄱ)|찾아\s*줘|진행|실행)/i;
const SKIP = /상관\s*(없|x)|없어요|없음|패스|넘어가|아무거나|괜찮아요|그냥\s*(해|진행)/i;

// 비어 있는 필수 조건을 순서대로 하나만 물어본다. 물어봤으면 true
export function askNextRequired(state, model, fest = { id: null, options: [] }, prefix = "") {
  const missing = missingRequired(state, model);
  if (!missing.length) return false;
  const d = state.aiChat.draft;
  const key = missing[0];
  if (key === "festival") {
    const options = fest.options.length
      ? fest.options
      : state.festivals.filter(model.active).slice(0, 6).map((f) => f.id);
    aiPush(state, {
      role: "bot",
      type: "ask",
      text:
        prefix +
        (fest.options.length > 1
          ? "말씀하신 조건에 맞는 축제가 여러 개예요. 어느 축제로 갈까요?"
          : fest.options.length === 1
            ? "이 축제가 맞나요?"
            : "어떤 축제에 함께 갈 동행을 찾으세요? (필수)"),
      options,
      draft: clone(d),
    });
  } else if (key === "start") {
    aiPush(state, {
      role: "bot",
      type: "askText",
      text: prefix + "몇 시부터 참여할 수 있으세요? (필수)",
      chips: ["오전 11시부터", "오후 1시부터", "오후 3시부터", "저녁 6시부터"],
      draft: clone(d),
    });
  } else {
    aiPush(state, {
      role: "bot",
      type: "askText",
      text: prefix + "본인 포함 몇 명이 함께 가면 좋을까요? (필수)",
      chips: ["2명", "3명", "4명", "5명"],
      draft: clone(d),
    });
  }
  return true;
}

function askOptional(state, missing) {
  const d = state.aiChat.draft;
  d._optAsked = true;
  aiPush(state, {
    role: "bot",
    type: "askText",
    text:
      "필수 조건은 다 모였어요! 선택 조건도 알려주시면 더 잘 맞는 동행을 찾을 수 있어요.\n" +
      `${missing.map((k) => OPTIONAL_LABEL[k]).join(" · ")} 중 원하는 것만 한 번에 적어 주세요.\n` +
      "없으면 ‘상관없어요’라고 해 주세요. 비워 둔 조건은 점수에서 빼고 계산해요.",
    chips: ["예산 10만원, 공연·사진 좋아해요, 여유롭게", "맛집·카페, 8만원, MBTI 상관없어요", "상관없어요"],
    draft: clone(d),
  });
}

function pushSummary(state, model, changes) {
  const c = state.aiChat;
  const d = c.draft;
  const first = !c.messages.some((m) => m.type === "summary");
  const f = model.festival(effective(state).festivalId);
  aiPush(state, {
    role: "bot",
    type: "summary",
    text: first
      ? `${f.name} 동행 조건을 이렇게 정리했어요.\n맞으면 ‘이 조건으로 매칭’을 눌러주세요!`
      : `${changes.join(", ")}${changes.length ? " 반영했어요." : "조건은 그대로예요."}\n업데이트된 조건이에요.`,
    draft: clone(d),
  });
}

// 반환값 "run"이면 호출한 쪽이 매칭을 실행한다.
export function aiReply(state, model, { text, slots, fest }) {
  const c = state.aiChat;
  const d = c.draft;
  const keys = Object.keys(slots);
  const skip = SKIP.test(text);
  if (
    !keys.length &&
    !fest.id &&
    !fest.options.length &&
    CONFIRM.test(text) &&
    !missingRequired(state, model).length
  )
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
  const recognized = keys.length || fest.id || fest.options.length;
  if (!recognized && !skip) {
    // 필수 조건을 묻는 중이었다면 같은 질문을 다시 한다
    if (missingRequired(state, model).length) {
      askNextRequired(state, model, fest, "그 부분은 이해하지 못했어요 🥲 ");
      return null;
    }
    aiPush(state, {
      role: "bot",
      type: "fallback",
      text: "조건을 찾지 못했어요 🥲\n축제 이름·지역·날짜, 시작 시간, 인원, 예산, 관심사처럼 적어주시면 바로 정리해 드릴게요.",
    });
    return null;
  }
  // 1) 필수 조건: 축제 → 시작 시간 → 인원, 하나씩
  const f = festChanged ? model.festival(d.festivalId) : null;
  const ack = f ? `‘${f.name}’로 할게요. ` : "";
  if (!fest.id && fest.options.length && (!effective(state).festivalId || /축제|페스티벌|마켓/.test(text))) {
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
  if (askNextRequired(state, model, { id: null, options: [] }, ack)) return null;
  // 2) 선택 조건: 처음 한 번만 한꺼번에
  const optMissing = missingOptional(state);
  if (!d._optAsked && optMissing.length && !skip) {
    askOptional(state, optMissing);
    return null;
  }
  d._optAsked = true;
  // 3) 조건 요약
  const changes = [
    ...(festChanged ? [`축제 ‘${f.name}’`] : []),
    ...keys.map((k) => AI_LABEL[k](d[k])),
  ];
  pushSummary(state, model, changes);
  return null;
}

// 대화에서 인식한 조건을 직접 조건 설정(profile)에 반영
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

// 매칭 실행 가능 여부 확인. 필수 조건이 비어 있으면 그 조건을 다시 묻고 false
export function aiCanRun(state, model) {
  return !askNextRequired(state, model, { id: null, options: [] }, "매칭하려면 필수 조건이 더 필요해요. ");
}

export function aiRunResult(state, model) {
  aiMarkStale(state);
  aiApply(state);
  if (!model.performMatch(true)) return;
  aiPush(state, {
    role: "bot",
    type: "result",
    festivalId: state.festivalId,
    groupId: state.matchGroupId,
    scores: (state.matchScores || []).slice(0, 3).map((x) => ({ id: x.id, score: x.score })),
  });
}
