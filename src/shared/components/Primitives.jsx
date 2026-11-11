import { useEffect, useRef } from "react";
export function Button({ children, type = "button", ...props }) {
  return (
    <button type={type} {...props}>
      {children}
    </button>
  );
}

export function Card({
  as: Container = "div",
  className = "box",
  children,
  ...props
}) {
  return (
    <Container className={className} {...props}>
      {children}
    </Container>
  );
}
export function Pill({ children, variant = "" }) {
  return <span className={`pill ${variant}`}>{children}</span>;
}
export function Modal({ children, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector("button, input, select, textarea")?.focus();
    return () => previous?.focus();
  }, []);
  function trapFocus(event) {
    if (event.key !== "Tab") return;
    const controls = [
      ...ref.current.querySelectorAll(
        "button, input, select, textarea, a[href]",
      ),
    ].filter((el) => !el.disabled);
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  return (
    <div ref={ref} onKeyDown={trapFocus} {...props}>
      {children}
    </div>
  );
}
export function Toast({ message }) {
  return (
    <div
      className={`toast ${message ? "show" : ""}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
