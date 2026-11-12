import test from "node:test";
import assert from "node:assert/strict";
import { defaults } from "../src/shared/data/demoData.js";
import { createDemoModel } from "../src/shared/lib/demoModel.js";

function setup() {
  const state = defaults();
  const model = createDemoModel(state, {
    fields: {},
    notify() {},
    navigate() {},
    openUpload() {},
    pill: (t) => t,
  });
  return { state, model };
}

test("calendar view toggles and month navigation stays within 2026", () => {
  const { state, model } = setup();
  model.handle("view:calendar");
  assert.equal(state.discoverView, "calendar");
  model.handle("month:12");
  model.handle("calMove:1");
  assert.equal(state.month, 12);
  model.handle("month:1");
  model.handle("calMove:-1");
  assert.equal(state.month, 1);
});

test("selecting the same day twice clears the selection, changing month resets it", () => {
  const { state, model } = setup();
  model.handle("calDay:2026-11-21");
  assert.equal(state.calDay, "2026-11-21");
  model.handle("calDay:2026-11-21");
  assert.equal(state.calDay, null);
  model.handle("calDay:2026-11-21");
  model.handle("month:12");
  assert.equal(state.calDay, null);
});
