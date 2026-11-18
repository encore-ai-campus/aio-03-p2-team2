import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import React from "react";
import { act, create } from "react-test-renderer";
import { MemoryRouter, useLocation } from "react-router-dom";
import { defaults } from "../src/shared/data/demoData.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(root, "tests", ".ui-regression-"));
after(() => rm(temporary, { recursive: true, force: true }));

// Render production components and routes. Stub only authentication, external I/O,
// unrelated pages and the outer layout; keep actual RequireAuth and form behavior.
await build({
  stdin: { contents: `export { default as App } from './src/app/App.jsx';
    export { default as MatchingPage } from './src/features/matching/pages/MatchingPage.jsx';
    export { ApiResults } from './src/features/matching/pages/MatchingPage.jsx';
    export { default as AgentChatPanel } from './src/features/matching/components/AgentChatPanel.jsx';
    export { default as CreatePostBox } from './src/features/groups/components/CreatePostBox.jsx';`, resolveDir: root },
  bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
  outfile: join(temporary, "components.mjs"),
  plugins: [{ name: "test-boundaries", setup(b) {
    b.onResolve({ filter: /^(?:react(?:\/.*)?|react-router-dom)$/ }, (args) => ({ path: args.path, external: true }));
    b.onResolve({ filter: /(?:AuthProvider|DemoProvider|AppLayout|apiClient)\.jsx?$/ }, (args) => ({ path: args.path, namespace: "stub" }));
    b.onResolve({ filter: /(?:FestivalExplorePage|CommunityPage|ChatPage|SchedulePage|AlertsPage|ProfilePage|OnboardingPage|LoginPage)\.jsx$/ }, (args) => ({ path: args.path, namespace: "page" }));
    b.onLoad({ filter: /.*/, namespace: "page" }, (args) => ({ contents: `import React from 'react'; export default () => React.createElement('div', {'data-page': ${JSON.stringify(args.path.split("/").at(-1))}});` }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
      if (args.path.includes("AuthProvider")) return { contents: `export const AuthProvider = ({children}) => children; export const useAuth = () => globalThis.testAuth;` };
      if (args.path.includes("DemoProvider")) return { contents: `export const DemoProvider = ({children}) => children; export const useDemo = () => globalThis.testDemo;
        export const paths = {discover:'/festivals', match:'/matching', community:'/groups', room:'/chat', schedule:'/schedules', alerts:'/alerts'};` };
      if (args.path.includes("AppLayout")) return { contents: `import React from 'react'; import {Outlet} from 'react-router-dom'; export default () => React.createElement(Outlet);` };
      return { contents: `export const apiFetch = (path, options) => globalThis.testApi(path, options);` };
    });
    b.onLoad({ filter: /MatchingPage\.jsx$/ }, async (args) => ({ contents: `${await readFile(args.path, "utf8")}\nexport { ApiResults };`, loader: "jsx" }));
  } }],
});
const { App, MatchingPage, ApiResults, AgentChatPanel, CreatePostBox } = await import(pathToFileURL(join(temporary, "components.mjs")));
const h = React.createElement;
const festival = { id: "fst_tour_1", name: "실제 축제", start: "2099-11-19", end: "2099-11-22" };

function Location() { return h("output", { "data-location": useLocation().pathname }); }
async function mount(element, path = "/matching") {
  let renderer;
  await act(async () => { renderer = create(h(MemoryRouter, { initialEntries: [path] }, element, h(Location))); });
  return renderer;
}
const change = (renderer, label, value) => renderer.root.findByProps({ "aria-label": label }).props.onChange({ target: { value } });
const textOf = (value) => typeof value === "string" ? value : Array.isArray(value) ? value.map(textOf).join("") : textOf(value?.props?.children || "");
const button = (renderer, text) => renderer.root.findAllByType("button").find((b) => textOf(b.props.children).includes(text));

test("anonymous root ignores the persisted private page while signed-in navigation stays intact", async () => {
  for (const session of [null, { user: { id: "auth_me", user_metadata: { onboarded: true } } }]) {
    globalThis.testAuth = { session, loading: false };
    globalThis.testDemo = { state: { page: "alerts" } };
    globalThis.testApi = () => { throw new Error("anonymous routing must not request private data"); };
    const renderer = await mount(h(App), "/");
    assert.equal(renderer.root.findByType("output").props["data-location"], session ? "/alerts" : "/festivals");
    await act(async () => renderer.unmount());
  }
  globalThis.testAuth = { session: null, loading: false };
  const renderer = await mount(h(App), "/matching");
  assert.equal(renderer.root.findByType("output").props["data-location"], "/login");
  await act(async () => renderer.unmount());
});

