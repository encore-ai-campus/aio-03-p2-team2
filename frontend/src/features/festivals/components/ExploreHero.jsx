import { useEffect, useState } from "react";

// 실제 행사 데이터와 분리된 서비스 소개용 콘셉트 이미지.
const SLIDES = [
  {
    id: "discover", label: "새로운 즐거움의 발견", image: "/festivals/hero/fireworks.jpg",
    title: ["익숙한 주말을,", "새로운 축제로."],
    description: "지역의 분위기를 느끼고 새로운 즐거움을 발견해보세요.",
    button: "축제 둘러보기",
  },
  {
    id: "calendar", label: "내 일정에 맞는 축제", image: "/festivals/hero/garden.jpg",
    title: ["갈 수 있는 날부터,", "가고 싶은 축제를."],
    description: "지역과 날짜를 살펴보고 나에게 맞는 축제를 골라보세요.",
    button: "날짜로 찾아보기",
  },
  {
    id: "match", label: "함께라서 더 즐거운 순간", image: "/festivals/hero/companions.jpg",
    title: ["가고 싶은 축제,", "함께 갈 사람까지."],
    description: "원하는 일정과 조건을 바탕으로 동행을 찾아보세요.",
    button: "동행 찾기 시작하기",
  },
];

export default function ExploreHero({ btn, onExplore, onCalendar }) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const playing = !paused && !hovered && !focused && !hidden && !reducedMotion;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setReducedMotion(media.matches);
    const onVisibility = () => setHidden(document.hidden);
    media.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      media.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % SLIDES.length), 5000);
    return () => window.clearTimeout(timer);
  }, [index, playing]);

  const move = (next) => setIndex((next + SLIDES.length) % SLIDES.length);

  return (
    <section
      className="fx-hero-banner"
      aria-label="축제와 동행 서비스 안내"
      aria-roledescription="캐러셀"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="fx-hero-track" style={{ transform: "translateX(-" + index * 100 + "%)" }}>
        {SLIDES.map((slide, i) => (
          <div
            className="fx-hero-slide"
            key={slide.id}
            aria-hidden={i !== index}
            inert={i !== index}
            role="group"
            aria-roledescription="슬라이드"
            aria-label={(i + 1) + " / " + SLIDES.length + ": " + slide.label}
          >
            <img className="fx-hero-photo" src={slide.image} alt="" width="2172" height="724" fetchPriority={i === 0 ? "high" : "low"} decoding="async" />
            <div className="fx-hero-content">
              <span className="fx-hero-label">{slide.label}</span>
              <h1>{slide.title.join(" ")}</h1>
              <p>{slide.description}</p>
              <div className="fx-hero-actions">
                {slide.id === "match" ? btn(slide.button, "nav:match", "btn primary") : (
                  <button type="button" className="btn primary"
                    aria-controls={slide.id === "calendar" ? "fx-hero-results" : "fx-hero-explore"}
                    onClick={slide.id === "calendar" ? onCalendar : onExplore}>
                    {slide.button}<i className="ti ti-arrow-down" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="fx-hero-arrow fx-hero-prev" aria-label="이전 축제" onClick={() => move(index - 1)}>
        <i className="ti ti-chevron-left" aria-hidden="true" />
      </button>
      <button type="button" className="fx-hero-arrow fx-hero-next" aria-label="다음 축제" onClick={() => move(index + 1)}>
        <i className="ti ti-chevron-right" aria-hidden="true" />
      </button>
      <div className="fx-hero-controls">
        <div className="fx-hero-dots">
          {SLIDES.map((slide, i) => (
            <button key={slide.id} type="button" className="fx-hero-dot"
              aria-label={(i + 1) + "번째 배너: " + slide.label}
              aria-current={i === index ? "true" : "false"} onClick={() => move(i)} />
          ))}
        </div>
        <span className="fx-hero-count" aria-hidden="true">{index + 1} / {SLIDES.length}</span>
        {!reducedMotion && <button type="button" className="fx-hero-play" aria-label={paused ? "배너 자동 넘김 재생" : "배너 자동 넘김 정지"}
          onClick={() => setPaused((value) => !value)}>
          <i className={paused ? "ti ti-player-play" : "ti ti-player-pause"} aria-hidden="true" />
        </button>}
      </div>
    </section>
  );
}
