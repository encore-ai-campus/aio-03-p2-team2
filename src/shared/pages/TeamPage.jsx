import { useDemo } from "../../app/DemoProvider.jsx";
export default function TeamPage() {
  const demo = useDemo();
  const { btn, pageHead } = demo;
  return (
    <>
      {pageHead(
        "PROJECT HANDOFF · V4.4 UI",
        "📋 팀 협업·노션 공유",
        "UI 기획 체크리스트와 팀원 초대 안내예요. 노션 초대 자체를 이 데모가 수행하지는 않아요.",
      )}

      <div className="two">
        <section className="box pad">
          <h2>v4.4 UI 주요 구현 항목</h2>
          <div className="request">
            <strong>✅ 축제 연간 탐색</strong>
            <span className="pill green">2026 기간 필터</span>
          </div>
          <div className="request">
            <strong>✅ AI 매칭</strong>
            <span className="pill green">가중치·MBTI 복수</span>
          </div>
          <div className="request">
            <strong>✅ 자동 모임 생성</strong>
            <span className="pill green">공개글 동시 생성</span>
          </div>
          <div className="request">
            <strong>✅ 커뮤니티</strong>
            <span className="pill green">최신순·정원·대기</span>
          </div>
          <div className="request">
            <strong>✅ 승인·즉시 참여</strong>
            <span className="pill green">채팅 권한 분리</span>
          </div>
          <div className="request">
            <strong>✅ 일정 검증·AI 대안</strong>
            <span className="pill green">모임장 최종 승인</span>
          </div>
          <div className="request">
            <strong>✅ 악천후 대안</strong>
            <span className="pill green">의사 확인·추천</span>
          </div>
          <div className="request">
            <strong>🆕 자연어 챗봇 매칭 (v4.1)</strong>
            <span className="pill green">문장 → 조건 슬롯 변환</span>
          </div>
          <div className="request">
            <strong>🆕 축제 캘린더형 보기 (v4.2)</strong>
            <span className="pill green">리스트·캘린더 전환</span>
          </div>
          <div className="request">
            <strong>🆕 UI/UX 정리 (v4.3)</strong>
            <span className="pill green">데모 컨트롤 분리</span>
          </div>
          <div className="request">
            <strong>🆕 챗봇 메인 매칭 화면 (v4.4)</strong>
            <span className="pill green">조건 설정 접기·요약</span>
          </div>
          <div
            className="note warning"
            style={{
              marginTop: "14px",
            }}
          >
            <strong>추가 백엔드 작업 필요</strong>
            {
              " · 실제 축제 전체 데이터, 인증, DB/RLS(참여자 외 채팅 차단), 실시간 채팅, LangGraph 실행, 기상 API 및 취소 공지, 알림 수신 동의"
            }
          </div>
        </section>

        <section className="box pad">
          <h2>노션 팀원 초대 방법</h2>
          <p className="sm muted">
            팀에서 정리한 요구사항과 현재 HTML을 같은 노션 페이지에 올려 공유해
            보세요.
          </p>
          <div className="timeline">
            <div className="timeline-row">
              <strong>노션에서 팀 프로젝트 페이지 열기</strong>
              <p>개인 페이지가 아닌 팀이 이용할 페이지인지 확인</p>
            </div>
            <div className="timeline-row">
              <strong>오른쪽 위 ‘공유(Share)’ 선택</strong>
              <p>동료의 이메일 주소 또는 팀 구성원 입력</p>
            </div>
            <div className="timeline-row">
              <strong>권한 설정 후 초대</strong>
              <p>
                편집자는 ‘전체 권한/편집 가능’, 열람만 할 사람은 ‘보기 가능’
              </p>
            </div>
            <div className="timeline-row">
              <strong>프로토타입 첨부</strong>
              <p>HTML 파일·요구사항·시연 시나리오를 함께 공유</p>
            </div>
          </div>
          <div className="btnrow">
            <a
              href="https://www.notion.so"
              target="_blank"
              rel="noopener noreferrer"
              className="btn primary"
            >
              노션 열기 ↗
            </a>
            {btn("시연 단계 복사", "copySteps", "btn")}
          </div>
        </section>
      </div>
    </>
  );
}
