from argparse import Namespace
from pathlib import Path
import subprocess
import sys

import httpx
import pytest

from scripts.workflow_console import APIProblem, ConsoleExit, Terminal, WorkflowConsole, console


class GuidedTerminal(Terminal):
    def __init__(self): self.output = []; self.prompts = []
    def write(self, text=""): self.output.append(text)
    def read(self, prompt, default=None, secret=False):
        self.prompts.append(prompt)
        if "시작 시간을 답하세요" in prompt: return "오후 3시부터 가능해"
        if "참여를 승인할까요" in prompt: return "approve"
        if "모임장 A의 일정 결정" in prompt: return "approve"
        if "진행 의사를 입력" in prompt: return "아니요"
        if default is not None: return default
        # Only search permits an empty default in the complete demo.
        if "검색어" in prompt: return ""
        raise AssertionError(f"Unscripted prompt: {prompt}")


@pytest.mark.asyncio
async def test_full_interactive_demo_uses_real_routes_graph_and_two_accounts():
    terminal = GuidedTerminal()
    assert await console(Namespace(mode="demo",provider="rules",base_url="http://unused"), terminal) == 0
    output = "\n".join(terminal.output)
    assert "몇 시에 참여하실 건가요?" in output
    assert "참여 신청 완료" in output
    assert "참여 승인 완료" in output
    assert "검증 실패:" in output
    assert "수정 전략: regenerate" in output
    assert "계정 A 모임 알림: 1개" in output
    assert "계정 B 모임 알림: 1개" in output
    assert "전체 워크플로우 마지막 상태: completed" in output
    assert "변경 전: 기존 일정" in output
    assert "변경 후: 현재 초안" in output
    assert "마지막 상태: completed" in output


@pytest.mark.asyncio
async def test_interactive_real_weather_then_simulation_and_alternative_coordinates(monkeypatch):
    from datetime import datetime, timedelta
    original_get = httpx.AsyncClient.get
    locations = []
    async def forecast(client, url, **kwargs):
        if url != "https://api.open-meteo.com/v1/forecast":
            return await original_get(client, url, **kwargs)
        params = kwargs["params"]
        locations.append((params["latitude"], params["longitude"]))
        stamp = datetime.fromisoformat(params["start_hour"])
        end = datetime.fromisoformat(params["end_hour"])
        times = []
        while stamp <= end:
            times.append(stamp.isoformat(timespec="minutes"))
            stamp += timedelta(hours=1)
        return httpx.Response(200, json={"hourly": {"time": times,
            "precipitation_probability": [10]*len(times), "weather_code": [1]*len(times),
            "wind_speed_10m": [2]*len(times)}})
    monkeypatch.setattr(httpx.AsyncClient, "get", forecast)
    terminal = GuidedTerminal()
    result = await console(Namespace(mode="demo",provider="rules",weather_provider="openmeteo",base_url="http://unused"), terminal)
    assert result == 0
    output = "\n".join(terminal.output)
    assert "mode=live" in output
    assert "mode=simulation" in output
    assert "전체 워크플로우 마지막 상태: completed" in output
    assert "최종 연결 축제: fst_demo_food" in output
    assert (35.1587, 129.1604) in locations
    assert (35.1532, 129.1188) in locations
    assert "계정 A 모임 알림: 1개" in output
    assert "계정 B 모임 알림: 1개" in output


@pytest.mark.asyncio
async def test_interactive_yes_keeps_original_festival():
    class KeepTerminal(GuidedTerminal):
        def read(self, prompt, default=None, secret=False):
            if "진행 의사를 입력" in prompt:
                self.prompts.append(prompt)
                return "네"
            return super().read(prompt, default, secret)
    terminal = KeepTerminal()
    assert await console(Namespace(mode="demo",provider="rules",base_url="http://unused"), terminal) == 0
    output = "\n".join(terminal.output)
    assert "그래도 이 축제로 진행할까요?" in output
    assert "대체 축제 검색은 실행하지 않았습니다" in output
    assert "최종 연결 축제: fst_demo_music" in output
    assert not any("대체 축제 선택:" in prompt for prompt in terminal.prompts)


