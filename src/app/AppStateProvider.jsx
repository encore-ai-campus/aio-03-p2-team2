import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { NAV, STORAGE_KEY, LEGACY_STORAGE_KEY, paths, restoreUiState, applyUiAction, today, calendarMonth } from "./appState.js";
import { FestivalCard } from "../features/festivals/components/FestivalCard.jsx";
import { Button, Pill, Toast } from "../shared/components/Primitives.jsx";

export { paths } from "./appState.js";
const Context = createContext(null);
export const useAppState = () => useContext(Context);

function restore() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    return current ? restoreUiState(JSON.parse(current)) : restoreUiState(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null"), true);
  } catch { return restoreUiState(null); }
}

export function AppStateProvider({ children }) {
  const [stored, setStored] = useState(restore);
  const [message, setMessage] = useState("");
  const timer = useRef();
  const latest = useRef(stored);
  latest.current = stored;
  const navigate = useNavigate();
  const location = useLocation();
  const page = Object.keys(paths).find((key) => paths[key] === location.pathname) || (location.pathname === "/" ? stored.page : "discover");
  const state = { ...stored, page };
  const notify = useCallback((text) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 3000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(restoreUiState({ ...stored, page }))); }
    catch { notify("브라우저 저장 공간이 부족하거나 저장이 제한되어 있어요."); }
  }, [stored, page, notify]);

  const mutate = useCallback((fn) => {
    const next = structuredClone(latest.current);
    fn(next);
    latest.current = next;
    setStored(next);
  }, []);
  function dispatch(action) {
    const next = applyUiAction(latest.current, action);
    latest.current = next;
    setStored(next);
    const [kind, id] = action.split(":");
    if (kind === "nav") navigate(paths[id] || paths.discover);
    if (kind === "festival") navigate(paths.match);
    if (kind === "status") navigate(paths.discover);
  }
  function fieldProps(id) {
    const filters = { "filter-keyword": "keyword", "filter-status": "status", "filter-region": "region", "filter-category": "category" };
    const profiles = { "match-start": "start", "match-budget": "budget", "match-style": "style", "match-cap": "party", "match-joinmode": "joinMode" };
    const value = filters[id] ? state[filters[id]] : profiles[id] ? state.profile[profiles[id]] : state.festivalId;
    return { value: value ?? "", onChange: (event) => {
      const input = event.target.value;
      mutate((next) => {
        if (filters[id]) next[filters[id]] = input;
        else if (profiles[id]) next.profile[profiles[id]] = ["match-budget", "match-cap"].includes(id) ? input === "" ? null : Number(input) : input;
        else if (id === "match-festival") next.festivalId = input;
      });
    } };
  }
  const status = (f) => f.end < today() ? "past" : f.start <= today() ? "live" : "upcoming";
  const ui = {
    state, NAV, dispatch, mutate, fieldProps, notify, today,
    active: (f) => status(f) !== "past", status,
    dateShort: (value) => (value || "").slice(5).replace("-", "."),
    period: (f) => `${f.start?.slice(5).replace("-", ".")} ~ ${f.end?.slice(5).replace("-", ".")}`,
    dday: (f) => status(f) === "past" ? "지난 축제" : status(f) === "live" ? "진행 중" : `D-${Math.round((new Date(f.start + "T00:00:00") - new Date(today() + "T00:00:00")) / 864e5)}`,
    calMonth: () => calendarMonth(state),
    btn: (text, action, cls = "btn") => <Button className={cls} onClick={() => dispatch(action)}>{text}</Button>,
    pill: (text, cls = "") => <Pill variant={cls}>{text}</Pill>,
  };
  ui.fCard = (festival) => <FestivalCard key={festival.id} ui={ui} f={festival} />;
  return <Context.Provider value={ui}>{children}<Toast message={message} /></Context.Provider>;
}
