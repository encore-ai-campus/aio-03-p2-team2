import test from "node:test";
import assert from "node:assert/strict";
import { toConditions, recruitmentJoinMode } from "../src/features/matching/lib/matchingConditions.js";

test("selected participation date survives conversion into the actual matching request", () => {
  const conditions = toConditions({ date: "2026-11-22", start: "15:30", party: "4", joinMode: "instant" });
  assert.equal(conditions.date, "2026-11-22");
  assert.equal(conditions.startTime, "15:30");
  assert.equal(conditions.joinMode, "instant");
});

test("agent recruitment always describes approval mode regardless of onboarding preference", () => {
  assert.equal(recruitmentJoinMode({ runId: "run_example" }, "instant"), "approval");
  assert.equal(recruitmentJoinMode(null, "instant"), "instant");
  assert.equal(recruitmentJoinMode(null, undefined), "approval");
});