class InputTerminal(Terminal):
    def __init__(self, answers): self.answers=iter(answers); self.output=[]
    def read(self, prompt, default=None, secret=False): return next(self.answers)
    def write(self, text=""): self.output.append(text)


def test_invalid_choices_dates_and_times_are_reprompted():
    terminal = InputTerminal(["wrong","y","2030-02-30","2030-02-28","25:00","15:00","99","2"])
    assert terminal.choice("선택", ["y","n"]) == "y"
    assert terminal.day("날짜") == "2030-02-28"
    assert terminal.time("시간") == "15:00"
    assert terminal.select("축제", ["a","b"], str) == "b"
    assert len(terminal.output) >= 4


@pytest.mark.asyncio
async def test_live_login_signup_email_verification_and_distinct_accounts():
    terminal = InputTerminal(["signup","a@example.com","hidden-password","계정 A", "login","a@example.com","hidden-password"])
    calls = []
    async def handler(request):
        calls.append(request)
        if request.url.path.endswith("signup"): return httpx.Response(201, json={"data":{"user":{"id":"auth-a"}}})
        if request.url.path.endswith("login"): return httpx.Response(200, json={"data":{"access_token":"private-token"}})
        return httpx.Response(200, json={"data":{"id":"app-a","displayName":"계정 A"}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://test") as client:
        workflow = WorkflowConsole(client, terminal)
        await workflow.login("A")
        assert workflow.accounts["A"] == {"token":"private-token","id":"app-a"}
        assert "Bearer private-token" == calls[-1].headers["Authorization"]
    output = "\n".join(terminal.output)
    assert "이메일 인증" in output
    assert "hidden-password" not in output
    assert "private-token" not in output


@pytest.mark.asyncio
async def test_network_failure_never_retries_writes_automatically():
    count = 0
    async def handler(request):
        nonlocal count
        count += 1
        raise httpx.ReadTimeout("secret-url-value", request=request)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler),base_url="http://test") as client:
        workflow = WorkflowConsole(client, InputTerminal([]))
        with pytest.raises(APIProblem) as exc:
            await workflow.api("POST", "/api/v1/groups", body={})
        assert count == 1
        assert "처리되었을 수" in str(exc.value)
        assert "secret-url-value" not in str(exc.value)


@pytest.mark.asyncio
async def test_live_second_account_rejects_same_identity():
    terminal = InputTerminal(["token","token-a","token","token-b"])
    async def handler(request):
        identity = "app-a" if request.headers["Authorization"] == "Bearer token-a" else "app-b"
        return httpx.Response(200, json={"data":{"id":identity}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler),base_url="http://test") as client:
        workflow = WorkflowConsole(client, terminal, accounts={"A":{"id":"app-a","token":"token-a"}})
        await workflow.login("B")
        assert workflow.accounts["B"]["id"] == "app-b"
    assert any("서로 다른 계정" in line for line in terminal.output)


def test_real_cli_entrypoint_accepts_terminal_text_for_entire_flow():
    answers = ["", "", "", "", "", "", "", "", "", "오후 3시부터 가능해",
               "", "", "", "", "", "approve", "", "approve", "", "아니요", "", "", "approve"]
    result = subprocess.run([sys.executable, "-m", "scripts.workflow_console"],
        input="\n".join(answers)+"\n", capture_output=True, encoding="utf-8", timeout=40,
        cwd=Path(__file__).resolve().parents[1])
    assert result.returncode == 0, result.stdout
    assert "전체 워크플로우 마지막 상태: completed" in result.stdout
    assert "시작 시간을 답하세요" in result.stdout
    assert "시험 조건" in result.stdout
