import test from "node:test";
import assert from "node:assert/strict";
import { applyUiAction, initialState, restoreUiState } from "../src/app/appState.js";
import { defaults } from "./fixtures/demoData.js";

test("old storage migrates filters and inputs without migrating demo entities or selected festival", () => {
  const legacy = { ...defaults(), festivalId: "f07", month: 11, keyword: "부산", region: "부산",
    profile: { ...defaults().profile, date: "2026-11-20", start: "15:00", interests: ["음악"] } };
  const next = restoreUiState(legacy, true);
  assert.equal(next.month, 11);
  assert.equal(next.keyword, "부산");
  assert.equal(next.profile.start, "15:00");
  assert.deepEqual(next.profile.interests, ["음악"]);
  assert.equal(next.festivalId, null);
  for (const key of ["festivals", "groups", "actor", "aiChat", "weather", "matchScores", "modal"]) assert.equal(key in next, false);
});

test("current UI settings restore a real selected festival and reject malformed arrays", () => {
  const next = restoreUiState({ festivalId: "fst_tour_1", profile: { interests: "wrong", mbti: ["ENFP", null] }, groups: [{}] });
  assert.equal(next.festivalId, "fst_tour_1");
  assert.deepEqual(next.profile.interests, []);
  assert.deepEqual(next.profile.mbti, ["ENFP"]);
  assert.equal("groups" in next, false);
});

test("live calendar actions preserve navigation boundaries, toggling and filter reset", () => {
  let state = applyUiAction(initialState(), "month:11");
  state = applyUiAction(state, "view:calendar");
  state = applyUiAction(state, "calDay:2026-11-20");
  assert.equal(state.calDay, "2026-11-20");
  state = applyUiAction(state, "calDay:2026-11-20");
  assert.equal(state.calDay, null);
  state = applyUiAction(state, "month:12");
  assert.equal(applyUiAction(state, "calMove:1").month, 12);
  state = applyUiAction(state, "month:1");
  assert.equal(applyUiAction(state, "calMove:-1").month, 1);
  state = applyUiAction({ ...state, keyword: "부산", region: "부산" }, "clearFilters");
  assert.equal(state.keyword, "");
  assert.equal(state.region, "all");
  assert.equal(state.status, "available");
});

test("interest and MBTI edits update only UI preferences without creating local groups", () => {
  const state = applyUiAction(applyUiAction(initialState(), "interest:음악"), "mbti:ENFP");
  assert.deepEqual(state.profile.interests, ["음악"]);
  assert.deepEqual(state.profile.mbti, ["ENFP"]);
  assert.deepEqual(applyUiAction(state, "interest:음악").profile.interests, []);
  assert.equal("groups" in state, false);
});
