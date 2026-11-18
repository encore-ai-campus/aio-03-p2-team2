// 사이트 푸터 — 실제 서비스형(문의 / 링크 묶음 / 약관 줄 / 팀·데이터 출처)
// 가짜 사업자번호·전화번호는 넣지 않는다. 준비 중인 링크는 글자만 표시.
import { Link } from "react-router-dom";

const Soon = ({ children }) => <span className="ft-soon" title="준비 중">{children}</span>;

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="ft-in">
        <div className="ft-top">
          <div className="ft-cs">
            <h5>문의</h5>
            <div className="ft-mail">fesroam.team@example.com</div>
            <div>평일 오전 10시 ~ 오후 6시 답변 (주말·공휴일 제외)</div>
            <div className="ft-btns">
              <Soon><i className="ti ti-message" aria-hidden="true" />1:1 문의</Soon>
              <Soon><i className="ti ti-help-circle" aria-hidden="true" />자주 묻는 질문</Soon>
            </div>
          </div>
          <div>
            <h5>서비스</h5>
            <ul>
              <li><Link to="/festivals">축제 탐색</Link></li>
              <li><Link to="/matching">AI 동행 매칭</Link></li>
              <li><Link to="/groups">동행 커뮤니티</Link></li>
              <li><Link to="/alerts">AI 알림·대안</Link></li>
            </ul>
          </div>
          <div>
            <h5>안내</h5>
            <ul>
              <li><Soon>공지사항</Soon></li>
              <li><Link to="/#flow">이용 방법</Link></li>
              <li><Soon>안전한 동행 가이드</Soon></li>
              <li><Soon>신고하기</Soon></li>
            </ul>
          </div>
          <div>
            <h5>팀</h5>
            <ul>
              <li><Soon>팀 소개</Soon></li>
              <li><Soon>GitHub</Soon></li>
              <li><Soon>문의·제휴</Soon></li>
            </ul>
          </div>
        </div>
        <div className="ft-bot">
          <div className="ft-links">
            <Soon>이용약관</Soon>
            <Soon><b>개인정보처리방침</b></Soon>
            <Soon>위치기반서비스 이용약관</Soon>
            <Soon>커뮤니티 운영정책</Soon>
          </div>
          <div className="ft-info">
            페스로움(Fesroam)<span className="sep">|</span>팀 삼각김박<span className="sep">|</span>AIO 3기 단위 프로젝트 2<br />
            축제 정보 한국관광공사 TourAPI<span className="sep">|</span>날씨 정보 Open-Meteo<br />
            페스로움은 축제 동행을 연결하는 서비스로, 이용자 간 만남과 축제 운영에 대한 책임은 각 이용자와 주최 측에 있습니다.
          </div>
          <div className="ft-row">
            <img src="/brand/fesroam_logo_horizontal.png" alt="" />
            <div className="ft-sns">
              <Soon><i className="ti ti-brand-instagram" aria-label="인스타그램" /></Soon>
              <Soon><i className="ti ti-brand-github" aria-label="GitHub" /></Soon>
            </div>
          </div>
          <div className="ft-copy">© 2026 Fesroam. All rights reserved.</div>
        </div>
      </div>
    </footer>
  );
}
