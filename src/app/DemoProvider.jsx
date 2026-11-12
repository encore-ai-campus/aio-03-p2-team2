import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { NAV, STORAGE_KEY, clone, defaults } from "../shared/data/demoData.js";
import { createDemoModel } from "../shared/lib/demoModel.js";
import { PageHeading } from "../shared/components/PageHeading.jsx";
import { FestivalCard } from "../features/festivals/components/FestivalCard.jsx";
import { GroupCard } from "../features/groups/components/GroupCard.jsx";
import { GroupDetail } from "../features/groups/components/GroupDetail.jsx";
import { Timeline } from "../features/schedules/components/Timeline.jsx";
import { NewGroupModal } from "../features/groups/components/NewGroupModal.jsx";
import { Button, Pill, Toast } from "../shared/components/Primitives.jsx";
const Context = createContext(null);
export const paths = {
  discover: "/festivals",
  match: "/matching",
  community: "/groups",
  room: "/chat",
  schedule: "/schedules",
  alerts: "/alerts",
  team: "/team",
};
export const useDemo = () => useContext(Context);
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (
      saved &&
      Array.isArray(saved.groups) &&
      saved.profile &&
      Array.isArray(saved.festivals) &&
      saved.festivals.length
    ) {
      const base = defaults();
      const aiChat = { ...base.aiChat, ...(saved.aiChat || {}), open: false, busy: false };
      aiChat.messages = (aiChat.messages || []).filter((m) => m.type !== "typing");
      return {
        ...base,
        ...saved,
        modal: false,
        aiChat,
      };
    }
  } catch (error) {
    console.warn("저장된 데모 데이터를 읽을 수 없습니다.", error);
  }
  return defaults();
}
export function DemoProvider({ children }) {
  const [stored, setStored] = useState(restore);
  const [draftFields, setDraftFields] = useState({});
  const [message, setMessage] = useState("");
  const timer = useRef();
  const latest = useRef(stored);
  latest.current = stored;
  const uploadRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const page =
    Object.keys(paths).find((key) => paths[key] === location.pathname) ||
    (location.pathname === "/" ? stored.page : "discover");
  const state = {
    ...stored,
    page,
    selectedGroup: stored.selectedGroup || stored.groups[0]?.id || null,
  };
  const notify = useCallback((text) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 3000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...stored,
          page,
          modal: false,
        }),
      );
    } catch (error) {
      notify("브라우저 저장 공간이 부족하거나 저장이 제한되어 있습니다.");
      console.warn(error);
    }
  }, [stored, page, notify]);
  useEffect(() => {
    if (!stored.modal) return;
    const close = (event) => {
      if (event.key === "Escape")
        setStored((current) => ({
          ...current,
          modal: false,
        }));
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [stored.modal]);
  const fields = {
    "filter-keyword": state.keyword,
    "filter-status": state.status,
    "filter-region": state.region,
    "filter-category": state.category,
    "match-festival": state.festivalId,
    "match-start": state.profile.start,
    "match-budget": state.profile.budget,
    "match-style": state.profile.style,
    "match-cap": state.profile.party,
    "match-joinmode": state.profile.joinMode,
    "schedule-group": state.selectedGroup || state.groups[0]?.id || "",
    "weather-festival": state.weather.festivalId,
    "new-title": "주말 축제 같이 가실 분 🙌",
    "new-festival": state.festivalId,
    "new-cap": 4,
    "new-mode": "approval",
    "new-post": "안녕하세요! 공개 댓글에서 먼저 인사하고, 함께 축제를 즐겨요.",
    "comment-input": "",
    "chat-input": "",
    ...draftFields,
  };
  function navigatePage(next) {
    navigate(paths[next] || paths.discover);
  }
  const options = {
    notify,
    navigate: navigatePage,
    fields,
    openUpload: () => uploadRef.current?.click(),
    pill: (text, cls) => <Pill variant={cls}>{text}</Pill>,
  };
  const model = createDemoModel(state, options);
  function dispatch(action) {
    const next = clone(state);
    createDemoModel(next, options).handle(action);
    setStored(next);
    if (["comment", "createGroup", "newGroup", "reset"].includes(action))
      setDraftFields({});
  }
  // 비동기 흐름(챗봇 응답 대기 등)용: 항상 최신 상태를 복제해 변경한다.
  function mutate(fn) {
    const current = latest.current;
    const next = clone({
      ...current,
      selectedGroup: current.selectedGroup || current.groups[0]?.id || null,
    });
    fn(next, createDemoModel(next, options));
    latest.current = next;
    setStored(next);
  }
  function fieldProps(id) {
    return {
      value: fields[id] ?? "",
      onChange: (event) => {
        const value = event.target.value;
        const filterKeys = {
          "filter-keyword": "keyword",
          "filter-status": "status",
          "filter-region": "region",
          "filter-category": "category",
        };
        const profileKeys = {
          "match-start": "start",
          "match-budget": "budget",
          "match-style": "style",
          "match-cap": "party",
          "match-joinmode": "joinMode",
        };
        if (filterKeys[id])
          setStored((current) => ({
            ...current,
            [filterKeys[id]]: value,
          }));
        else if (profileKeys[id])
          setStored((current) => ({
            ...current,
            profile: {
              ...current.profile,
              [profileKeys[id]]: ["match-budget", "match-cap"].includes(id)
                ? Number(value)
                : value,
            },
          }));
        else if (id === "match-festival")
          setStored((current) => ({
            ...current,
            festivalId: value,
            matchingDone: false,
          }));
        else if (id === "schedule-group")
          setStored((current) => ({
            ...current,
            selectedGroup: value,
          }));
        else if (id === "weather-festival")
          setStored((current) => ({
            ...current,
            weather: {
              festivalId: value,
              choice: null,
              type: null,
            },
          }));
        else
          setDraftFields((current) => ({
            ...current,
            [id]: value,
          }));
      },
      ...(id === "comment-input"
        ? {
            onKeyDown: (event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                dispatch("comment");
              }
            },
          }
        : {}),
    };
  }
  function submitChat(event) {
    event.preventDefault();
    const text = fields["chat-input"].trim();
    const g = model.group(state.selectedGroup);
    if (!g?.members.includes(state.actor)) {
      notify("모임 참여자만 채팅할 수 있어요.");
      return;
    }
    if (!text) return;
    setStored((current) => ({
      ...current,
      groups: current.groups.map((row) =>
        row.id === g.id
          ? {
              ...row,
              chat: [
                ...row.chat,
                {
                  userId: current.actor,
                  text,
                  at: new Date().toISOString(),
                },
              ],
            }
          : row,
      ),
    }));
    setDraftFields((current) => ({
      ...current,
      "chat-input": "",
    }));
  }
  async function importFestivals(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data)
        ? data
        : data.items || data.festivals || data.response?.body?.items?.item;
      if (!Array.isArray(list))
        throw Error('JSON은 배열 또는 {"festivals":[...]} 형식이어야 합니다.');
      const festivals = [
        ...new Map(
          list
            .map(model.normalizeFestival)
            .filter(Boolean)
            .map((f) => [f.id, f]),
        ).values(),
      ];
      if (!festivals.length)
        throw Error("2026년의 유효한 축제 데이터가 없습니다.");
      if (
        !window.confirm(
          `2026년 축제 ${festivals.length}건을 불러오고 현재 데모 모임을 초기화할까요?`,
        )
      )
        return;
      setStored((current) => ({
        ...current,
        festivals,
        source: "사용자가 가져온 JSON",
        groups: [],
        selectedGroup: null,
        festivalId: (festivals.find(model.active) || festivals[0]).id,
        weather: {
          type: null,
          choice: null,
          festivalId: festivals[0].id,
        },
        matchingDone: false,
        month: 0,
        status: "all",
        region: "all",
        category: "all",
        keyword: "",
      }));
      setDraftFields({});
      navigatePage("discover");
      notify(`2026 축제 ${festivals.length}건 가져오기 완료`);
    } catch (error) {
      notify(`축제 가져오기 오류: ${error.message}`);
    }
  }
  const demo = {
    ...model,
    state,
    NAV,
    dispatch,
    mutate,
    notify,
    fieldProps,
    submitChat,
    btn: (text, action, cls = "btn") => (
      <Button
        className={cls}
        data-action={action}
        onClick={() => dispatch(action)}
      >
        {text}
      </Button>
    ),
    pill: (text, cls = "") => <Pill variant={cls}>{text}</Pill>,
    actorProps: {
      value: state.actor,
      onChange: (event) => {
        setStored((current) => ({
          ...current,
          actor: event.target.value,
        }));
        setDraftFields({});
      },
    },
  };
  demo.pageHead = (kicker, title, desc, actions) => (
    <PageHeading kicker={kicker} title={title} desc={desc} actions={actions} />
  );
  demo.fCard = (f) => <FestivalCard key={f.id} demo={demo} f={f} />;
  demo.roomCard = (g) => <GroupCard key={g.id} demo={demo} g={g} />;
  demo.roomDetail = (g) => <GroupDetail demo={demo} g={g} />;
  demo.timeline = (items) => <Timeline demo={demo} items={items} />;
  demo.newGroupModal = () => <NewGroupModal demo={demo} />;
  return (
    <Context.Provider value={demo}>
      {children}
      {state.modal && demo.newGroupModal()}
      <Toast message={message} />
      <input
        id="json-upload"
        aria-label="2026 축제 JSON 가져오기"
        ref={uploadRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={importFestivals}
      />
    </Context.Provider>
  );
}