test("changing selected companions preserves the draft and saving sends exactly one request", async () => {
  let release;
  const calls = [];
  globalThis.testApi = (path, options) => {
    calls.push({ path, ...options });
    return new Promise((resolve) => { release = resolve; });
  };
  const renderer = await mount(h(ApiResults, {
    run: { status: "done", conditions: { date: "2099-11-20", startTime: "15:00" }, result: { candidates: [
      { id: "a", name: "하늘", profile: {} }, { id: "b", name: "바다", profile: {} },
    ] } }, festival, profile: { party: "2", interests: [] }, summary: "11월 20일 오후 3시",
  }));
  await act(async () => renderer.root.findAllByProps({ role: "checkbox" })[0].props.onClick());
  await act(async () => button(renderer, "모집글 만들기").props.onClick());
  await act(async () => { change(renderer, "모집글 제목", "직접 수정한 제목"); change(renderer, "모집글 내용", "직접 수정한 본문"); });
  await act(async () => renderer.root.findAllByProps({ role: "checkbox" })[1].props.onClick());
  assert.equal(renderer.root.findByProps({ "aria-label": "모집글 제목" }).props.value, "직접 수정한 제목");
  assert.equal(renderer.root.findByProps({ "aria-label": "모집글 내용" }).props.value, "직접 수정한 본문");
  let first, second;
  await act(async () => {
    const submit = renderer.root.findByType("form").props.onSubmit;
    first = submit({ preventDefault() {} });
    second = submit({ preventDefault() {} });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.title, "직접 수정한 제목");
  assert.equal(calls[0].body.postBody, "직접 수정한 본문\n\n함께하고 싶은 동행: 바다");
  assert.equal(calls[0].body.date, "2099-11-20");
  assert.equal(calls[0].body.startTime, "15:00");
  assert.ok(renderer.root.findAllByProps({ role: "checkbox" }).every((b) => b.props.disabled));
  assert.equal(button(renderer, "취소").props.disabled, true);
  await act(async () => { release({ id: "group_saved" }); await first; await second; });
  assert.equal(renderer.root.findByType("output").props["data-location"], "/groups");
  await act(async () => renderer.unmount());
});

test("failed agent recruitment keeps the edited draft and supports retry", async () => {
  let count = 0;
  globalThis.testApi = async (path) => {
    assert.equal(path, "/workflow/matching/run_1/group");
    if (++count === 1) throw new Error("저장 실패");
    return { group: { id: "group_retry" } };
  };
  const renderer = await mount(h(CreatePostBox, { festival, runId: "run_1", partySize: 4, summary: "기존 조건" }));
  await act(async () => button(renderer, "모집글 만들기").props.onClick());
  await act(async () => change(renderer, "모집글 내용", "재시도할 초안"));
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(renderer.root.findByProps({ "aria-label": "모집글 내용" }).props.value, "재시도할 초안");
  assert.equal(button(renderer, "모집글 저장").props.disabled, false);
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(count, 2);
  assert.equal(renderer.root.findByType("output").props["data-location"], "/groups");
  await act(async () => renderer.unmount());
});

test("chatbot request omits a stale demo ID even when it is passed directly to the component", async () => {
  const calls = [];
  globalThis.testApi = async (path, options) => {
    calls.push({ path, ...options });
    return { runId: "run_ask", status: "waiting_input", interrupt: { missing: ["festivalId"], message: "축제 선택" } };
  };
  const renderer = await mount(h(AgentChatPanel, { festivals: [festival], festivalId: "f07", selectedDate: "2099-11-20" }));
  await act(async () => change(renderer, "동행 조건 입력", "동행 찾아줘"));
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(calls[0].path, "/agents/runs");
  assert.equal(calls[0].body.festivalId, undefined);
  assert.deepEqual(calls[0].body.conditions, {});
  await act(async () => renderer.unmount());
});

test("an empty database renders the actual empty state without a demo chatbot", async () => {
  const state = defaults();
  globalThis.testAuth = { session: null, user: null, loading: false };
  globalThis.testDemo = { state, festival: (id) => state.festivals.find((f) => f.id === id) || state.festivals[0],
    active: () => true, person: () => ({}), fieldProps: () => ({}), btn: () => null,
    pill: () => null, pageHead: () => null, mutate: () => {} };
  globalThis.testApi = async () => ({ items: [], total: 0 });
  const renderer = await mount(h(MatchingPage));
  assert.match(JSON.stringify(renderer.toJSON()), /등록된 축제가 없어요/);
  assert.equal(renderer.root.findAllByType("textarea").length, 0);
  assert.equal(renderer.root.findAllByType("form").length, 0);
  await act(async () => renderer.unmount());
});
