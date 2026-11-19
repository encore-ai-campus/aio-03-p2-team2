import test from "node:test";
import assert from "node:assert/strict";
import { initialState } from "../src/app/appState.js";
import { matchingAgentRequest, matchingView } from "../src/features/matching/lib/agentFestival.js";

const festivals = [{ id: "fst_tour_3360113", start: "2026-11-19", end: "2026-11-22" }];

test("production state contains only UI settings and no demo entities", () => {
  const state = initialState();
  for (const key of ["festivals", "groups", "actor", "aiChat", "weather", "matchScores"]) assert.equal(Object.hasOwn(state, key), false);
});

test("empty DB and failed API never open a demo chatbot", () => {
  assert.equal(matchingView("empty", false), "empty");
  assert.equal(matchingView("demo", false), "error");
  assert.equal(matchingView("loading", false), "loading");
  assert.equal(matchingView("api", false), "api");
  assert.equal(matchingView("empty", true), "empty");
  assert.equal(matchingView("demo", true), "error");
  assert.equal(matchingView("api", true), "api");
});

test("persisted demo selection and its date never enter an actual agent request", () => {
  const request = matchingAgentRequest({ festivals, festivalId: "f07", selectedDate: "2026-11-20",
    message: "동행 찾아줘", sessionId: "ses_test" });
  const body = JSON.parse(JSON.stringify(request));
  assert.equal(Object.hasOwn(body, "festivalId"), false);
  assert.deepEqual(body.conditions, {});
  assert.equal(body.message, "동행 찾아줘");
  assert.equal(body.sessionId, "ses_test");
});

test("actual DB selection and valid date survive while invalid dates are omitted", () => {
  const request = matchingAgentRequest({ festivals, festivalId: festivals[0].id, selectedDate: "2026-11-20" });
  assert.equal(request.festivalId, festivals[0].id);
  assert.deepEqual(request.conditions, { date: "2026-11-20" });
  assert.deepEqual(matchingAgentRequest({ festivals, festivalId: festivals[0].id, selectedDate: "2026-04-10" }).conditions, {});
  assert.equal(matchingAgentRequest({ festivals }).festivalId, undefined);
  assert.equal(matchingAgentRequest({ festivals: [], festivalId: "f07" }).festivalId, undefined);
});

test("DB membership rather than an ID prefix determines valid selections", () => {
  assert.equal(matchingAgentRequest({ festivals: [{ ...festivals[0], id: "f07" }], festivalId: "f07" }).festivalId, "f07");
});
