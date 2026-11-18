import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import React from "react";
import { act, create } from "react-test-renderer";
import { MemoryRouter, useLocation } from "react-router-dom";
import { initialState } from "../src/app/appState.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(root, "tests", ".ui-regression-"));
after(() => rm(temporary, { recursive: true, force: true }));

// Render production components and routes. Stub only authentication, external I/O,
// unrelated pages and the outer layout; keep actual RequireAuth and form behavior.
await build({
  stdin: { contents: `export { default as App } from './src/app/App.jsx';
    export { default as LiveAlerts } from './src/features/alerts/components/LiveAlerts.jsx';
    export { default as LiveChat } from './src/features/chat/components/LiveChat.jsx';
    export { default as LiveSchedule } from './src/features/schedules/components/LiveSchedule.jsx';
    export { default as ProfilePage } from './src/features/auth/pages/ProfilePage.jsx';
    export { AppStateProvider as ActualProvider, useAppState as useActualState } from 'actual-app-state';
    export { default as MatchingPage } from './src/features/matching/pages/MatchingPage.jsx';
    export { ApiResults } from './src/features/matching/pages/MatchingPage.jsx';
    export { default as AgentChatPanel } from './src/features/matching/components/AgentChatPanel.jsx';
    export { default as CreatePostBox } from './src/features/groups/components/CreatePostBox.jsx';`, resolveDir: root },
  bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
  outfile: join(temporary, "components.mjs"),
  plugins: [{ name: "test-boundaries", setup(b) {
    b.onResolve({ filter: /^actual-app-state$/ }, () => ({ path: join(root, 'src/app/AppStateProvider.jsx') }));
    b.onResolve({ filter: /^(?:react(?:\/.*)?|react-router-dom)$/ }, (args) => ({ path: args.path, external: true }));
    b.onResolve({ filter: /(?:AuthProvider|AppStateProvider|AppLayout|apiClient|supabase)\.jsx?$/ }, (args) => ({ path: args.path, namespace: "stub" }));
    b.onResolve({ filter: /(?:FestivalExplorePage|CommunityPage|ChatPage|SchedulePage|AlertsPage|OnboardingPage|LoginPage)\.jsx$/ }, (args) => ({ path: args.path, namespace: "page" }));
    b.onLoad({ filter: /.*/, namespace: "page" }, (args) => ({ contents: `import React from 'react'; export default () => React.createElement('div', {'data-page': ${JSON.stringify(args.path.split("/").at(-1))}});` }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
      if (args.path.includes("AuthProvider")) return { contents: `export const AuthProvider = ({children}) => children; export const useAuth = () => globalThis.testAuth;` };
      if (args.path.includes("AppStateProvider")) return { contents: `export const AppStateProvider = ({children}) => children; export const useAppState = () => globalThis.testDemo;
        export const paths = {discover:'/festivals', match:'/matching', community:'/groups', room:'/chat', schedule:'/schedules', alerts:'/alerts'};` };
      if (args.path.includes("AppLayout")) return { contents: `import React from 'react'; import {Outlet} from 'react-router-dom'; export default () => React.createElement(Outlet);` };
      if (args.path.endsWith("/supabase.js")) return { contents: `export const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } };` };
      return { contents: `export const apiFetch = (path, options) => globalThis.testApi(path, options);` };
    });
    b.onLoad({ filter: /MatchingPage\.jsx$/ }, async (args) => ({ contents: `${await readFile(args.path, "utf8")}\nexport { ApiResults };`, loader: "jsx" }));
  } }],
});
const { App, MatchingPage, ApiResults, AgentChatPanel, CreatePostBox, ActualProvider, useActualState, LiveAlerts, LiveChat, LiveSchedule, ProfilePage } = await import(pathToFileURL(join(temporary, "components.mjs")));
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

