import {
  BASE_PROFILES,
  INIT_GROUPS,
  clone,
  defaults,
} from "../data/demoData.js";

// These are browser-only simulation rules. Each action receives a cloned state
// from DemoProvider; no network request or external service is invoked here.
export function createDemoModel(
  state,
  { notify, navigate, fields, openUpload, pill },
) {
  const field = (id) => ({
    value: fields[id] ?? "",
  });
  const nav = (page) => {
    state.page = page;
    state.modal = false;
    navigate(page);
  };
  const festival = (id) =>
    state.festivals.find((f) => f.id === id) || state.festivals[0];
  const group = (id) => state.groups.find((g) => g.id === id);
  const person = (id) => BASE_PROFILES[id] || BASE_PROFILES.guest;
  const today = () => {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
  };
  const status = (f) =>
    f.end < today() ? "past" : f.start <= today() ? "live" : "upcoming";
  const active = (f) => status(f) !== "past";
  const statusPill = (f) =>
    status(f) === "past"
      ? pill("기간 종료", "dark")
      : status(f) === "live"
        ? pill("진행 중 · 참여 가능", "green")
        : pill("참여 가능", "green");
  const dateShort = (v) => (v || "").slice(5).replace("-", ".");
  const period = (f) => `${dateShort(f.start)} ~ ${dateShort(f.end)}`;
  const groupClosed = (g) =>
    g.members.length >= g.max || !active(festival(g.festivalId));
  const countPending = () =>
    state.groups
      .filter((g) => g.leader === state.actor)
      .reduce((n, g) => n + g.pending.length, 0);
  const newId = (prefix) =>
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    Math.floor(Math.random() * 1e5).toString(36);
  const hhmm = (m) =>
    String(Math.floor(m / 60)).padStart(2, "0") +
    ":" +
    String(m % 60).padStart(2, "0");
  const toMin = (v) => {
    const [h, m] = String(v || "00:00")
      .split(":")
      .map(Number);
    return h * 60 + m;
  };
  const clock = () =>
    new Date().toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const formatDate = (iso) => {
    let d = new Date(iso);
    return Number.isNaN(+d)
      ? iso
      : new Intl.DateTimeFormat("ko-KR", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(d);
  };
  // v4.2 캘린더: 선택한 달(전체 선택 시 오늘이 속한 달, 2026년 밖이면 1월)
  function calMonth() {
    if (state.month) return state.month;
    const t = today();
    return t.startsWith("2026-") ? +t.slice(5, 7) : 1;
  }
  function candidateScore(p, f, me = BASE_PROFILES.me) {
    const pr = state.profile || defaults().profile;
    const myInterests =
      me.id === state.actor ? pr.interests : me.interests || [];
    const budget = me.id === state.actor ? +pr.budget : +me.budget;
    const style = me.id === state.actor ? pr.style : me.style;
    const size = me.id === state.actor ? +pr.party : +me.party;
    const mbti = me.id === state.actor ? pr.mbti : [me.mbti];
    const start = me.id === state.actor ? pr.start : me.start;
    const values = {
      일정:
        (p.available.includes(f.id) ? 1 : 0.4) *
        (Math.abs(toMin(start) - toMin(p.start)) <= 180 ? 1 : 0.65),
      관심사: myInterests.length
        ? myInterests.filter((x) => p.interests.includes(x)).length /
          myInterests.length
        : 1,
      예산: Math.max(0, 1 - Math.abs(budget - p.budget) / 10),
      스타일: style === p.style ? 1 : 0.35,
      MBTI: !mbti.length ? null : mbti.includes(p.mbti) ? 1 : 0.2,
      인원: Math.max(0, 1 - Math.abs(size - p.party) / 5),
    };
    const weights = {
      일정: 25,
      관심사: 20,
      예산: 20,
      스타일: 15,
      MBTI: 10,
      인원: 10,
    };
    let numerator = 0,
      denom = 0;
    for (let k in values) {
      if (values[k] !== null) {
        numerator += weights[k] * values[k];
        denom += weights[k];
      }
    }
    return {
      score: Math.max(0, Math.min(100, Math.round((numerator / denom) * 100))),
      parts: Object.fromEntries(
        Object.entries(values).map(([k, v]) => [
          k,
          v === null ? "미선택" : Math.round(weights[k] * v) + "/" + weights[k],
        ]),
      ),
    };
  }
  const meetupScore = (commenterId, festivalId) =>
    commenterId === state.actor
      ? 100
      : candidateScore(
          person(commenterId),
          festival(festivalId),
          person(state.actor),
        ).score;
  const log = (g, kind, text) =>
    g.logs.push({
      kind,
      text,
      at: clock(),
    });
  function checkSchedule(g, trigger = "신규 참여") {
    const available = Math.max(
      ...g.members.map((id) => toMin(person(id).start)),
    );
    const first = toMin(g.schedule[0].time);
    log(
      g,
      "done",
      `NODE validate_capacity · ${g.members.length}/${g.max}명, 정원 ${g.max}`,
    );
    log(g, "done", `NODE availability_fetch · 최신 참여자별 가능 시각 확인`);
    if (first < available) {
      g.conflict = {
        required: hhmm(available),
        current: g.schedule[0].time,
        reason: `새 참여자의 시작 가능 시각은 ${hhmm(available)}인데 기존 만남은 ${g.schedule[0].time}입니다.`,
        trigger,
      };
      g.proposal = null;
      log(
        g,
        "warn",
        `NODE validate_timeline · 시간 충돌! ${g.schedule[0].time} → ${hhmm(available)} 이후 필요`,
      );
      log(
        g,
        "warn",
        "NODE reflection · 원래 계획을 확정하지 않고 대안 일정 재생성 요청",
      );
      pushSystem(
        g,
        "⚠️ 새 참여자 승인으로 일정 충돌이 감지되었습니다. 모임장 확인을 기다립니다.",
      );
    } else {
      g.conflict = null;
      g.proposal = null;
      log(g, "done", "NODE validate_timeline · 모든 참여자 일정 검증 통과");
      pushSystem(g, "✅ 새 참여자 포함 전체 일정 검증이 완료되었습니다.");
    }
  }
  function pushSystem(g, text) {
    g.chat.push({
      type: "system",
      text,
      at: new Date().toISOString(),
    });
  }
  function makeProposal(g) {
    if (!g?.conflict) return false;
    const need = toMin(g.conflict.required),
      newMeet = Math.max(need, toMin(g.schedule[0].time));
    let proposed = [
      {
        ...g.schedule[0],
        time: hhmm(newMeet),
      },
      {
        ...g.schedule[1],
        time: hhmm(Math.max(newMeet + 30, toMin(g.schedule[1].time))),
      },
      {
        ...g.schedule[2],
        time: hhmm(Math.max(newMeet + 210, toMin(g.schedule[2].time))),
      },
    ];
    if (proposed.some((x) => toMin(x.time) >= 22 * 60)) {
      log(
        g,
        "warn",
        "NODE verify_proposal · 축제 운영 예상 범위를 벗어나 다시 조정해야 합니다.",
      );
      notify(
        "제안이 늦은 밤을 초과합니다. 실서비스 운영시간 API 검증이 필요합니다.",
      );
      return false;
    }
    g.proposal = proposed;
    log(
      g,
      "done",
      `NODE propose_alternative · ${proposed[0].time} 만남 / ${proposed[1].time} 입장`,
    );
    log(
      g,
      "done",
      `NODE self_validate · ${g.members.length}명 가능 시각 재검증 통과`,
    );
    log(g, "done", "NODE human_approval · 모임장 승인 대기");
    return true;
  }
  function alternativeFestivals(f) {
    return state.festivals
      .filter((x) => active(x) && x.id !== f.id)
      .map((x) => ({
        ...x,
        similarity:
          (x.category === f.category ? 2 : 0) +
          (x.region === f.region ? 2 : 0) +
          (x.tags || []).filter((t) => (f.tags || []).includes(t)).length / 3,
        dayDistance: Math.abs(
          (new Date(x.start) - new Date(f.start)) / 86400000,
        ),
      }))
      .sort(
        (a, b) => b.similarity - a.similarity || a.dayDistance - b.dayDistance,
      )
      .slice(0, 3);
  }
  function createGroup({
    title,
    festivalId,
    max,
    joinMode,
    post,
    leader = state.actor,
  }) {
    let f = festival(festivalId),
      p = person(leader),
      start = toMin(leader === "me" ? state.profile.start : p.start);
    let meet = Math.max(10 * 60, start);
    let row = {
      id: newId("g"),
      festivalId,
      title,
      leader,
      max,
      joinMode,
      created: new Date().toISOString(),
      members: [leader],
      pending: [],
      post,
      comments: [],
      chat: [
        {
          type: "system",
          text: "모임방과 공개 커뮤니티 게시글이 생성되었습니다.",
          at: new Date().toISOString(),
        },
      ],
      schedule: [
        {
          time: hhmm(meet),
          label: `${f.city} 모임 장소에서 만남`,
          desc: "참여자 확인 및 동선 점검",
        },
        {
          time: hhmm(meet + 60),
          label: `${f.name} 입장`,
          desc: "주요 프로그램 관람",
        },
        {
          time: hhmm(Math.max(meet + 240, 17 * 60)),
          label: "식사 및 자유 일정",
          desc: "서로 선호하는 지역 식사",
        },
      ],
      conflict: null,
      proposal: null,
      logs: [
        {
          kind: "done",
          text: "NODE create_room · 공개 모집글 및 방 동시 생성",
          at: clock(),
        },
      ],
    };
    state.groups.unshift(row);
    return row;
  }
  function performMatch() {
    const f = festival(state.festivalId);
    if (!f || !active(f)) {
      notify("참여할 수 있는 축제를 선택해 주세요.");
      return;
    }
    const candidates = Object.values(BASE_PROFILES)
      .filter((p) => p.id !== state.actor && p.available.includes(f.id))
      .map((p) => ({
        id: p.id,
        ...candidateScore(p, f, person(state.actor)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    state.matchScores = candidates;
    state.matchingDone = true;
    state.matchFestivalId = f.id;
    let g = group(state.matchGroupId);
    if (!g || g.festivalId !== f.id || g.leader !== state.actor) {
      g = createGroup({
        title: `${f.name} 함께할 동행 모집 🌟`,
        festivalId: f.id,
        max: state.profile.party,
        joinMode: state.profile.joinMode,
        post: `AI 매칭으로 시작된 동행 모집입니다!\n🎪 ${f.name}\n📅 ${period(f)} · 👥 ${state.profile.party}명 정원\n함께 갈 분은 공개 댓글로 먼저 인사하고 참여를 신청해 주세요.`,
      });
    }
    state.matchGroupId = g.id;
    notify("AI 매칭 완료! 동행 모임방과 공개 게시글을 생성했습니다.");
  }
  function joinRoom(id) {
    let g = group(id);
    if (!g) return;
    if (g.members.includes(state.actor)) {
      state.selectedGroup = id;
      nav("room");
      return;
    }
    if (g.pending.includes(state.actor)) {
      notify("이미 참여 신청되어 모임장 승인을 기다리고 있어요.");
      return;
    }
    if (groupClosed(g)) {
      notify("정원 또는 축제 기간으로 인해 모집이 마감되었습니다.");
      return;
    }
    if (g.joinMode === "approval") {
      g.pending.push(state.actor);
      state.selectedGroup = id;
      notify("모임장 승인 대기 중입니다. 승인 전 채팅방은 열리지 않습니다.");
      return;
    }
    if (g.members.length >= g.max) return;
    g.members.push(state.actor);
    pushSystem(
      g,
      `${person(state.actor).name} 님이 즉시 참여했습니다. · ${g.members.length}/${g.max}명`,
    );
    checkSchedule(g, "즉시 참여");
    state.selectedGroup = id;
    nav(g.conflict ? "schedule" : "room");
    notify(
      g.conflict
        ? "입장 완료 · 기존 일정에 충돌이 있어 검증 화면으로 이동합니다."
        : "모임에 바로 참여했습니다. 이전 채팅 기록도 확인할 수 있어요.",
    );
  }
  function approveMember(g, id) {
    if (g.leader !== state.actor) {
      notify("모임장만 참여를 승인할 수 있어요.");
      return;
    }
    if (!g.pending.includes(id)) return;
    if (groupClosed(g)) {
      notify("정원 또는 축제 기간이 마감되어 승인할 수 없습니다.");
      return;
    }
    g.pending = g.pending.filter((x) => x !== id);
    g.members.push(id);
    pushSystem(
      g,
      `👤 모임장이 ${person(id).name} 님의 참여를 승인했습니다. (${g.members.length}/${g.max}명)`,
    );
    if (g.members.length >= g.max) {
      pushSystem(
        g,
        "🔒 정원이 충족되어 모집이 자동 마감되었습니다. 공개 게시글은 유지됩니다.",
      );
    }
    checkSchedule(g, "신규 승인");
    state.selectedGroup = g.id;
    nav(g.conflict ? "schedule" : "community");
    notify(
      g.conflict
        ? "참여 승인이 완료되었습니다. 일정 충돌이 발견되었습니다!"
        : "승인 및 일정 검증 완료 · 참여자가 채팅에 입장할 수 있어요.",
    );
  }
  function acceptProposal(g) {
    if (state.actor !== g.leader) {
      notify("일정 최종 승인은 모임장에게만 허용됩니다.");
      return;
    }
    if (!g.proposal) {
      notify("승인할 대안이 없어요.");
      return;
    }
    g.schedule = clone(g.proposal);
    g.conflict = null;
    g.proposal = null;
    log(g, "done", "NODE host_approval · 모임장 명시적 승인 확인");
    log(g, "done", "NODE commit_timeline · 신규 일정 반영");
    pushSystem(
      g,
      `📅 공동 일정이 변경되었습니다. 모임장 승인 완료 · 만남 ${g.schedule[0].time}, 축제 입장 ${g.schedule[1].time}, 식사 ${g.schedule[2].time}`,
    );
    log(
      g,
      "done",
      "NODE send_message · 참여자 채팅방에 일정 변경 시스템 메시지 전송",
    );
    notify("일정이 확정되었고 채팅방에 시스템 메시지가 등록되었습니다.");
  }
  function resetScenario() {
    let current = state.groups.findIndex((x) => x.id === "g2");
    if (current >= 0)
      state.groups[current] = clone(INIT_GROUPS.find((g) => g.id === "g2"));
    else state.groups.unshift(clone(INIT_GROUPS.find((g) => g.id === "g2")));
    state.selectedGroup = "g2";
    state.actor = "me";
    nav("schedule");
    notify("부산 음악축제 일정 충돌 시연 초기 상태로 복구했습니다.");
  }
  function handle(act) {
    let [kind, ...parts] = act.split(":"),
      id = parts[0];
    switch (kind) {
      case "nav":
        nav(id);
        break;
      case "month":
        state.month = +id;
        state.calDay = null;
        break;
      case "view":
        state.discoverView = id;
        break;
      case "calMove":
        state.month = Math.max(1, Math.min(12, calMonth() + +id));
        state.calDay = null;
        break;
      case "calDay":
        state.calDay = state.calDay === id ? null : id;
        break;
      case "status":
        state.status = id;
        nav("discover");
        break;
      case "festival":
        state.festivalId = id;
        state.matchingDone = false;
        if (active(festival(id))) nav("match");
        else
          notify(
            "지난 축제입니다. 아카이브 정보는 검색에서 계속 확인할 수 있습니다.",
          );
        break;
      case "interest":
        state.profile.interests = state.profile.interests.includes(id)
          ? state.profile.interests.filter((x) => x !== id)
          : [...state.profile.interests, id];
        state.matchingDone = false;
        break;
      case "mbti":
        state.profile.mbti = state.profile.mbti.includes(id)
          ? state.profile.mbti.filter((x) => x !== id)
          : [...state.profile.mbti, id];
        state.matchingDone = false;
        break;
      case "runMatch":
        performMatch();
        break;
      case "selectGroup":
        state.selectedGroup = id;
        break;
      case "openGroup":
        state.selectedGroup = id;
        nav("community");
        break;
      case "openChat":
        state.selectedGroup = id;
        nav("room");
        break;
      case "openSchedule":
        state.selectedGroup = id;
        nav("schedule");
        break;
      case "commStatus":
        state.communityStatus = id;
        break;
      case "join":
        joinRoom(id);
        break;
      case "approve":
        approveMember(group(id), parts[1]);
        break;
      case "reject": {
        let g = group(id);
        if (!g || g.leader !== state.actor) return;
        g.pending = g.pending.filter((x) => x !== parts[1]);
        pushSystem(g, `해당 참여 신청이 처리되었습니다.`);
        notify("신청을 거절했습니다.");
        break;
      }
      case "comment": {
        let el = field("comment-input"),
          text = el?.value.trim(),
          g = group(state.selectedGroup);
        if (!text) {
          notify("댓글 내용을 입력해 주세요.");
          return;
        }
        if (!g) return;
        g.comments.push({
          userId: state.actor,
          text,
          at: new Date().toISOString(),
        });
        notify("공개 댓글이 게시되었습니다.");
        break;
      }
      case "propose": {
        let g = group(id);
        if (!g || g.leader !== state.actor) {
          notify("모임장만 제안 생성 요청을 진행할 수 있어요.");
          return;
        }
        if (makeProposal(g))
          notify("AI가 모든 참여자 가능한 일정으로 대안을 생성했습니다.");
        break;
      }
      case "acceptSchedule":
        acceptProposal(group(id));
        break;
      case "demoConflict":
        state.selectedGroup = "g2";
        state.actor = "me";
        nav("community");
        notify("부산 모임의 하늘님 참여 신청을 승인해 보세요.");
        break;
      case "resetConflict":
        resetScenario();
        break;
      case "newGroup":
        state.modal = true;
        break;
      case "closeModal":
        state.modal = false;
        break;
      case "createGroup": {
        const title = field("new-title")?.value.trim(),
          festivalId = field("new-festival")?.value,
          max = +field("new-cap")?.value,
          joinMode = field("new-mode")?.value,
          post = field("new-post")?.value.trim();
        if (
          !title ||
          !post ||
          !festivalId ||
          !Number.isInteger(max) ||
          max < 2
        ) {
          notify("모임 제목·축제·모집글을 확인해 주세요.");
          return;
        }
        let g = createGroup({
          title,
          festivalId,
          max,
          joinMode,
          post,
        });
        state.modal = false;
        state.selectedGroup = g.id;
        nav("community");
        notify("공개글과 모임방이 생성되었습니다. 첫 작성자가 모임장입니다.");
        break;
      }
      case "simulate":
        state.weather = {
          type: id,
          choice: null,
          festivalId:
            field("weather-festival")?.value || state.weather.festivalId,
        };
        notify(
          id === "rain"
            ? "가상 비 예보 알림을 생성했습니다."
            : "가상 축제 취소·변경 알림을 생성했습니다.",
        );
        break;
      case "weatherAnswer":
        state.weather.choice = id;
        notify(
          id === "yes"
            ? "여행 유지 의사를 확인했습니다."
            : "축제 유형과 지역을 기준으로 대안을 찾았습니다.",
        );
        break;
      case "chooseAlternative":
        state.festivalId = id;
        state.matchingDone = false;
        nav("match");
        break;
      case "upload":
        openUpload();
        break;
      case "copySteps": {
        const text =
          "축제 탐색 → AI 동행 매칭 → 모임방 및 공개 게시글 생성 → 공개 댓글/참여 신청 → 모임장 승인 → 채팅 내역 조회 → 일정 충돌 검증 → AI 대안 생성 → 모임장 승인 → 채팅 시스템 메시지 → 악천후/취소 대안";
        navigator.clipboard
          ?.writeText(text)
          .then(() => notify("시연 단계가 복사되었습니다."))
          .catch(() => notify("브라우저 복사가 제한되었습니다."));
        break;
      }
      case "reset":
        if (
          window.confirm(
            "현재 브라우저의 모임·댓글·채팅·축제 가져오기 데이터가 초기화됩니다. 계속할까요?",
          )
        ) {
          for (const key of Object.keys(state)) delete state[key];
          Object.assign(state, defaults());
          nav("discover");
          notify("데모 초기화 완료");
        }
        break;
    }
  }
  function normalizeFestival(raw, i) {
    const start = String(raw.start || raw.startDate || raw.eventstartdate || "")
        .replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")
        .slice(0, 10),
      end = String(raw.end || raw.endDate || raw.eventenddate || start)
        .replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")
        .slice(0, 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
      start > end ||
      end < "2026-01-01" ||
      start > "2026-12-31"
    )
      return null;
    let name = String(raw.name || raw.title || "").trim();
    if (!name) return null;
    let region = String(
      raw.region ||
        raw.area ||
        raw.sido ||
        (raw.addr1 || "").split(" ")[0] ||
        "전국",
    ).trim();
    let tags = Array.isArray(raw.tags)
      ? raw.tags
      : typeof raw.tags === "string"
        ? raw.tags.split(",")
        : [];
    return {
      id: String(raw.id || raw.contentid || `api_${i}`),
      name,
      region,
      city: String(
        raw.city || raw.sigungu || (raw.addr1 || "").split(" ")[1] || "",
      ),
      start,
      end,
      category: String(raw.category || raw.type || "문화"),
      emoji: String(raw.emoji || "🎪"),
      description: String(raw.description || raw.summary || "2026 축제 정보"),
      tags,
      source: "import",
    };
  }
  return {
    festival,
    group,
    person,
    today,
    status,
    active,
    statusPill,
    dateShort,
    period,
    groupClosed,
    countPending,
    newId,
    hhmm,
    toMin,
    clock,
    formatDate,
    calMonth,
    candidateScore,
    meetupScore,
    log,
    checkSchedule,
    pushSystem,
    makeProposal,
    alternativeFestivals,
    createGroup,
    performMatch,
    joinRoom,
    approveMember,
    acceptProposal,
    resetScenario,
    handle,
    normalizeFestival,
    nav,
  };
}
