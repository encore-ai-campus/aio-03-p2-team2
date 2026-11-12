import { Fragment } from "react";
import { Button, Modal } from "../../../shared/components/Primitives.jsx";
export function NewGroupModal({ demo }) {
  const { state, btn, fieldProps, dispatch, active } = demo;
  const options = state.festivals.filter(active);
  return (
    <>
      <div
        className="modal-backdrop"
        data-action="closeModal"
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          dispatch("closeModal");
        }}
      >
        <Modal
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="새 모임 생성"
        >
          <div className="modal-head">
            <h2>공개 모임 직접 만들기</h2>
            <Button
              className="close"
              data-action="closeModal"
              aria-label="닫기"
              onClick={(event) => {
                dispatch("closeModal");
              }}
            >
              ×
            </Button>
          </div>
          <p className="sm muted">
            첫 게시글 작성자가 모임장이 돼요. 채팅 입장은 선택한 방식에 따라
            달라져요.
          </p>
          <div className="field">
            <label htmlFor="new-title">모임 제목</label>
            <input id="new-title" maxLength="70" {...fieldProps("new-title")} />
          </div>
          <div className="field">
            <label htmlFor="new-festival">축제</label>
            <select id="new-festival" {...fieldProps("new-festival")}>
              {options.map((f, index) => (
                <Fragment key={index}>
                  <option value={f.id}>{f.name}</option>
                </Fragment>
              ))}
            </select>
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="new-cap">모집 정원</label>
              <select id="new-cap" {...fieldProps("new-cap")}>
                {[2, 3, 4, 5, 6, 8].map((n, index) => (
                  <Fragment key={index}>
                    <option value={n}>{n}명</option>
                  </Fragment>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="new-mode">참여 방식</label>
              <select id="new-mode" {...fieldProps("new-mode")}>
                <option value="approval">모임장 승인</option>
                <option value="instant">즉시 참여</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="new-post">공개 모집 글</label>
            <textarea
              id="new-post"
              maxLength="1200"
              {...fieldProps("new-post")}
            />
          </div>
          <div
            className="btnrow"
            style={{
              justifyContent: "flex-end",
            }}
          >
            {btn("취소", "closeModal", "btn")}
            {btn("게시글 + 모임방 생성", "createGroup", "btn primary")}
          </div>
        </Modal>
      </div>
    </>
  );
}
