export function PageHeading({ kicker, title, desc, actions = "" }) {
  return (
    <>
      <div className="eyebrow">{kicker}</div>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p>{desc}</p>
        </div>
        {actions ? (
          <>
            <div className="btnrow">{actions}</div>
          </>
        ) : (
          ""
        )}
      </div>
    </>
  );
}
