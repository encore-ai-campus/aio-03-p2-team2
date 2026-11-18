// 데모(예시 데이터) 화면을 쓸지 정하는 스위치
// 기본은 꺼짐: 서버 연결이 안 되면 데모로 몰래 바꾸지 않고 「연결 안 됨」을 보여 준다.
// 켜는 법: .env 에 VITE_DEMO_MODE=true  또는  주소 뒤에 ?demo=1 (이 탭에서 계속 유지, ?demo=0 으로 끔)
const KEY = "festamate.demoMode";

function readFlag() {
  try {
    const q = new URLSearchParams(window.location.search).get("demo");
    if (q === "1" || q === "true") sessionStorage.setItem(KEY, "1");
    if (q === "0" || q === "false") sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const DEMO_MODE = import.meta.env?.VITE_DEMO_MODE === "true" || readFlag();
