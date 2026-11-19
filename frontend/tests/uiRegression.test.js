import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import React from "react";
import { act, create } from "react-test-renderer";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
    export { default as NotificationDropdown } from './src/features/alerts/components/NotificationDropdown.jsx';
    export { default as LiveChat } from './src/features/chat/components/LiveChat.jsx';
    export { default as LiveSchedule } from './src/features/schedules/components/LiveSchedule.jsx';
    export { default as ProfilePage } from './src/features/auth/pages/ProfilePage.jsx';
    export { AppStateProvider as ActualProvider, useAppState as useActualState } from 'actual-app-state';
    export { default as MatchingPage } from './src/features/matching/pages/MatchingPage.jsx';
    export { default as MatchingResults } from './src/features/matching/components/MatchingResults.jsx';
    export { default as AgentChatPanel } from './src/features/matching/components/AgentChatPanel.jsx';
    export { default as CreatePostBox } from './src/features/groups/components/CreatePostBox.jsx';`, resolveDir: root },
  bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
  define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("http://test/api/v1") },
  outfile: join(temporary, "components.mjs"),
  plugins: [{ name: "test-boundaries", setup(b) {
    b.onResolve({ filter: /^actual-app-state$/ }, () => ({ path: join(root, 'src/app/AppStateProvider.jsx') }));
    b.onResolve({ filter: /^(?:react(?:\/.*)?|react-router-dom)$/ }, (args) => ({ path: args.path, external: true }));
    b.onResolve({ filter: /(?:AuthProvider|AppStateProvider|AppLayout|apiClient|supabase)\.jsx?$/ }, (args) => ({ path: args.path, namespace: "stub" }));
    b.onResolve({ filter: /(?:HomePage|FestivalExplorePage|CommunityPage|ChatPage|SchedulePage|AlertsPage|OnboardingPage|LoginPage)\.jsx$/ }, (args) => ({ path: args.path, namespace: "page" }));
    b.onLoad({ filter: /.*/, namespace: "page" }, (args) => ({ contents: `import React from 'react'; export default () => React.createElement('div', {'data-page': ${JSON.stringify(args.path.split("/").at(-1))}});` }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
      if (args.path.includes("AuthProvider")) return { contents: `export const AuthProvider = ({children}) => children; export const useAuth = () => globalThis.testAuth;` };
      if (args.path.includes("AppStateProvider")) return { contents: `export const AppStateProvider = ({children}) => children; export const useAppState = () => globalThis.testDemo;
        export const paths = {discover:'/festivals', match:'/matching', community:'/groups', room:'/chat', schedule:'/schedules', alerts:'/alerts'};` };
      if (args.path.includes("AppLayout")) return { contents: `import React from 'react'; import {Outlet} from 'react-router-dom'; export default () => React.createElement(Outlet);` };
      if (args.path.endsWith("/supabase.js")) return { contents: `export const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) } };` };
      return { contents: `export const apiFetch = (path, options) => globalThis.testApi(path, options);` };
    });
  } }],
});
const { App, MatchingPage, MatchingResults, AgentChatPanel, CreatePostBox, ActualProvider, useActualState, LiveAlerts, LiveChat, LiveSchedule, NotificationDropdown, ProfilePage } = await import(pathToFileURL(join(temporary, "components.mjs")));
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
function mockChatSocket(t, Socket = class { close() {} }) {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  t.after(() => { globalThis.WebSocket = original; });
}

const inboxAlerts = [
  { id: "approval", type: "festival_changed", status: "unread", title: "참여 신청이 승인되었습니다", message: "모임 채팅에 참여할 수 있습니다." },
  { id: "rain", type: "rain", status: "unread", title: "비 예보가 있어요" },
  { id: "answered", type: "rain", status: "answered", choice: "continue", title: "응답한 날씨 알림" },
  { id: "dismissed", type: "rain", status: "dismissed", title: "닫은 날씨 알림" },
];

test("notification preview counts only pending weather responses", async (t) => {
  globalThis.document = new EventTarget();
  globalThis.testApi = async () => ({ items: inboxAlerts });
  const renderer = await mount(h(NotificationDropdown, { userId: "inbox" }));
  t.after(async () => {
    await act(async () => renderer.unmount());
    delete globalThis.document;
  });

  const trigger = renderer.root.findByProps({ "aria-label": "AI 알림" });
  await act(async () => trigger.props.onClick());
  assert.equal(renderer.root.findByProps({ className: "gnb-badge" }).props.children, 1);
  const approval = renderer.root.findAllByType("li").find((row) => textOf(row.props.children).includes(inboxAlerts[0].title));
  assert.ok(approval);
  assert.match(textOf(approval.props.children), /안내/);
  assert.doesNotMatch(textOf(approval.props.children), /응답 대기/);
});

test("view all from the notification preview shows approval notices and weather actions", async (t) => {
  globalThis.document = new EventTarget();
  t.after(() => delete globalThis.document);
  globalThis.testAuth = { user: { id: "inbox_auth" } };
  globalThis.testApi = async (path) => {
    if (path === "/me") return { id: "inbox" };
    if (path.startsWith("/groups?")) return { items: [], total: 0 };
    if (path.startsWith("/alerts?")) return { items: inboxAlerts };
    throw new Error(`Unexpected request: ${path}`);
  };
  const renderer = await mount(h(Routes, null,
    h(Route, { path: "/", element: h(NotificationDropdown, { userId: "inbox" }) }),
    h(Route, { path: "/alerts", element: h(LiveAlerts, { festivals: [] }) }),
  ), "/");
  t.after(() => act(async () => renderer.unmount()));

  await act(async () => renderer.root.findByProps({ "aria-label": "AI 알림" }).props.onClick());
  const link = renderer.root.findByType("a");
  await act(async () => link.props.onClick({ button: 0, preventDefault() {} }));
  assert.equal(renderer.root.findByType("output").props["data-location"], "/alerts");
  const approval = renderer.root.findAllByProps({ className: "al-alert" }).find((row) => textOf(row.props.children).includes(inboxAlerts[0].title));
  assert.ok(approval);
  assert.match(textOf(approval.props.children), /모임 채팅에 참여할 수 있습니다/);
  assert.equal(approval.findAllByType("button").length, 0);
  assert.ok(button(renderer, "네, 예정대로 참여할게요"));
});

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
  mockChatSocket(t);
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

test("chat loads the page before the earliest visible message", async (t) => {
  globalThis.testAuth = { user: { id: "older_chat_auth" } };
  mockChatSocket(t);
  const group = { id: "older_room", title: "채팅방", members: [{ userId: "older_member" }] };
  const message = (id, second, text) => ({
    id, text, type: "user", sender: { id: "older_member" }, createdAt: `2026-11-18T12:00:0${second}Z`,
  });
  globalThis.testApi = async (path) => {
    if (path === "/me") return { id: "older_member" };
    if (path.startsWith("/festivals?")) return { items: [], total: 0 };
    if (path.startsWith("/groups?")) return { items: [group], total: 1 };
    if (path === "/groups/older_room") return group;
    if (path === "/groups/older_room/messages?limit=50") {
      return { items: [message("a", 2, "최근 메시지")], nextCursor: "a" };
    }
    if (path === "/groups/older_room/messages?limit=50&before=a") {
      return { items: [message("z", 1, "이전 메시지")], nextCursor: null };
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const renderer = await mount(h(LiveChat), "/chat?groupId=older_room");
  t.after(() => act(async () => renderer.unmount()));
  const load = button(renderer, "이전 메시지 불러오기");
  assert.ok(load);
  await act(async () => load.props.onClick());
  const messages = renderer.root.findAllByProps({ className: "chat-bubble" });
  assert.deepEqual(messages.map((node) => node.props.children), ["이전 메시지", "최근 메시지"]);
  assert.equal(button(renderer, "이전 메시지 불러오기"), undefined);
});

test("chat catches up across workers even when the socket stays connected", async (t) => {
  globalThis.testAuth = { user: { id: "catchup_chat_auth" } };
  t.mock.timers.enable({ apis: ["setInterval"] });
  let socket;
  mockChatSocket(t, class {
    constructor() { socket = this; }
    close() {}
  });
  const group = { id: "catchup_room", title: "채팅방", members: [{ userId: "catchup_member" }] };
  const message = (id, second, text) => ({
    id, text, type: "user", sender: { id: "catchup_member" }, createdAt: `2026-11-18T12:00:0${second}Z`,
  });
  const first = message("a", 1, "기존 메시지");
  const remote = message("b", 2, "다른 서버 메시지");
  const local = message("c", 3, "연결된 서버 메시지");
  let available = [];
  globalThis.testApi = async (path) => {
    if (path === "/me") return { id: "catchup_member" };
    if (path.startsWith("/festivals?")) return { items: [], total: 0 };
    if (path.startsWith("/groups?")) return { items: [group], total: 1 };
    if (path === "/groups/catchup_room") return group;
    if (path === "/groups/catchup_room/messages?limit=50") {
      return available.length ? { items: [local], nextCursor: local.id } : { items: [first], nextCursor: null };
    }
    if (path === "/groups/catchup_room/messages?limit=50&after=a") return { items: available, nextCursor: null };
    throw new Error(`Unexpected request: ${path}`);
  };

  const renderer = await mount(h(LiveChat), "/chat?groupId=catchup_room");
  t.after(() => act(async () => renderer.unmount()));
  const push = (event, data) => socket.onmessage({ data: JSON.stringify({ event, data }) });
  await act(async () => push("chat.connected"));
  available = [remote, local];
  await act(async () => push("chat.message.created", local));
  await act(async () => t.mock.timers.tick(5000));
  const messages = renderer.root.findAllByProps({ className: "chat-bubble" });
  assert.deepEqual(messages.map((node) => node.props.children), ["기존 메시지", "다른 서버 메시지", "연결된 서버 메시지"]);
});

test("chat reconciles a later commit with an earlier creation time", async (t) => {
  globalThis.testAuth = { user: { id: "overlap_chat_auth" } };
  t.mock.timers.enable({ apis: ["setInterval"] });
  mockChatSocket(t);
  const group = { id: "overlap_room", title: "채팅방", members: [{ userId: "overlap_member" }] };
  const message = (id, second, text) => ({
    id, text, type: "user", sender: { id: "overlap_member" }, createdAt: `2026-11-18T12:00:0${second}Z`,
  });
  const first = message("a", 1, "기존 메시지");
  const late = message("b", 2, "늦게 저장된 메시지");
  const newest = message("c", 3, "최근 메시지");
  let messages = [first];
  globalThis.testApi = async (path) => {
    if (path === "/me") return { id: "overlap_member" };
    if (path.startsWith("/festivals?")) return { items: [], total: 0 };
    if (path.startsWith("/groups?")) return { items: [group], total: 1 };
    if (path === "/groups/overlap_room") return group;
    if (path === "/groups/overlap_room/messages?limit=50") return { items: messages, nextCursor: null };
    if (path === "/groups/overlap_room/messages?limit=50&after=a") return { items: [newest], nextCursor: null };
    if (path === "/groups/overlap_room/messages?limit=50&after=c") return { items: [], nextCursor: null };
    throw new Error(`Unexpected request: ${path}`);
  };
  const renderer = await mount(h(LiveChat), "/chat?groupId=overlap_room");
  t.after(() => act(async () => renderer.unmount()));
  const bubbles = () => renderer.root.findAllByProps({ className: "chat-bubble" }).map((node) => node.props.children);
  messages = [first, newest];
  await act(async () => t.mock.timers.tick(5000));
  assert.deepEqual(bubbles(), ["기존 메시지", "최근 메시지"]);
  messages = [first, late, newest];
  await act(async () => t.mock.timers.tick(5000));
  assert.deepEqual(bubbles(), ["기존 메시지", "늦게 저장된 메시지", "최근 메시지"]);
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
  mockChatSocket(t);
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
  const riskSwitch = () => renderer.root.findByProps({ role: "switch", "aria-label": "내 비 예보 알림 받기" });

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
    // `/` = 홈: 로그인 여부·저장된 마지막 화면과 상관없이 홈을 보여 주고, 다른 화면으로 보내지 않는다
    assert.equal(renderer.root.findByType("output").props["data-location"], "/");
    assert.equal(renderer.root.findByProps({ "data-page": "HomePage.jsx" }).props["data-page"], "HomePage.jsx");
    await act(async () => renderer.unmount());
  }
  globalThis.testAuth = { session: null, loading: false };
  const renderer = await mount(h(App), "/matching");
  assert.equal(renderer.root.findByType("output").props["data-location"], "/login");
  await act(async () => renderer.unmount());
});

test("a persisted schedule draft can be approved after reopening the page", async (t) => {
  globalThis.testAuth = { user: { id: "reopen_schedule_auth" } };
  const group = { id: "reopen", title: "모임", leaderId: "reopen_leader", status: "open", capacity: 4,
    members: [{ userId: "reopen_leader", role: "leader", user: { displayName: "모임장" } }] };
  const draft = { runId: "run_reopen", status: "waiting_approval", checkpointId: "saved_checkpoint", proposalId: "prp_reopen_1",
    candidate: { items: [{ date: "2099-11-20", time: "15:00", label: "관람" }] } };
  let saved = false;
  let approved;
  globalThis.testApi = async (path, options) => {
    if (path === "/me") return { id: group.leaderId };
    if (path.startsWith("/groups?")) return { items: [group], total: 1 };
    if (path === "/groups/reopen") return group;
    if (path === "/groups/reopen/schedule") return { items: [], proposals: saved ? [{ id: draft.proposalId, status: "draft" }] : [] };
    if (path === "/groups/reopen/schedule/draft") return draft;
    if (path === "/workflow/groups/reopen/schedule") { saved = true; return draft; }
    if (path === "/agents/runs/run_reopen/resume") {
      approved = JSON.parse(JSON.stringify(options.body));
      saved = false;
      return { ...draft, status: "completed" };
    }
    throw new Error(path);
  };
  const render = () => mount(h(LiveSchedule, { festivals: [] }), "/schedules?groupId=reopen");
  const first = await render();
  await act(async () => button(first, "AI 일정 초안 만들기").props.onClick());
  await act(async () => first.unmount());
  const reopened = await render();
  t.after(() => act(async () => reopened.unmount()));
  const approve = button(reopened, "이 일정으로 확정하기");
  assert.ok(approve, "the saved draft should have an approval action");
  await act(async () => approve.props.onClick());
  assert.deepEqual(approved, { checkpointId: "saved_checkpoint", decision: "approve" });
});

test("a late weather review does not display its prompt in a different group", async (t) => {
  globalThis.testAuth = { user: { id: "weather_switch_auth" } };
  const groups = ["a", "b"].map((id) => ({ id, leaderId: "weather_switch_leader",
    festivalId: festival.id, title: "모임 " + id, members: [], capacity: 4 }));
  let finishReview;
  globalThis.testApi = async (path) => {
    if (path === "/me") return { id: groups[0].leaderId };
    if (path.startsWith("/groups?")) return { items: groups, total: 2 };
    if (path.startsWith("/alerts?")) return { items: [], total: 0 };
    if (path.endsWith("/schedule")) return { items: [{ date: "2099-11-20", time: "15:00", label: "관람" }] };
    if (path.endsWith("/weather-check")) return { weather: { data: {} }, risk: false };
    if (path === "/workflow/groups/a/weather-review") return new Promise((resolve) => { finishReview = resolve; });
    const group = groups.find((g) => path === "/groups/" + g.id);
    if (group) return group;
    throw new Error(path);
  };
  const renderer = await mount(h(LiveAlerts, { festivals: [festival] }), "/alerts");
  t.after(() => act(async () => renderer.unmount()));
  await act(async () => { button(renderer, "비 예보 만들기").props.onClick(); });
  await act(async () => renderer.root.findByType("select").props.onChange({ target: { value: "b" } }));
  await act(async () => finishReview({ weatherCheck: { weather: { data: {} }, risk: true },
    run: { runId: "a_weather_run", checkpointId: "cp_a", status: "waiting_input", interrupt: { type: "weather_confirmation" } } }));
  assert.equal(renderer.root.findByType("select").props.value, "b");
  assert.ok(!button(renderer, "아니요, 대체 축제 추천"), "A's delayed prompt should never appear under B");
});

test("the alerts page reopens a saved replacement draft for the selected group", async (t) => {
  globalThis.testAuth = { user: { id: "restore_alternative_auth" } };
  const group = { id: "replacement", title: "모임", leaderId: "replacement_leader",
    festivalId: festival.id, members: [], capacity: 4 };
  const draft = {
    runId: "run_restored_replacement", status: "waiting_approval", checkpointId: "restored_checkpoint",
    targetFestivalId: "fst_restore_target", conditions: { date: "2099-11-20" },
  };
  let decision;
  globalThis.testApi = async (path, options) => {
    if (path === "/me") return { id: group.leaderId };
    if (path.startsWith("/groups?")) return { items: [group], total: 1 };
    if (path.startsWith("/alerts?")) return { items: [], total: 0 };
    if (path === "/groups/replacement") return group;
    if (path === "/groups/replacement/schedule") return {
      items: [{ date: "2099-11-20", time: "15:00", label: "관람" }],
      proposals: [{ id: "prp_replacement_1", status: "draft" }],
    };
    if (path === "/groups/replacement/schedule/draft") return draft;
    if (path === "/festivals/fst_restore_target") return { id: "fst_restore_target", name: "복구할 축제", startDate: festival.start, endDate: festival.end };
    if (path.endsWith("/weather-check")) return { weather: { data: {} }, risk: false };
    if (path === "/agents/runs/run_restored_replacement/resume") {
      decision = JSON.parse(JSON.stringify(options.body));
      return { ...draft, status: "rejected" };
    }
    throw new Error(path);
  };
  const renderer = await mount(h(LiveAlerts, { festivals: [festival] }), "/alerts");
  t.after(() => act(async () => renderer.unmount()));
  assert.ok(renderer.root.findAllByType("h2").some((heading) => textOf(heading.props.children) === "복구할 축제로 바꾸면"));
  await act(async () => button(renderer, "기존 유지").props.onClick());
  assert.deepEqual(decision, { checkpointId: "restored_checkpoint", decision: "reject" });
});

test("alerts beyond the first page contribute to both the inbox and pending badge", async (t) => {
  globalThis.testAuth = { user: { id: "alerts_pagination_auth" } };
  const firstPage = Array.from({ length: 50 }, (_, index) => ({
    id: "notice_" + index, type: "festival_changed", status: "unread", title: "모임 안내",
  }));
  const older = { id: "older_rain", type: "rain", status: "unread", title: "오래된 비 예보" };
  let answered = false;
  globalThis.testApi = async (path) => {
    if (path === "/me") return { id: "alerts_pagination_user" };
    if (path.startsWith("/groups?")) return { items: [], total: 0 };
    if (path === "/alerts/older_rain/answer") { answered = true; return null; }
    if (path.startsWith("/alerts?")) {
      const page = Number(new URL(path, "http://test").searchParams.get("page") || "1");
      const olderAlert = answered ? { ...older, status: "answered", choice: "continue" } : older;
      return { items: page === 1 ? firstPage : [olderAlert], page, pageSize: 50, total: 51 };
    }
    throw new Error(path);
  };
  const renderer = await mount(h(React.Fragment, null,
    h(NotificationDropdown, { userId: "alerts_pagination_user" }), h(LiveAlerts, { festivals: [] }),
  ), "/alerts");
  t.after(() => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findByProps({ className: "gnb-badge" }).props.children, 1);
  assert.match(JSON.stringify(renderer.toJSON()), /오래된 비 예보/);
  await act(async () => button(renderer, "네, 예정대로 참여할게요").props.onClick());
  assert.equal(renderer.root.findByProps({ className: "gnb-badge" }).props.children, 0);
});

test("changing selected companions preserves the draft and saving sends exactly one request", async () => {
  let release;
  const calls = [];
  globalThis.testApi = (path, options) => {
    calls.push({ path, ...options });
    return new Promise((resolve) => { release = resolve; });
  };
  const renderer = await mount(h(MatchingResults, {
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

test("chatbot skips a stale demo ID and resumes with the festival and date the user picks", async () => {
  const calls = [];
  const picks = [];
  const results = [];
  globalThis.testApi = async (path, options) => {
    calls.push({ path, ...options });
    if (path === "/agents/runs") return {
      runId: "run_ask", checkpointId: "cp_festival", status: "waiting_input", interrupt: { missing: ["festivalId"], message: "축제 선택" },
    };
    if (path === "/agents/runs/run_ask/resume" && options.body.festivalId === festival.id) return {
      runId: "run_ask", checkpointId: "cp_date", status: "waiting_input", interrupt: { missing: ["date"] },
    };
    if (path === "/agents/runs/run_ask/resume" && options.body.answers?.date === "2099-11-20") return {
      runId: "run_ask", status: "completed", conditions: { date: "2099-11-20", start_time: "15:00", party_size: 3 },
      candidate: { items: [{ user: { id: "usr_candidate", displayName: "추천 동행" }, score: 90 }] },
    };
    throw new Error(`Unexpected request: ${path}`);
  };
  const renderer = await mount(h(AgentChatPanel, {
    festivals: [festival], festivalId: "f07", selectedDate: "2099-11-20",
    onPickFestival: (id) => picks.push(id), onResult: (result) => results.push(result),
  }));
  await act(async () => change(renderer, "동행 조건 입력", "동행 찾아줘"));
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(calls[0].path, "/agents/runs");
  assert.equal(calls[0].body.festivalId, undefined);
  assert.deepEqual(calls[0].body.conditions, {});
  await act(async () => button(renderer, festival.name).props.onClick());
  assert.deepEqual(picks, [festival.id]);
  assert.equal(calls[1].body.checkpointId, "cp_festival");
  await act(async () => change(renderer, "동행 조건 입력", "2099-11-20"));
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(calls[2].body.checkpointId, "cp_date");
  assert.deepEqual(calls[2].body.answers, { date: "2099-11-20" });
  assert.equal(results[0].conditions.startTime, "15:00");
  assert.equal(results[0].result.candidates[0].id, "usr_candidate");
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

test("live matching labels the time controls and sends the selected date, time and party size", async (t) => {
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
  t.after(async () => {
    await act(async () => renderer.unmount());
    delete globalThis.localStorage;
  });
  assert.ok(renderer.root.findByProps({ id: "match-festival" }).findAllByType("option").some((option) => textOf(option.props.children).includes("실제 축제")));
  await act(async () => renderer.root.findByProps({ id: "match-festival" }).props.onChange({ target: { value: festival.id } }));
  await act(async () => renderer.root.findByProps({ id: "match-date" }).props.onChange({ target: { value: "2099-11-20" } }));
  const timeControls = renderer.root.findAllByType("select");
  const hour = timeControls.find((control) => control.props.id === "match-start");
  const minute = timeControls.find((control) => control.props.id === "match-start-min");
  assert.equal(hour.props["aria-label"], "합류 가능 시각 시");
  assert.equal(minute.props["aria-label"], "합류 가능 시각 분");
  await act(async () => hour.props.onChange({ target: { value: "15" } }));
  await act(async () => minute.props.onChange({ target: { value: "20" } }));
  await act(async () => renderer.root.findByProps({ id: "match-cap" }).props.onChange({ target: { value: "4" } }));
  await act(async () => button(renderer, "이 조건으로 매칭하기").props.onClick());
  const request = calls.find((c) => c.path === "/matching/runs");
  assert.equal(request.body.festivalId, festival.id);
  assert.equal(request.body.conditions.date, "2099-11-20");
  assert.equal(request.body.conditions.startTime, "15:20");
  assert.equal(request.body.conditions.partySize, 4);
});

test("weather simulation confirms a replacement festival without changing the meeting date", async () => {
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
    if (path === "/agents/runs/wx_run/resume") return { runId: "risk_run", status: "completed", weatherDecision: "alternatives", conditions: { date: "2099-11-20" },
      candidate: { items: [{ id: "alternative", name: "대체 축제", startDate: "2099-11-19", endDate: "2099-11-22" }] } };
    if (path === "/workflow/risk-runs/risk_run/select") return {
      runId: "new_schedule", checkpointId: "cp_schedule", status: "waiting_approval",
      conditions: { date: options.body.conditions?.date ?? "2099-11-20" },
      comparison: { before: { items: [{ time: "15:00", label: "기존 관람" }] }, after: { items: [{ time: "16:00", label: "새 축제 관람" }] } },
    };
    if (path === "/agents/runs/new_schedule/resume") return {
      runId: "new_schedule", status: options.body.decision === "reject" ? "rejected" : "completed",
    };
    throw new Error(`Unexpected request: ${path}`);
  };
  const renderer = await mount(h(LiveAlerts, { festivals: [festival] }));
  await act(async () => button(renderer, "비 예보 만들기").props.onClick());
  assert.equal(calls.find((c) => c.path.endsWith("/weather-review")).body.simulateRisk, true);
  assert.match(JSON.stringify(renderer.toJSON()), /그래도 이 축제로 진행할까요/);
  await act(async () => button(renderer, "아니요, 대체 축제 추천").props.onClick());
  assert.equal(calls.find((c) => c.path.endsWith("/resume")).body.weatherDecision, "alternatives");
  assert.match(JSON.stringify(renderer.toJSON()), /대체 축제/);
  await act(async () => button(renderer, "일정 보기").props.onClick());
  assert.deepEqual(calls.find((c) => c.path.endsWith("/select")).body, { festivalId: "alternative" });
  assert.ok(renderer.root.findAllByType("p").some((paragraph) => /11\/20\([^)]*\) 기준으로 다시 만든 일정/.test(textOf(paragraph.props.children))));
  assert.match(JSON.stringify(renderer.toJSON()), /새 축제 관람/);
  await act(async () => button(renderer, "다른 축제 고르기").props.onClick());
  assert.ok(calls.some((c) => c.path === "/agents/runs/new_schedule/resume" && c.body.decision === "reject"));
  await act(async () => button(renderer, "일정 보기").props.onClick());
  await act(async () => button(renderer, "이 축제·일정으로 변경 확정").props.onClick());
  const approval = calls.find((c) => c.path === "/agents/runs/new_schedule/resume" && c.body.decision === "approve").body;
  assert.equal(approval.checkpointId, "cp_schedule");
  assert.equal(approval.decision, "approve");
  assert.match(JSON.stringify(renderer.toJSON()), /대체 축제와 새 일정으로 확정했어요/);
  await act(async () => renderer.unmount());
});

test("navigation via groupId clears the previous group's weather prompt", async (t) => {
  globalThis.testAuth = { user: { id: "pr_deeplink_auth" } };
  const groups = ["a", "b"].map((id) => ({
    id, title: `group ${id}`, leaderId: "pr_deeplink", members: [], festivalId: festival.id,
  }));
  let move;
  function Harness() {
    move = useNavigate();
    return h(LiveAlerts, { festivals: [festival] });
  }
  globalThis.testApi = async (path) => {
    if (path === "/me") return { id: "pr_deeplink" };
    if (path.startsWith("/groups?")) return { items: groups, total: 2 };
    if (path.startsWith("/alerts?")) return { items: [], total: 0 };
    if (path.endsWith("/schedule")) return { items: [{ date: "2099-11-20", time: "15:00", label: "plan" }] };
    if (path.endsWith("/weather-check")) return { risk: false, weather: { data: {} } };
    if (path === "/workflow/groups/a/weather-review") return {
      weatherCheck: { risk: true, weather: { data: {} } },
      run: { runId: "run_a", status: "waiting_input", interrupt: { type: "weather_confirmation" } },
    };
    return groups.find((group) => path === `/groups/${group.id}`);
  };
  const renderer = await mount(h(Harness), "/alerts?groupId=a");
  t.after(() => act(async () => renderer.unmount()));
  await act(async () => button(renderer, "비 예보 만들기").props.onClick());
  assert.ok(button(renderer, "아니요, 대체 축제 추천"));
  await act(async () => move("/alerts?groupId=b"));
  assert.equal(renderer.root.findByType("select").props.value, "b");
  assert.ok(!button(renderer, "아니요, 대체 축제 추천"), "group B must not show group A's prompt");
});

test("older visible notifications remain reachable when page one is dismissed", async (t) => {
  globalThis.document = new EventTarget();
  let renderer;
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    delete globalThis.document;
  });
  const hidden = Array.from({ length: 10 }, (_, index) => ({
    id: `hidden_${index}`, status: "answered", choice: "dismiss", type: "rain",
  }));
  const older = { id: "visible", status: "unread", type: "rain", title: "older alert" };
  globalThis.testApi = async (path) => {
    const params = new URL(path, "http://test").searchParams;
    if (params.get("pageSize") === "50") return { items: [...hidden, older], total: 11 };
    return { items: params.get("page") === "2" ? [older] : hidden, total: 11 };
  };
  renderer = await mount(h(NotificationDropdown, { userId: "pr_more" }));
  await act(async () => renderer.root.findByProps({ "aria-label": "AI 알림" }).props.onClick());
  const loadOlder = button(renderer, "이전 알림 더 보기");
  assert.ok(loadOlder, "hidden rows must not remove access to the next page");
  await act(async () => loadOlder.props.onClick());
  assert.ok(button(renderer, "older alert"));
});
