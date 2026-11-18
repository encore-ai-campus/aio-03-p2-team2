import test from "node:test";
import assert from "node:assert/strict";
import { defaults } from "./fixtures/demoData.js";
import { createDemoModel } from "./fixtures/demoModel.js";
import { aiParse } from "./fixtures/aiParse.js";
import { aiReply, missingOptional } from "./fixtures/aiChat.js";

function setup() {
  const state = defaults();
  for (const f of state.festivals) f.end = "2099-12-31";
  const notices = [];
  const model = createDemoModel(state, {
    fields: {},
    notify: (t) => notices.push(t),
    navigate() {},
    openUpload() {},
    pill: (t) => t,
  });
  const ctx = { festivals: state.festivals, active: model.active, today: () => "2026-11-12" };
  const say = (text) => aiReply(state, model, aiParse(text, ctx));
  const last = () => state.aiChat.messages.at(-1);
  return { state, model, notices, say, last };
}

test("conditions start empty: MBTI is '상관없음' and only join mode has a default", () => {
  const { state } = setup();
  assert.equal(state.festivalId, null);
  assert.deepEqual(state.profile.mbti, []);
  assert.equal(state.profile.start, "");
  assert.equal(state.profile.party, null);
  assert.equal(state.profile.joinMode, "approval");
});

test("matching is blocked until festival, start time and party size are set", () => {
  const { state, model, notices } = setup();
  assert.equal(model.performMatch(), false);
  assert.ok(notices.at(-1).includes("축제, 시작 시간, 희망 인원"));
  assert.equal(state.matchingDone, false);
});

test("chatbot asks required conditions one by one: festival → start → party", () => {
  const { say, last } = setup();
  say("동행 구해요, 사진 좋아해요");
  assert.equal(last().type, "ask"); // 축제 선택지
  say("부산 음악축제");
  assert.match(last().text, /몇 시부터/);
  say("이건 모르겠어요");
  assert.match(last().text, /몇 시부터/); // 비어 있으면 계속 다시 질문
  say("오후 3시부터");
  assert.match(last().text, /몇 명/);
  say("4명");
  assert.match(last().text, /선택 조건/); // 선택 조건은 한 번에
});

test("optional conditions are asked once; afterwards empty ones are excluded from the score", () => {
  const { state, model, say, last } = setup();
  say("부산 축제 3시부터 4명이서 가요");
  assert.match(last().text, /선택 조건/);
  assert.deepEqual(missingOptional(state).sort(), ["budget", "interests", "mbti", "style"].sort());
  say("상관없어요");
  assert.equal(last().type, "summary");
  assert.equal(say("응 매칭해"), "run");
  // 선택 조건 없이 점수 계산 → 미선택 항목 제외 후 100점 환산
  state.festivalId = "f22";
  Object.assign(state.profile, { start: "15:00", party: 4 });
  const r = model.candidateScore(model.person("haneul"), model.festival("f22"));
  for (const k of ["관심사", "예산", "스타일", "MBTI"]) assert.equal(r.parts[k], "미선택");
  assert.equal(r.score, 100);
});
