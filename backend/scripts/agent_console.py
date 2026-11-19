"""Interactive test console for the existing graph; never connects to the shared DB.

Run from the backend repository: uv run python -m scripts.agent_console
Uses .env model settings. --provider rules explicitly disables OpenAI calls.
"""
import argparse
import asyncio
import json
import sys

from pydantic import ValidationError

from app.core.config import Settings
from app.core.demo_repository import DemoRepository
from app.core.repository import RepositoryError
from app.features.agents.schemas import Conditions, ResumeRun, RunStart
from app.features.agents.service import AgentService
from tests.ephemeral_storage import EphemeralAgentStorage

USER = "usr_demo_02"


class ExitConsole(Exception):
    pass


def ask(prompt):
    try:
        value = input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        raise ExitConsole from None
    if value.lower() in {"/exit", "/quit"}:
        raise ExitConsole
    return value


def show_run(run, previous_trace=0, previous_calls=0):
    print("\n[실행 노드] " + " → ".join(item["node"] for item in run["trace"][previous_trace:]))
    for item in run["toolCalls"][previous_calls:]:
        result = item.get("code") or item["status"]
        print(f"  도구: {item['tool']} / 선택: {item.get('selectedBy', 'server')} / 결과: {result}")
    print(f"[상태] {run['status']} / runId: {run['runId']}")
    print(f"[체크포인트] {run['checkpointId']}")
    for item in run["errors"]:
        print(f"[검증] {item['code']}: {item['message']}")
    if run["status"] == "waiting_input":
        question = run["interrupt"]
        print("[추가 질문] " + (", ".join(question.get("missing", [])) or question["message"]))
    elif run["status"] == "waiting_approval":
        print("[일정 초안] " + run["candidate"].get("summary", ""))
        for item in run["candidate"].get("items", []):
            print(f"  {item['date']} {item['time']}~{item['endTime']} {item['label']}")
        print("아직 확정 일정은 변경되지 않았습니다.")
    elif run["status"] == "completed":
        print("[완료] " + json.dumps(run["result"], ensure_ascii=False))
    elif run["status"] in {"failed", "rejected", "cancelled"}:
        print("[종료] " + json.dumps(run["result"], ensure_ascii=False))


def additional_input(run, fixture_group, festivals):
    """Validate user input locally, then resume the real graph with structured answers."""
    while True:
        print("\n추가 조건을 입력하세요. /cancel: 현재 실행 취소, /exit: 종료")
        group_id = None
        festival_id = None
        missing = run["interrupt"].get("missing", [])
        if "groupId" in missing:
            value = ask("모임 [Enter=시험 모임, demo]: ")
            if value == "/cancel":
                return ResumeRun(checkpoint_id=run["checkpointId"], decision="cancel")
            if value not in {"", "demo", fixture_group["id"]}:
                print("이 콘솔에서는 demo 시험 모임을 사용합니다.")
                continue
            group_id = fixture_group["id"]
        if "festivalId" in missing and not group_id:
            for index, festival in enumerate(festivals, 1):
                print(f"  {index}: {festival['name']} ({festival['startDate']})")
            choice = ask("축제 번호 [Enter=1]: ")
            if choice == "/cancel":
                return ResumeRun(checkpoint_id=run["checkpointId"], decision="cancel")
            if choice and (not choice.isdigit() or not 1 <= int(choice) <= len(festivals)):
                print("표시된 축제 번호를 입력하세요.")
                continue
            festival_id = festivals[int(choice or "1")-1]["id"]
        selected = next((festival for festival in festivals if festival["id"] == (festival_id or fixture_group["festivalId"])), festivals[0])
        current = run["conditions"]
        prompts = [("date", "날짜 YYYY-MM-DD", current.get("date") or selected["startDate"]),
                   ("start_time", "시작 HH:mm", current.get("start_time")),
                   ("end_time", "종료 HH:mm", current.get("end_time"))]
        values = {}
        for key, label, default in prompts:
            value = ask(f"{label} [Enter={default or '생략'}]: ")
            if value == "/cancel":
                return ResumeRun(checkpoint_id=run["checkpointId"], decision="cancel")
            if value or default:
                values[key] = value or default
        message = ask("추가 설명 [Enter=기존 요청 유지]: ")
        if message == "/cancel":
            return ResumeRun(checkpoint_id=run["checkpointId"], decision="cancel")
        try:
            return ResumeRun(checkpoint_id=run["checkpointId"], group_id=group_id,
                             festival_id=festival_id, answers=Conditions.model_validate(values), message=message or None)
        except ValidationError:
            print("날짜·시간 형식과 시작 < 종료 조건을 확인하고 다시 입력하세요.")


