import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import React, { useState } from "react";
import { act, create } from "react-test-renderer";
import { createPath, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(root, "tests", ".navigation-regression-"));
after(() => rm(temporary, { recursive: true, force: true }));

await build({
  stdin: { contents: `
    export { AppStateProvider } from "./src/app/AppStateProvider.jsx";
    export { default as FestivalExplorePage } from "./src/features/festivals/pages/FestivalExplorePage.jsx";
    export { default as LoginPage } from "./src/features/auth/pages/LoginPage.jsx";
    export { default as OnboardingPage } from "./src/features/auth/pages/OnboardingPage.jsx";
    export { default as RequireAuth } from "./src/features/auth/components/RequireAuth.jsx";`, resolveDir: root },
  bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
  outfile: join(temporary, "components.mjs"),
  plugins: [{ name: "network-boundary", setup(b) {
    b.onResolve({ filter: /(?:AuthProvider\.jsx|apiClient\.js)$/ }, (args) => ({ path: args.path, namespace: "network" }));
    b.onLoad({ filter: /.*/, namespace: "network" }, (args) => ({
      contents: args.path.endsWith("AuthProvider.jsx")
        ? "export const useAuth = () => globalThis.navigationAuth;"
        : "export const apiFetch = (...args) => globalThis.navigationApi(...args);",
    }));
  } }],
});
const { AppStateProvider, FestivalExplorePage, LoginPage, OnboardingPage, RequireAuth } =
  await import(pathToFileURL(join(temporary, "components.mjs")));
const h = React.createElement;

async function mount(t, element, path) {
  function Location() { return h("output", null, createPath(useLocation())); }
  let renderer;
  await act(async () => {
    renderer = create(h(MemoryRouter, { initialEntries: [path] }, element, h(Location)));
  });
  t.after(() => act(async () => renderer.unmount()));
  return renderer;
}

const destination = "/chat?groupId=grp_42#messages";

function LoginFlow({ onboarded }) {
  const [session, setSession] = useState(null);
  const login = (completed) => setSession({ user: { id: "returning-user", user_metadata: { onboarded: completed } } });
  globalThis.navigationAuth = {
    loading: false, session, user: session?.user,
    signIn: async () => { login(onboarded); return { error: null }; },
    markOnboarded: async () => login(true),
  };
  return h(Routes, null,
    h(Route, { path: "/login", element: h(LoginPage) }),
    h(Route, { path: "/festivals", element: h("div", null, "festival search") }),
    h(Route, { element: h(RequireAuth) },
      h(Route, { path: "/onboarding", element: h(OnboardingPage) }),
      h(Route, { path: "/chat", element: h("div", null, "protected chat") }),
    ),
  );
}

test("protected chat returns to the original room and anchor after login", async (t) => {
  const renderer = await mount(t, h(LoginFlow, { onboarded: true }), destination);
  assert.equal(renderer.root.findByType("output").props.children, "/login");
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(renderer.root.findByType("output").props.children, destination);
});

test("onboarding returns new users to the original room and anchor", async (t) => {
  globalThis.navigationApi = async (path) => {
    if (path === "/me") return { onboardingCompleted: false };
    assert.equal(path, "/me/onboarding/complete");
    return { onboardingCompleted: true };
  };
  const renderer = await mount(t, h(LoginFlow, { onboarded: false }), destination);
  await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(renderer.root.findByType("output").props.children, "/onboarding");
  const skip = renderer.root.findByProps({ className: "onb-skipall" });
  await act(async () => skip.props.onClick());
  assert.equal(renderer.root.findByType("output").props.children, destination);
});

test("festival search, display year and calendar use the chosen year across New Year", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 10, 18, 12) });
  const media = { matches: true, addEventListener() {}, removeEventListener() {} };
  globalThis.window = { matchMedia: () => media };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const makeFestival = (id, name, startDate, endDate) => ({
    id, name, startDate, endDate, region: "서울", category: "music", riskStatus: "normal",
  });
  const items = [
    makeFestival("november", "가을 축제", "2026-11-20", "2026-11-20"),
    makeFestival("new-year", "새해 맞이 행사", "2026-12-31", "2027-01-02"),
    makeFestival("january", "겨울 음악제", "2027-01-15", "2027-01-15"),
  ];
  globalThis.navigationApi = async (path) => {
    const year = new URL(path, "https://test.invalid").searchParams.get("year");
    const matching = year ? items.filter((f) => f.startDate <= year + "-12-31" && f.endDate >= year + "-01-01") : items;
    return { items: matching, total: matching.length };
  };
  const renderer = await mount(t, h(AppStateProvider, null, h(FestivalExplorePage)), "/festivals");
  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.localStorage;
  });
  const yearPicker = renderer.root.findAllByType("select").find((node) => node.props["aria-label"] === "축제 연도");
  assert.ok(yearPicker);
  assert.equal(yearPicker.props.value, 2026);
  await act(async () => yearPicker.props.onChange({ target: { value: "2027" } }));
  const headings = renderer.root.findAllByType("h3").map((node) => node.props.children);
  assert.equal(headings.filter((name) => name === "새해 맞이 행사").length, 1);
  assert.ok(headings.includes("겨울 음악제"));
  assert.ok(!headings.includes("가을 축제"));
  const january = renderer.root.findAllByType("button").find((node) => node.props.children === "1월");
  await act(async () => january.props.onClick());
  assert.ok(renderer.root.findAllByType("h3").some((node) => node.props.children === "겨울 음악제"));
  const calendarTab = renderer.root.findAllByType("button").find((node) => node.props.children === "📅 캘린더형");
  assert.ok(calendarTab);
  await act(async () => calendarTab.props.onClick());
  assert.ok(renderer.root.findAllByType("div").some((node) => node.props["aria-label"] === "1월 15일 축제 1건"));
  assert.ok(renderer.root.findAllByType("b").some((node) => node.props.children === "2027.01"));
});
