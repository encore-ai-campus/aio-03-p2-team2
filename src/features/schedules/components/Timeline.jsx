import { Fragment } from "react";
export function Timeline({ items }) {
  return (
    <>
      <div className="timeline">
        {items.map((x, index) => (
          <Fragment key={index}>
            <div className="timeline-row">
              <span className="time">{x.time}</span>
              <strong>{x.label}</strong>
              <p>{x.desc}</p>
            </div>
          </Fragment>
        ))}
      </div>
    </>
  );
}
