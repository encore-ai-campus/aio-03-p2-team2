import test from "node:test";
import assert from "node:assert/strict";
import { INIT_GROUPS, clone, defaults } from "../src/shared/data/demoData.js";
import { createDemoModel } from "../src/shared/lib/demoModel.js";

function setup() {
  // 화면 기본값은 모임 없이 시작하므로, 모임 규칙 시험에는 예시 모임을 직접 넣는다
  const state = { ...defaults(), groups: clone(INIT_GROUPS), selectedGroup: "g2" };
  const notices = [];
  const pages = [];
  const model = createDemoModel(state, {
    fields: {},
    notify: (text) => notices.push(text),
    navigate: (page) => pages.push(page),
    openUpload() {},
    pill: (text) => text,
  });
  // Keep the 2026 prototype scenarios reproducible after the sample dates expire.
  for (const festival of state.festivals) festival.end = "2099-12-31";
  // v4.4: 조건은 비운 상태로 시작하므로 기존 시나리오용 조건을 채운다.
  state.festivalId = "f21";
  Object.assign(state.profile, {
    interests: ["미식", "사진"],
    budget: 8,
    style: "여유롭게",
    mbti: ["ENFP", "INFJ"],
    party: 4,
    start: "13:00",
  });
  return { state, model, notices, pages };
}

test("matching creates one public room and does not automatically enroll candidates", () => {
  const { state, model } = setup();
  model.performMatch();
  const room = model.group(state.matchGroupId);
  assert.deepEqual(room.members, ["me"]);
  assert.ok(room.post.includes("AI 매칭"));
  assert.ok(state.matchScores.length > 0);
  const count = state.groups.length;
  model.performMatch();
  assert.equal(state.groups.length, count);
});

test("optional MBTI is excluded and the remaining matching weights are normalized", () => {
  const { state, model } = setup();
  state.profile.mbti = [];
  const result = model.candidateScore(
    model.person("minji"),
    model.festival("f21"),
  );
  assert.equal(result.parts.MBTI, "미선택");
  assert.equal(result.score, 100);
});

test("host approval closes a full room and detects the 13:00 / 15:00 conflict", () => {
  const { state, model } = setup();
  const room = model.group("g2");
  model.approveMember(room, "haneul");
  assert.equal(room.members.length, room.max);
  assert.ok(!room.pending.includes("haneul"));
  assert.equal(room.conflict.required, "15:00");
  assert.ok(model.groupClosed(room));
  assert.equal(state.page, "schedule");
});

test("a proposal changes nothing until the host approves, then posts a chat notice", () => {
  const { state, model } = setup();
  const room = model.group("g2");
  model.approveMember(room, "haneul");
  model.makeProposal(room);
  assert.equal(room.schedule[0].time, "13:00");
  state.actor = "haneul";
  model.acceptProposal(room);
  assert.equal(room.schedule[0].time, "13:00");
  state.actor = "me";
  model.acceptProposal(room);
  assert.deepEqual(
    room.schedule.map((item) => item.time),
    ["15:00", "15:30", "18:30"],
  );
  assert.equal(room.conflict, null);
  assert.equal(room.proposal, null);
  assert.ok(room.chat.at(-1).text.includes("모임장 승인 완료"));
});

test("an outsider cannot approve a pending member or join a full room", () => {
  const { state, model } = setup();
  state.actor = "guest";
  const room = model.group("g2");
  model.approveMember(room, "haneul");
  assert.ok(room.pending.includes("haneul"));
  room.max = room.members.length;
  model.joinRoom(room.id);
  assert.ok(!room.members.includes("guest"));
  assert.ok(!room.pending.includes("guest"));
});

test("approval rooms queue requests, while instant rooms enroll immediately", () => {
  const { state, model } = setup();
  state.actor = "guest";
  model.joinRoom("g3");
  model.joinRoom("g3");
  assert.equal(
    model.group("g3").pending.filter((id) => id === "guest").length,
    1,
  );
  assert.ok(!model.group("g3").members.includes("guest"));
  model.joinRoom("g1");
  assert.ok(model.group("g1").members.includes("guest"));
});

test("festival imports accept supported date keys and reject invalid ranges", () => {
  const { model } = setup();
  const festival = model.normalizeFestival(
    {
      title: "테스트 축제",
      eventstartdate: "20261114",
      eventenddate: "20261115",
      contentid: 42,
    },
    0,
  );
  assert.equal(festival.start, "2026-11-14");
  assert.equal(festival.id, "42");
  assert.equal(
    model.normalizeFestival(
      { name: "역순", start: "2026-12-01", end: "2026-11-01" },
      0,
    ),
    null,
  );
  assert.equal(
    model.normalizeFestival({ name: "2027년", start: "2027-01-01" }, 0),
    null,
  );
});