test("a delayed chat send never changes the room opened after sending", async (t) => {
  const chooseRoom = (renderer, title) => button(renderer, title).props.onClick();
  const messages = (renderer) => renderer.root.findAllByProps({ className: "chat-bubble" }).map((node) => node.props.children);
  const message = (id, groupId, text, clientMessageId) => ({
    id, groupId, text, clientMessageId, type: "user", sender: { id: "chat_member" }, createdAt: "2026-11-18T12:00:00Z",
  });
  const groups = ["a", "b"].map((id) => ({
    id, title: `채팅방 ${id.toUpperCase()}`, members: [{ userId: "chat_member" }], memberCount: 1, capacity: 4,
  }));
  const originalA = message("msg_a", "a", "A방 기존 메시지");
  const originalB = message("msg_b", "b", "B방 기존 메시지");
  const histories = { a: [originalA], b: [originalB] };
  let finishA;
  globalThis.testAuth = { user: { id: "chat_auth" } };
  t.mock.method(globalThis, "WebSocket", class {
    close() {}
  });
  globalThis.testApi = async (path, options) => {
    if (path === "/me") return { id: "chat_member" };
    if (path.startsWith("/festivals?")) return { items: [], total: 0 };
    if (path.startsWith("/groups?")) return { items: groups };
    const group = groups.find(({ id }) => path === `/groups/${id}`);
    if (group) return group;
    if (path === "/groups/a/messages?limit=50") return { items: histories.a };
    if (path === "/groups/b/messages?limit=50") return { items: histories.b };
    if (options?.method === "POST" && path === "/groups/a/messages") {
      return new Promise((resolve) => {
        finishA = () => {
          const saved = message("msg_saved_a", "a", options.body.text, options.body.clientMessageId);
          histories.a.push(saved);
          resolve(saved);
        };
      });
    }
    if (options?.method === "POST" && path === "/groups/b/messages") {
      return message("msg_saved_b", "b", options.body.text, options.body.clientMessageId);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const renderer = await mount(h(LiveChat), "/chat?groupId=a");
  t.after(() => act(async () => renderer.unmount()));
  const submit = async (text) => {
    await act(async () => change(renderer, "채팅 메시지", text));
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  };

  await submit("A방 새 메시지");
  assert.deepEqual(messages(renderer), ["A방 기존 메시지", "A방 새 메시지"]);
  await act(async () => chooseRoom(renderer, "채팅방 B"));
  assert.deepEqual(messages(renderer), ["B방 기존 메시지"]);
  await act(async () => finishA());
  assert.deepEqual(messages(renderer), ["B방 기존 메시지"]);
  await submit("B방 새 메시지");
  assert.deepEqual(messages(renderer), ["B방 기존 메시지", "B방 새 메시지"]);
  await act(async () => chooseRoom(renderer, "채팅방 A"));
  assert.deepEqual(messages(renderer), ["A방 기존 메시지", "A방 새 메시지"]);
});

test("late group and schedule responses cannot replace the selected group's schedule", async (t) => {
  globalThis.testAuth = { user: { id: "schedule_auth" } };
  const group = (id, title) => ({
    id, title, leaderId: "schedule_user", status: "open", memberCount: 1, capacity: 4,
    members: [{ userId: "schedule_user", role: "leader", user: { displayName: "일정 모임장" } }],
  });
  const groups = [group("a", "모임 A"), group("b", "모임 B"), group("c", "모임 C")];
  const schedule = (letter) => ({ items: [{ label: `${letter} 일정`, time: "15:00" }] });
  let finishA;
  let finishC;
  const draftRequests = [];
  globalThis.testApi = async (path) => {
    if (path === "/me") return { id: "schedule_user" };
    if (path.startsWith("/groups?")) return { items: groups, total: groups.length };
    if (path === "/groups/a") return groups[0];
    if (path === "/groups/a/schedule") return new Promise((resolve) => { finishA = () => resolve(schedule("A")); });
    if (path === "/groups/b") return groups[1];
    if (path === "/groups/b/schedule") return schedule("B");
    if (path === "/groups/c") return new Promise((resolve) => { finishC = () => resolve(groups[2]); });
    if (path === "/groups/c/schedule") return schedule("C");
    if (path.startsWith("/workflow/groups/")) {
      draftRequests.push(path);
      return { runId: "schedule_run", status: "waiting_approval" };
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const renderer = await mount(h(LiveSchedule, { festivals: [] }), "/schedules?groupId=a");
  t.after(() => act(async () => renderer.unmount()));
  const select = (id) => act(async () => change(renderer, "모임 변경", id));
  await select("c");
  await select("b");
  assert.match(JSON.stringify(renderer.toJSON()), /B 일정/);
  await act(async () => { finishA(); finishC(); });
  assert.equal(textOf(renderer.root.findByType("h3").props.children), "모임 B모집 중");
  assert.match(JSON.stringify(renderer.toJSON()), /B 일정/);
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /[AC] 일정/);
  await act(async () => button(renderer, "AI 일정 초안 만들기").props.onClick());
  assert.deepEqual(draftRequests, ["/workflow/groups/b/schedule"]);
});

test("chat can open a member's group from the second page of a 101-group list", async (t) => {
  globalThis.testAuth = { user: { id: "paged_chat_auth" } };
  t.mock.method(globalThis, "WebSocket", class { close() {} });
  const groups = Array.from({ length: 101 }, (_, i) => ({
    id: `grp_${i + 1}`, title: `모임 ${i + 1}`, memberCount: 1, capacity: 4,
  }));
  const pages = [];
  globalThis.testApi = async (path) => {
    if (path === "/me") return { id: "paged_chat_member" };
    if (path.startsWith("/festivals?")) return { items: [], total: 0 };
    if (path.startsWith("/groups?")) {
      const page = Number(new URL(path, "http://test").searchParams.get("page") || "1");
      pages.push(page);
      return { items: groups.slice((page - 1) * 100, page * 100), total: groups.length };
    }
    if (path === "/groups/grp_101/messages?limit=50") return { items: [] };
    const group = groups.find(({ id }) => path === `/groups/${id}`);
    if (group) return { ...group, members: group.id === "grp_101" ? [{ userId: "paged_chat_member" }] : [] };
    throw new Error(`Unexpected request: ${path}`);
  };
  const renderer = await mount(h(LiveChat), "/chat?groupId=grp_101");
  t.after(() => act(async () => renderer.unmount()));
  assert.deepEqual(pages, [1, 2]);
  assert.ok(renderer.root.findByProps({ "aria-label": "채팅 메시지" }));
});

test("alert settings reflect saves from both profile and alerts after reopening", async (t) => {
  globalThis.testAuth = { user: { id: "risk_settings_auth" } };
  let riskAlert = false;
  const group = {
    id: "grp_risk", title: "알림 모임", leaderId: "risk_settings_user", memberCount: 1, capacity: 4,
    members: [{ userId: "risk_settings_user", role: "leader", user: { displayName: "모임장" } }],
  };
  globalThis.testApi = async (path, options) => {
    if (path === "/me") return { id: "risk_settings_user", notificationConsent: { riskAlert } };
    if (path.startsWith("/groups?")) return { items: [group], total: 1 };
    if (path === "/groups/grp_risk") return group;
    if (path === "/groups/grp_risk/schedule" || path.startsWith("/alerts?")) return { items: [], total: 0 };
    if (path === "/me/notification-consents" && options.method === "PATCH") {
      riskAlert = options.body.riskAlert;
      return { riskAlert };
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const renderer = await mount(h(LiveAlerts, { festivals: [] }), "/alerts");
  t.after(() => act(async () => renderer.unmount()));
  const open = (element) => act(async () => renderer.update(h(MemoryRouter, null, element)));
  const riskSwitch = () => renderer.root.findByProps({ role: "switch", "aria-label": "내 악천후 알림 받기" });

  assert.equal(riskSwitch().props["aria-checked"], false);
  await open(h(ProfilePage));
  await act(async () => button(renderer, "악천후 알림 받기").props.onClick());
  assert.equal(riskAlert, true);
  await open(h(LiveAlerts, { festivals: [] }));
  assert.equal(riskSwitch().props["aria-checked"], true);
  await act(async () => riskSwitch().props.onClick());
  assert.equal(riskAlert, false);
  await open(h(ProfilePage));
  assert.equal(button(renderer, "악천후 알림 받기").props["aria-pressed"], false);
  await open(h(LiveAlerts, { festivals: [] }));
  assert.equal(riskSwitch().props["aria-checked"], false);
});

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
  const state = initialState();
  globalThis.testAuth = { session: null, user: null, loading: false };
  globalThis.testDemo = { state,
    active: () => true, person: () => ({}), fieldProps: () => ({}), btn: () => null,
    pill: () => null, pageHead: () => null, mutate: () => {} };
  globalThis.testApi = async () => ({ items: [], total: 0 });
  const renderer = await mount(h(MatchingPage));
  assert.match(JSON.stringify(renderer.toJSON()), /등록된 축제가 없어요/);
  assert.equal(renderer.root.findAllByType("textarea").length, 0);
  assert.equal(renderer.root.findAllByType("form").length, 0);
  await act(async () => renderer.unmount());
});

test("the actual UI provider persists filters and matching inputs without demo data", async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  let ui;
  function Probe() { ui = useActualState(); return null; }
  const renderer = await mount(h(ActualProvider, null, h(Probe)), "/festivals");
  await act(async () => ui.fieldProps("filter-keyword").onChange({ target: { value: "부산" } }));
  await act(async () => ui.fieldProps("match-cap").onChange({ target: { value: "4" } }));
  await act(async () => ui.dispatch("month:11"));
  await act(async () => ui.dispatch("calDay:2026-11-20"));
  assert.equal(ui.state.keyword, "부산");
  assert.equal(ui.state.profile.party, 4);
  assert.equal(ui.state.calDay, "2026-11-20");
  const persisted = JSON.parse(storage.get("festamate_ui_v1"));
  assert.equal(persisted.keyword, "부산");
  assert.equal(persisted.profile.party, 4);
  assert.equal("festivals" in persisted, false);
  assert.equal("groups" in persisted, false);
  await act(async () => renderer.unmount());
  delete globalThis.localStorage;
});

test("live matching still loads API festivals and sends selected date, time and party size", async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  globalThis.testAuth = { session: null, user: null, loading: false };
  const calls = [];
  globalThis.testApi = async (path, options) => {
    calls.push({ path, ...options });
    if (path.startsWith("/festivals?")) return { items: [{ id: festival.id, name: festival.name,
      startDate: festival.start, endDate: festival.end, status: "upcoming", riskStatus: "normal", region: "부산", category: "음악" }], total: 1 };
    if (path === "/matching/runs") return { runId: "matching_live", festivalId: festival.id, candidates: [] };
    throw new Error(`Unexpected request: ${path}`);
  };
  function Harness() { globalThis.testDemo = useActualState(); return h(MatchingPage); }
  const renderer = await mount(h(ActualProvider, null, h(Harness)));
  assert.ok(renderer.root.findByProps({ id: "match-festival" }).findAllByType("option").some((option) => textOf(option.props.children).includes("실제 축제")));
  await act(async () => renderer.root.findByProps({ id: "match-festival" }).props.onChange({ target: { value: festival.id } }));
  await act(async () => renderer.root.findByProps({ id: "match-date" }).props.onChange({ target: { value: "2099-11-20" } }));
  await act(async () => renderer.root.findByProps({ id: "match-start" }).props.onChange({ target: { value: "15:00" } }));
  await act(async () => renderer.root.findByProps({ id: "match-cap" }).props.onChange({ target: { value: "4" } }));
  await act(async () => button(renderer, "이 조건으로 매칭하기").props.onClick());
  const request = calls.find((c) => c.path === "/matching/runs");
  assert.equal(request.body.festivalId, festival.id);
  assert.equal(request.body.conditions.date, "2099-11-20");
  assert.equal(request.body.conditions.startTime, "15:00");
  assert.equal(request.body.conditions.partySize, 4);
  await act(async () => renderer.unmount());
  delete globalThis.localStorage;
});

test("weather simulation still asks for consent and resumes to alternative festivals", async () => {
  globalThis.testAuth = { user: { id: "weather_auth" } };
  const calls = [];
  const weather = { data: { date: "2099-11-20", weatherCode: 61, precipitationProbability: 90 }, source: "simulation", mode: "simulation" };
  globalThis.testApi = async (path, options) => {
    calls.push({ path, ...options });
    if (path === "/me") return { id: "leader", notificationConsent: { riskAlert: true } };
    if (path.startsWith("/groups?")) return { items: [{ id: "grp_1", leaderId: "leader", festivalId: festival.id, title: "실제 모임" }] };
    if (path.startsWith("/alerts?")) return { items: [] };
    if (path === "/groups/grp_1") return { id: "grp_1", festivalId: festival.id, memberCount: 1, capacity: 4, members: [] };
    if (path === "/groups/grp_1/schedule") return { items: [{ date: "2099-11-20", time: "15:00", endTime: "16:00", label: "축제 관람" }] };
    if (path.endsWith("/weather-check")) return { weather, risk: true };
    if (path.endsWith("/weather-review")) return { weatherCheck: { weather, risk: true, isTest: true },
      run: { runId: "wx_run", checkpointId: "cp_1", status: "waiting_input", interrupt: { type: "weather_confirmation", message: "비가 오는데 괜찮으세요?" } } };
    if (path === "/agents/runs/wx_run/resume") return { status: "completed", weatherDecision: "alternatives",
      candidate: { items: [{ id: "alternative", name: "대체 축제", startDate: "2099-11-19", endDate: "2099-11-22" }] } };
    throw new Error(`Unexpected request: ${path}`);
  };
  const renderer = await mount(h(LiveAlerts, { festivals: [festival] }));
  await act(async () => button(renderer, "비 예보 만들기").props.onClick());
  assert.equal(calls.find((c) => c.path.endsWith("/weather-review")).body.simulateRisk, true);
  assert.match(JSON.stringify(renderer.toJSON()), /그래도 이 축제로 진행할까요/);
  await act(async () => button(renderer, "아니요, 대체 축제 추천").props.onClick());
  assert.equal(calls.find((c) => c.path.endsWith("/resume")).body.weatherDecision, "alternatives");
  assert.match(JSON.stringify(renderer.toJSON()), /대체 축제/);
  await act(async () => renderer.unmount());
});
