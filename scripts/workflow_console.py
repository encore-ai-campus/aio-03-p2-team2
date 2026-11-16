"""Guided, interactive workflow console. Default: isolated demo, no shared DB."""
import argparse
import asyncio
from contextlib import AsyncExitStack
from datetime import date
from getpass import getpass
import sys

import httpx
from pydantic import ValidationError

from app.features.agents.schemas import Conditions


class ConsoleExit(Exception):
    pass


class APIProblem(Exception):
    pass


class Terminal:
    def write(self, text=""): print(text, flush=True)

    def read(self, prompt, default=None, secret=False):
        suffix = f" [Enter={default}]" if default is not None else ""
        try:
            value = (getpass if secret else input)(f"{prompt}{suffix}\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            raise ConsoleExit from None
        if value.lower() in {"/exit", "/quit"}:
            raise ConsoleExit
        return value if value else default or ""

    def required(self, prompt, default=None, secret=False):
        while True:
            value = self.read(prompt, default, secret)
            if value: return value
            self.write("빈 값은 사용할 수 없습니다. 안내된 값을 입력하세요. 종료는 /exit입니다.")

    def choice(self, prompt, choices, default=None):
        while True:
            value = self.read(f"{prompt} ({'/'.join(choices)})", default).lower()
            if value in choices: return value
            self.write("입력 가능한 값: " + ", ".join(choices))

    def select(self, prompt, items, label):
        for index, item in enumerate(items, 1): self.write(f"  {index}. {label(item)}")
        while True:
            value = self.required(f"{prompt}: 1~{len(items)} 중 번호 하나를 입력하세요", "1")
            if value.isdecimal() and 1 <= int(value) <= len(items): return items[int(value)-1]
            self.write("목록에 표시된 번호를 입력하세요.")

    def day(self, prompt, default=None):
        while True:
            value = self.required(f"{prompt} (YYYY-MM-DD, 예: 2030-05-10)", default)
            try:
                if date.fromisoformat(value).isoformat() != value: raise ValueError
                return value
            except ValueError: self.write("날짜는 YYYY-MM-DD 형식으로 입력하세요.")

    def time(self, prompt, default=None):
        while True:
            value = self.required(f"{prompt} (HH:mm, 예: 15:00)", default)
            try:
                Conditions(start_time=value)
                return value
            except ValidationError: self.write("시간은 00:00~23:59의 HH:mm 형식으로 입력하세요.")


class WorkflowConsole:
    def __init__(self, client, terminal, *, accounts=None, demo_model=None):
        self.client, self.io = client, terminal
        self.accounts = accounts or {}
        self.demo_model = demo_model
        self.created = {}

    async def api(self, method, path, actor=None, body=None, params=None):
        headers = {"Authorization":f"Bearer {self.accounts[actor]['token']}"} if actor else {}
        try:
            response = await self.client.request(method, path, headers=headers, json=body, params=params)
        except httpx.RequestError:
            raise APIProblem("서버 응답을 받지 못했습니다. 서버 주소와 실행 상태를 확인하세요. 쓰기 요청은 처리되었을 수 있습니다.") from None
        try:
            payload = response.json()
        except ValueError:
            raise APIProblem(f"HTTP {response.status_code}: JSON API 응답이 아닙니다. 주소와 /api/v1 경로를 확인하세요.") from None
        if not response.is_success:
            error = payload.get("error") or {}
            code = error.get("code", "API_ERROR")
            guidance = {
                "AUTH_USER_NOT_LINKED":"Supabase 가입 계정과 앱 사용자의 연결/가입 트리거를 확인하세요.",
                "AUTH_TOKEN_INVALID":"토큰이 만료되었거나 유효하지 않습니다. 새 로그인으로 콘솔을 다시 시작하세요.",
                "AUTH_INVALID_CREDENTIALS":"이메일·비밀번호와 이메일 인증 완료 여부를 확인하세요.",
                "CHECKPOINT_STALE":"다른 요청이 실행을 변경했습니다. 최신 runId를 조회해 다시 진행하세요.",
                "PROPOSAL_ALREADY_PENDING":"기존 초안을 먼저 승인·거절한 뒤 다시 시도하세요.",
                "FESTIVAL_UNAVAILABLE":"DB 등록 여부, 운영 날짜·시간, 취소 상태를 확인하세요.",
                "SIMULATION_DEVELOPMENT_ONLY":"운영 서버에서는 모의 날씨를 사용할 수 없습니다. 실제 날씨 확인을 선택하세요.",
            }.get(code, "")
            raise APIProblem(f"HTTP {response.status_code} {code}: {error.get('message','요청 실패')} {guidance}".strip())
        return payload.get("data")

    async def retry(self, operation):
        while True:
            try: return await operation()
            except APIProblem as exc:
                self.io.write(f"[요청 오류] {exc}")
                if self.io.choice("같은 요청을 다시 보낼까요? 쓰기 요청의 경우 중복 처리 여부를 먼저 확인하세요", ["retry","exit"]) == "exit":
                    raise ConsoleExit

    async def login(self, actor):
        self.io.write(f"\n[계정 {actor}] {'모임장' if actor == 'A' else '참여 신청자'} 계정입니다.")
        if actor in self.accounts:
            self.io.write("격리 데모 계정의 시험 JWT를 사용합니다. 실제 회원가입·로그인은 호출하지 않습니다.")
            return
        while True:
            method = self.io.choice("인증 방법을 입력하세요", ["login","signup","token"], "login")
            if method == "token":
                token = self.io.required("Supabase access_token을 붙여 넣으세요. 입력은 화면에 표시되지 않습니다", secret=True)
                self.accounts[actor] = {"token":token.removeprefix("Bearer ")}
            else:
                email = self.io.required("이메일 주소를 입력하세요 (예: tester@example.com)")
                password = self.io.required("비밀번호를 입력하세요 (6자 이상, 화면에 표시되지 않음)", secret=True)
                body = {"email":email,"password":password}
                if method == "signup": body["displayName"] = self.io.required("표시 이름을 입력하세요 (20자 이내)")
                try:
                    result = await self.api("POST", f"/api/v1/auth/{method}", body=body)
                except APIProblem as exc:
                    self.io.write(str(exc)); continue
                session = result.get("session") or result
                token = session.get("access_token")
                if not token:
                    self.io.write("가입 요청이 완료되었습니다. 이메일 인증을 마친 뒤 login을 선택하세요.")
                    continue
                self.accounts[actor] = {"token":token}
            try:
                me = await self.api("GET", "/api/v1/me", actor)
                if any(account.get("id") == me["id"] for name, account in self.accounts.items() if name != actor):
                    self.io.write("계정 A와 B는 서로 다른 계정이어야 합니다.")
                    del self.accounts[actor]; continue
                self.accounts[actor]["id"] = me["id"]
                return
            except APIProblem as exc:
                self.io.write(str(exc)); self.accounts.pop(actor, None)

    async def prepare_profile(self, actor):
        me = await self.retry(lambda: self.api("GET", "/api/v1/me", actor))
        self.io.write(f"사용자: {me.get('displayName',actor)} / 앱 사용자 ID: {me['id']}")
        available = self.io.time("이 계정이 참여 가능한 시작 시간을 입력하세요. 프로필에 저장됩니다",
            (me.get("profile") or {}).get("availableFrom") or "15:00")
        await self.retry(lambda: self.api("PATCH", "/api/v1/me/profile", actor, {"availableFrom":available}))
        if self.io.choice("이 계정의 악천후 앱 알림 수신을 켤까요? 프로필 동의 설정에 반영됩니다", ["y","n"], "y") == "y":
            await self.retry(lambda: self.api("PATCH", "/api/v1/me/notification-consents", actor, {"riskAlert":True}))

    async def explore(self):
        page = 1
        keyword = self.io.read("축제 검색어를 입력하세요. Enter는 전체 목록입니다")
        while True:
            result = await self.retry(lambda: self.api("GET", "/api/v1/festivals", params={"status":"available","keyword":keyword,"page":page,"pageSize":10}))
            items = result["items"]
            self.io.write(f"\n축제 목록 {page}페이지 / 전체 {result['total']}개")
            if items:
                action = self.io.choice("목록 선택, 다음 페이지, 검색어 변경 중 하나를 입력하세요", ["select","next","search"], "select")
                if action == "select":
                    festival = self.io.select("축제 선택", items, lambda item:f"{item['name']} | {item['startDate']}~{item['endDate']} | {item['id']}")
                    return await self.retry(lambda: self.api("GET", f"/api/v1/festivals/{festival['id']}"))
                if action == "next":
                    if page*10 < result["total"]: page += 1
                    else: self.io.write("마지막 페이지입니다.")
                    continue
            else: self.io.write("조건에 맞는 축제가 없습니다.")
            keyword = self.io.read("새 검색어를 입력하세요. Enter는 전체 목록입니다")
            page = 1

    def show_plan(self, value):
        if not value:
            self.io.write("  일정 없음"); return
        items = value.get("items") or ([value["current"]] if value.get("current") else [])
        for item in items:
            self.io.write(f"  {item.get('date','')} {item.get('time','')}~{item.get('endTime','미정')} | {item.get('label','')}")

    def show_comparison(self, run):
        comparison = run.get("comparison") or {}
        self.io.write("\n[변경 전: 기존 일정]")
        self.show_plan(comparison.get("before"))
        for index, attempt in enumerate(run.get("candidateHistory", []), 1):
            self.io.write(f"[후보 {index} / iteration={attempt['iteration']}]")
            self.show_plan(attempt.get("candidate"))
            for error in attempt.get("errors", []): self.io.write(f"  검증 실패: {error['code']} — {error['message']}")
            if attempt.get("repair"): self.io.write(f"  수정 전략: {attempt['repair']['action']} — {attempt['repair'].get('reason','')}")
        self.io.write("[변경 후: 현재 초안 / 승인 전에는 미반영]")
        self.show_plan(comparison.get("after"))

    async def drive(self, run):
        while True:
            self.created["lastRunId"] = run["runId"]
            self.io.write(f"\n[에이전트] {run['status']} / runId={run['runId']}")
            for error in run.get("errors", []): self.io.write(f"  {error['code']}: {error['message']}")
            if run["status"] not in {"waiting_input", "waiting_approval"}: return run
            payload = {"checkpointId":run["checkpointId"]}
            if run["status"] == "waiting_approval":
                self.show_comparison(run)
                payload["decision"] = self.io.choice("모임장 A의 일정 결정: approve=확정, reject=거절, cancel=취소", ["approve","reject","cancel"])
            else:
                question = run["interrupt"]
                self.io.write("에이전트 질문: " + question["message"])
                missing = question.get("missing", [])
                if missing == ["startTime"]:
                    answer = self.io.required("시작 시간을 답하세요. 예: 오후 3시부터 가능해 / 15:00. 현재 실행 취소는 /cancel")
                    if answer == "/cancel": payload["decision"] = "cancel"
                    elif len(answer) == 5 and answer[2] == ":":
                        try: payload["answers"] = Conditions(start_time=answer).model_dump(mode="json", by_alias=True, exclude_none=True)
                        except ValidationError:
                            self.io.write("시간이 올바르지 않습니다. 예: 15:00"); continue
                    else: payload["message"] = answer
                else:
                    action = self.io.choice("text=자연어 답변, fields=조건 직접 입력, cancel=현재 실행 취소", ["text","fields","cancel"], "text")
                    if action == "cancel": payload["decision"] = "cancel"
                    elif action == "text": payload["message"] = self.io.required("답변을 입력하세요. 예: 2030년 5월 10일 오후 3시, 비를 피하고 싶어요")
                    else:
                        fields = {}
                        if "groupId" in missing: payload["groupId"] = self.io.required("모임 ID를 입력하세요 (grp_로 시작하는 실제 ID)")
                        if "festivalId" in missing: payload["festivalId"] = self.io.required("축제 ID를 입력하세요 (조회한 실제 ID)")
                        fields["date"] = self.io.day("참여 날짜", run["conditions"].get("date"))
                        fields["startTime"] = self.io.time("시작 시간", run["conditions"].get("start_time") or "15:00")
                        payload["answers"] = fields
            run_id = run["runId"]
            run = await self.retry(lambda: self.api("POST", f"/api/v1/agents/runs/{run_id}/resume", "A", payload))

    async def run(self):
        await self.retry(lambda: self.api("GET", "/health"))
        self.io.write("\n1/9 모임장 A와 참여자 B 계정 준비")
        await self.login("A"); await self.prepare_profile("A")
        self.io.write("매칭 후보에 포함될 수 있도록 계정 B의 프로필을 미리 준비합니다. 참여 신청은 5단계에서 진행합니다.")
        await self.login("B"); await self.prepare_profile("B")
        self.io.write("\n2/9 축제 탐색")
        festival = await self.explore()
        while True:
            day = self.io.day("축제에 참여할 날짜를 입력하세요", festival["startDate"])
            if festival["startDate"] <= day <= festival["endDate"]: break
            self.io.write(f"이 축제 운영 기간 {festival['startDate']}~{festival['endDate']} 안의 날짜를 입력하세요.")
        self.io.write("\n3/9 챗봇 매칭 — 되묻기를 보려면 시간 없이 요청하세요")
        message = self.io.required("매칭 요청을 자유롭게 입력하세요. 예: 이 축제에 같이 갈 동행 찾아줘", "이 축제에 같이 갈 동행 찾아줘")
        run = await self.retry(lambda: self.api("POST", "/api/v1/agents/runs", "A",
            {"message":message,"intent":"matching","festivalId":festival["id"],"conditions":{"date":day}}))
        run = await self.drive(run)
        candidates = (run.get("candidate") or {}).get("items", [])
        if run["status"] != "completed" or not candidates:
            self.io.write("매칭이 완료되지 않았거나 후보가 없습니다. 조건·후보 프로필을 확인하고 다시 실행하세요.")
            return
        self.io.write("\n[매칭 후보]")
        for index,item in enumerate(candidates,1): self.io.write(f"  {index}. {item.get('displayName') or (item.get('user') or {}).get('displayName') or item.get('userId',item.get('id','후보'))} | 점수 {item.get('score','미제공')}")
        if self.io.choice("후보를 확인했습니다. 모집글을 만들까요?", ["y","n"], "y") == "n": return
        self.io.write("\n4/9 모집글 생성")
        title = self.io.required("모집글 제목 (1~45자)", "[터미널 테스트] 축제 동행")
        while len(title) > 45: title = self.io.required("45자 이내 제목을 다시 입력하세요")
        post = self.io.required("모집글 내용 (1~2000자)", "조건이 맞는 분과 함께 축제에 가요.")
        while len(post) > 2000: post = self.io.required("2000자 이내 내용을 다시 입력하세요")
        capacity = int(self.io.choice("모임 정원을 입력하세요", [str(value) for value in range(2,9)], "4"))
        result = await self.retry(lambda: self.api("POST", f"/api/v1/workflow/matching/{run['runId']}/group", "A", {"title":title,"postBody":post,"capacity":capacity}))
        group = result["group"]; gid = group["id"]; self.created["groupId"] = gid
        self.io.write(f"모집글 생성 완료 / groupId={gid}")
        self.io.write("\n5/9 다른 계정 B로 참여 신청")
        self.io.write("현재 요청 계정을 B로 전환합니다.")
        request_message = self.io.required("참여 신청 메시지를 입력하세요", "함께 참여하고 싶어요.")
        result = await self.retry(lambda: self.api("POST", f"/api/v1/groups/{gid}/join-requests", "B", {"message":request_message}))
        self.created["joinRequestId"] = result["id"]
        self.io.write(f"참여 신청 완료 / requestId={result['id']}")
        self.io.write("\n6/9 계정 A로 돌아가 참여 신청 승인")
        requests = await self.retry(lambda: self.api("GET", f"/api/v1/groups/{gid}/join-requests", "A", params={"status":"pending"}))
        application = next(item for item in requests["items"] if item["id"] == result["id"])
        self.io.write(f"신청자 {application['userId']} / 메시지: {application.get('message','')}")
        if self.io.choice("참여를 승인할까요?", ["approve","exit"]) == "exit": return
        group = await self.retry(lambda: self.api("GET", f"/api/v1/groups/{gid}", "A"))
        await self.retry(lambda: self.api("POST", f"/api/v1/groups/{gid}/join-requests/{application['id']}/approve", "A", {"version":group["version"]}))
        self.io.write("참여 승인 완료. 다음은 참여 승인이 아닌 일정 초안 승인입니다.")
        self.io.write("\n7/9 공동 일정 생성 → 검증·자가 수정 → 모임장 승인")
        if self.demo_model:
            if self.io.choice("자가 수정 재현을 위해 첫 일정 후보에 시험용 시간 오류를 넣을까요? 격리 데모에만 적용됩니다", ["y","n"], "y") == "y":
                self.demo_model.inject_next_error = True
                self.io.write("[시험 조건] 첫 후보에만 00:00 오류를 주입합니다. 이후 실제 검증·성찰·재생성 그래프가 처리합니다.")
        run = await self.drive(await self.retry(lambda: self.api("POST", f"/api/v1/workflow/groups/{gid}/schedule", "A", {})))
        if run["status"] != "completed":
            self.io.write("일정이 확정되지 않아 여기서 중단합니다. 표시된 runId로 상태를 확인할 수 있습니다."); return
        self.io.write("\n8/9 악천후 알림 확인")
        kind = self.io.choice("simulate=개발용 악천후 재현, actual=현재 설정의 날씨 조회", ["simulate","actual"], "simulate" if self.demo_model else "actual")
        weather = await self.retry(lambda: self.api("POST", f"/api/v1/workflow/groups/{gid}/weather-check", "A", {"simulateRisk":kind == "simulate"}))
        self.io.write(f"위험={weather['risk']} / 새 알림={weather['createdAlertCount']} / 날씨 출처={weather['weather']['mode']}")
        for actor in ("A","B"):
            alerts = await self.retry(lambda: self.api("GET", "/api/v1/alerts", actor))
            group_alerts = [item for item in alerts["items"] if item.get("groupId") == gid]
            self.io.write(f"계정 {actor} 모임 알림: {len(group_alerts)}개")
            for alert in group_alerts: self.io.write(f"  {alert['title']} — {alert['message']}")
        self.io.write("\n9/9 대체 축제 선택 → 기존/새 일정 비교 → 승인")
        if self.io.choice("대체 축제를 추천받을까요?", ["y","n"], "y") == "n": return
        risk = await self.drive(await self.retry(lambda: self.api("POST", f"/api/v1/workflow/groups/{gid}/risk-response", "A")))
        alternatives = (risk.get("candidate") or {}).get("items", [])
        if risk["status"] != "completed" or not alternatives:
            self.io.write("현재 조건의 대체 후보가 없습니다. 원본 일정은 유지됩니다."); return
        while True:
            selected = self.io.select("대체 축제 선택", alternatives, lambda item:f"{item['name']} | {item['startDate']}~{item['endDate']} | {item['id']}")
            target_day = self.io.day("대체 축제 참여 날짜", day if selected["startDate"] <= day <= selected["endDate"] else selected["startDate"])
            if not selected["startDate"] <= target_day <= selected["endDate"]:
                self.io.write("대체 축제 운영 기간 안의 날짜를 입력하세요."); continue
            try:
                run = await self.api("POST", f"/api/v1/workflow/risk-runs/{risk['runId']}/select", "A", {"festivalId":selected["id"],"conditions":{"date":target_day}})
                break
            except APIProblem as exc:
                self.io.write(str(exc))
                if self.io.choice("다른 후보를 선택할까요?", ["y","n"], "y") == "n": return
        run = await self.drive(run)
        self.io.write(f"\n전체 워크플로우 마지막 상태: {run['status']}")
        group = await self.retry(lambda: self.api("GET", f"/api/v1/groups/{gid}", "A"))
        self.io.write(f"최종 연결 축제: {group['festivalId']}")

    def summary(self):
        if self.created:
            self.io.write("\n[이번 실행 리소스]")
            for key,value in self.created.items(): self.io.write(f"  {key}: {value}")


async def console(args, terminal=None):
    io = terminal or Terminal()
    io.write("FestaMate 전체 워크플로우 대화형 콘솔 | 언제든 /exit 또는 Ctrl+C로 종료")
    async with AsyncExitStack() as stack:
        accounts = None
        model = None
        if args.mode == "demo":
            if args.provider == "openai":
                from app.core.config import Settings
                settings = Settings()
                if not settings.openai_api_key or not settings.openai_api_key.get_secret_value().strip() or not settings.openai_model:
                    io.write(".env에 OPENAI_API_KEY와 OPENAI_MODEL을 설정하세요. API 없이 연습하려면 --provider rules를 사용하세요.")
                    return 2
            from scripts.workflow_sandbox import make_sandbox
            app, accounts, model, weather = make_sandbox(args.provider)
            await stack.enter_async_context(app.router.lifespan_context(app))
            app.state.weather_monitor = weather
            client = await stack.enter_async_context(httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sandbox", timeout=180))
            io.write(f"[격리 데모] 모델={args.provider}. JWT·가입·날씨·저장소는 시험용입니다. 실제 FastAPI 경로와 에이전트 그래프를 실행합니다.")
            io.write("공유 DB와 별도 서버는 사용하지 않습니다. 종료 시 시험 데이터는 사라집니다.")
            if args.provider == "openai": io.write("OpenAI는 실제 API를 호출하므로 비용이 발생합니다.")
        else:
            client = await stack.enter_async_context(httpx.AsyncClient(base_url=args.base_url, timeout=180, follow_redirects=False))
            io.write(f"[실제 API] {args.base_url} / 가입·프로필·모집글·신청·승인 결과가 서버 DB에 저장됩니다.")
            io.write("서버의 모델·날씨 설정을 사용합니다. 테스트할 두 계정을 준비하세요.")
        workflow = WorkflowConsole(client, io, accounts=accounts, demo_model=model)
        try:
            await workflow.run()
        except ConsoleExit:
            io.write("\n콘솔을 종료합니다.")
        finally:
            workflow.summary()
    return 0


def main():
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        for stream in (sys.stdin, sys.stdout, sys.stderr):
            if hasattr(stream, "reconfigure"): stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="축제 탐색·대화 매칭·모집글·두 계정 참여·날씨·대체 일정 전체 테스트")
    parser.add_argument("--mode", choices=["demo","live"], default="demo", help="demo=격리 시험(기본), live=실행 중인 실제 API")
    parser.add_argument("--provider", choices=["rules","openai"], default="rules", help="demo 모드 모델. live는 서버 설정 사용")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="live 모드 API 서버 주소")
    args = parser.parse_args()
    try:
        return asyncio.run(console(args))
    except (KeyboardInterrupt, ConsoleExit):
        print("\n콘솔을 종료합니다."); return 0
    except Exception as exc:
        # Never print SDK/settings exception payloads that may contain credentials.
        print(f"실행 실패 ({type(exc).__name__}). 서버·모델 설정을 확인하세요.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
