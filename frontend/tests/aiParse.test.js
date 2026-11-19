import test from "node:test";
import assert from "node:assert/strict";
import { defaults } from "./fixtures/demoData.js";
import { aiParse, aiArgs } from "./fixtures/aiParse.js";

const state = defaults();
const ctx = {
  festivals: state.festivals.map((f) => ({ ...f, end: "2099-12-31" })),
  active: () => true,
  today: () => "2026-11-12",
};

test("chat sentence becomes matching condition slots", () => {
  const r = aiParse(
    "부산 음악축제 오후 3시부터 가능해요. 예산 10만원, 공연이랑 사진 좋아하고 여유롭게 4명이서 가고 싶어요",
    ctx,
  );
  assert.equal(r.fest.id, "f22");
  assert.equal(r.slots.start, "15:00");
  assert.equal(r.slots.budget, 10);
  assert.equal(r.slots.party, 4);
  assert.equal(r.slots.style, "여유롭게");
  assert.ok(r.slots.interests.includes("음악") && r.slots.interests.includes("사진"));
});

test("MBTI, join mode and budget rounding are recognized", () => {
  const r = aiParse("MBTI는 상관없어요, 바로 참여 가능하게, 9만원", ctx);
  assert.deepEqual(r.slots.mbti, []);
  assert.equal(r.slots.joinMode, "instant");
  assert.equal(r.slots.budget, 8);
  const r2 = aiParse("ENFP나 infj면 좋겠어요", ctx);
  assert.deepEqual(r2.slots.mbti, ["ENFP", "INFJ"]);
});

test("ambiguous region returns festival options instead of guessing", () => {
  const r = aiParse("광주 축제 가고 싶어요", ctx);
  assert.equal(r.fest.id, null);
  assert.ok(r.fest.options.length >= 2);
});

test("extracted slots map to the API condition format", () => {
  const args = aiArgs({ festivalId: "f22", start: "15:00", budget: 10 });
  assert.equal(args.festival_id, "f22");
  assert.equal(args.start_time, "15:00");
  assert.equal(args.budget_manwon, 10);
  assert.equal(args.party_size, null);
});