def approval_input(run):
    choices = {"approve": "approve", "승인": "approve", "a": "approve",
               "reject": "reject", "거절": "reject", "r": "reject",
               "cancel": "cancel", "취소": "cancel", "c": "cancel", "/cancel": "cancel"}
    while True:
        value = ask("\n결정 [approve/승인, reject/거절, cancel/취소]: ").lower()
        if value in choices:
            return ResumeRun(checkpoint_id=run["checkpointId"], decision=choices[value])
        print("승인·거절·취소 중 하나를 입력하세요. 조건을 바꾸려면 거절 후 새 요청을 시작하세요.")


async def console(provider=None):
    settings = Settings()
    provider = provider or settings.agent_model_provider
    if provider == "openai" and (not settings.openai_api_key or not settings.openai_api_key.get_secret_value().strip() or not settings.openai_model):
        print(".env의 OPENAI_API_KEY·OPENAI_MODEL을 설정하세요. 오프라인 시험은 --provider rules를 사용하세요.")
        return 2
    # Explicit injection for this test command only; the API server keeps PostgreSQL/JWT.
    config = settings.model_copy(update={"database_url": None, "app_env": "test",
        "agent_model_provider": provider, "agent_weather_provider": "demo", "tour_api_service_key": None})
    repository = DemoRepository()
    festivals = list(repository.store.festivals.values())
    fixture_group = await repository.create_group(USER, dict(festivalId=festivals[0]["id"],
        title="터미널 시험 모임", postBody="인메모리 시험 데이터", joinMode="approval", capacity=4))
    service = AgentService(repository, config, storage=EphemeralAgentStorage())
    await service.open()
    print(f"FestaMate LangGraph 테스트 콘솔 | 모델: {settings.openai_model if provider == 'openai' else 'rules (OpenAI 호출 없음)'}")
    print("실제 그래프를 실행합니다. 사용자·축제·날씨·저장소는 시험용이며 공유 DB에 연결하지 않습니다.")
    print("종료하면 이 콘솔의 실행 상태·기억은 사라집니다. OpenAI 모드에는 API 비용이 발생합니다.")
    print("예시: 일정 만들어줘 → 추가 조건 입력 → 승인")
    print("명령: /memory 기억 확인, /new 새 세션, /exit 종료\n")
    print(f"시험 축제: {festivals[0]['name']} / {festivals[0]['startDate']} / 시험 모임 별칭: demo")
    session_id = None
    try:
        while True:
            message = ask("\n요청> ")
            if not message:
                continue
            if message == "/memory":
                memory = await service.memory.session(session_id, USER) if session_id else {"summary": {}, "messages": []}
                print(json.dumps({"session": memory, "preferences": await service.memory.preferences(USER)}, ensure_ascii=False, indent=2))
                continue
            if message == "/new":
                session_id = None
                print("새 세션을 시작합니다.")
                continue
            try:
                print("그래프 실행 중…", flush=True)
                run = await service.start(USER, RunStart(message=message, session_id=session_id))
                session_id = run["sessionId"]
                show_run(run)
                while run["status"] in {"waiting_input", "waiting_approval"}:
                    payload = additional_input(run, fixture_group, festivals) if run["status"] == "waiting_input" else approval_input(run)
                    trace_count, call_count = len(run["trace"]), len(run["toolCalls"])
                    print("체크포인트에서 그래프 재개 중…", flush=True)
                    run = await service.resume(USER, run["runId"], payload)
                    show_run(run, trace_count, call_count)
                schedule = (await repository.group(fixture_group["id"]))["schedule"]
                print(f"[시험 모임 확정 일정 버전] {schedule['version']}")
            except RepositoryError as exc:
                print(f"[요청 오류] {exc.code}: {exc.message}")
            except ValidationError:
                print("[입력 오류] 요청은 1~4000자 이내로 입력하세요.")
    except ExitConsole:
        print("\n테스트 콘솔 종료")
    finally:
        await service.close()
    return 0


def main():
    parser = argparse.ArgumentParser(description="Auth 없이 기존 LangGraph를 대화형으로 실행하는 격리 테스트 콘솔")
    parser.add_argument("--provider", choices=["openai", "rules"], help="생략하면 .env의 AGENT_MODEL_PROVIDER 사용")
    args = parser.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
    try:
        return asyncio.run(console(args.provider))
    except (ExitConsole, KeyboardInterrupt):
        print("\n테스트 콘솔 종료")
        return 0
    except Exception as exc:
        # SDK and settings exceptions may contain credentials; never dump their repr/traceback.
        print(f"실행 실패 ({type(exc).__name__}). 설정과 네트워크를 확인하세요.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
