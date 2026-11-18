"""Exercise real Function Calling serialization with controlled model responses."""
import json
from types import SimpleNamespace

import pytest

from app.features.agents.providers import OpenAIModel, RuleBasedModel
from app.features.agents.schemas import RunStart, Conditions, ResumeRun
from app.features.agents.tool_registry import function_definitions, bound_arguments
from app.features.agents.tools import AgentTools, ToolFailure
from tests.test_agent_workflow import seed, group, settings, make_service, USER, resume


class Item(SimpleNamespace):
    def model_dump(self, **kwargs):
        return vars(self).copy()


def response(*calls, text="근거 조회 완료", status="completed"):
    return SimpleNamespace(output=list(calls), output_text=text, status=status)


def call(name, arguments, call_id=None):
    return Item(type="function_call", name=name, arguments=arguments if isinstance(arguments,str) else json.dumps(arguments),
                call_id=call_id or 'call_'+name)


class ScriptedOpenAI(OpenAIModel):
    """Only API tool decisions are mocked; production choose_tools is unchanged."""
    def __init__(self, replies):
        super().__init__("test-key", "test-model")
        self.replies=list(replies)
        self.requests=[]
        async def create(**kwargs):
            # Capture a snapshot before the next graph node appends observations.
            self.requests.append(json.loads(json.dumps(kwargs)))
            if not self.replies: raise AssertionError("Unexpected additional model call")
            value=self.replies.pop(0)
            return value() if callable(value) else value
        self.client.responses.create=create

    async def parse(self, message, context):
        return await RuleBasedModel.parse(self,message,context)

    async def generate(self,state):
        return await RuleBasedModel.generate(self,state)

    async def reflect(self,state):
        return await RuleBasedModel.reflect(self,state)


def required(g,day,prefix='call'):
    return [call('get_festival',{'festival_id':g['festivalId']},prefix+'_festival'),
            call('get_availability',{'group_id':g['id']},prefix+'_availability'),
            call('get_weather',{'festival_id':g['festivalId'],'date':day},prefix+'_weather')]


@pytest.mark.asyncio
async def test_model_selects_each_tool_after_observing_previous_result(tmp_path):
    repo,day=seed(); g=await group(repo)
    model=ScriptedOpenAI([response(item) for item in required(g,day)]+[response()])
    service=await make_service(repo,settings(tmp_path),model=model).open()
    try:
        run=await service.start(USER,RunStart(message='오후 3시 이후 일정',group_id=g['id']))
        assert run['status']=='waiting_approval'
        assert [r['tool'] for r in run['toolCalls']]==['get_festival','get_availability','get_weather']
        assert all(r['selectedBy']=='openai_function_calling' for r in run['toolCalls'])
        assert len(model.requests)==4
        for index,request in enumerate(model.requests[1:],1):
            observations=[item for item in request['input'] if item.get('type')=='function_call_output']
            assert len(observations)==index
            assert all(json.loads(item['output'])['source'] for item in observations)
        request=model.requests[0]
        assert request['store'] is False and request['tool_choice']=='auto'
        assert request['parallel_tool_calls'] is False
        assert all(tool['strict'] and not tool['parameters']['additionalProperties'] for tool in request['tools'])
        selected_rounds=len(model.requests)
        result=await resume(service,run)
        assert result['status']=='completed'
        assert len(model.requests)==selected_rounds  # Mandatory approval reads never delegated to LLM.
        refreshed=[c for c in result['toolCalls'] if c['selectedBy']=='server_approval_revalidation']
        assert [c['tool'] for c in refreshed]==['get_festival','get_availability','get_weather']
        assert (await repo.group(g['id']))['schedule']['version']==2
    finally: await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('bad_name,bad_arguments,code',[
    ('close',{},'TOOL_NOT_ALLOWED'),
    ('commit_agent_proposal',{},'TOOL_NOT_ALLOWED'),
    ('get_availability',{},'TOOL_ARGUMENTS_INVALID'),
    ('get_availability','not-json','TOOL_ARGUMENTS_INVALID'),
    ('get_availability',{'group_id':'other-group'},'TOOL_SCOPE_MISMATCH'),
    ('get_festival',{'festival_id':'other-festival'},'TOOL_SCOPE_MISMATCH'),
    ('search_festivals',{'date':'2000-01-01'},'TOOL_SCOPE_MISMATCH'),
])
async def test_bad_model_call_is_rejected_then_corrected(tmp_path,bad_name,bad_arguments,code):
    repo,day=seed(); g=await group(repo)
    model=ScriptedOpenAI([response(call(bad_name,bad_arguments,'bad')),response(*required(g,day)),response()])
    service=await make_service(repo,settings(tmp_path),model=model).open()
    try:
        run=await service.start(USER,RunStart(message='일정 생성',group_id=g['id']))
        assert run['status']=='waiting_approval'
        assert run['toolCalls'][0]['code']==code
        output=next(item for item in model.requests[1]['input'] if item.get('type')=='function_call_output')
        assert json.loads(output['output'])['error']['code']==code
        assert (await repo.group(g['id']))['schedule']['version']==1
    finally: await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("festival_already_read", [False, True])
async def test_dependency_error_is_returned_to_model_before_corrected_call(tmp_path, festival_already_read):
    repo,day=seed(); g=await group(repo)
    weather=call('get_weather',{'festival_id':g['festivalId'],'date':day},'early_weather')
    festival, availability, corrected_weather = required(g, day)
    before = [response(festival)] if festival_already_read else []
    corrected = [availability, corrected_weather] if festival_already_read else [festival, availability, corrected_weather]
    model=ScriptedOpenAI([*before, response(weather), response(*corrected), response()])
    service=await make_service(repo,settings(tmp_path),model=model).open()
    try:
        run=await service.start(USER,RunStart(message='일정 생성',group_id=g['id']))
        assert run['status']=='waiting_approval'
        early = next(item for item in run["toolCalls"] if item["callId"] == "early_weather")
        assert early["code"] == "TOOL_DEPENDENCY_MISSING"
    finally: await service.close()


@pytest.mark.asyncio
async def test_model_cannot_finish_before_required_evidence_is_present(tmp_path):
    repo,day=seed(); g=await group(repo)
    model=ScriptedOpenAI([response(text='아무 조회 없이 완료'),response(*required(g,day)),response()])
    service=await make_service(repo,settings(tmp_path),model=model).open()
    try:
        run=await service.start(USER,RunStart(message='일정 생성',group_id=g['id']))
        assert run['status']=='waiting_approval'
        feedback=json.loads(model.requests[1]['input'][-1]['content'])
        assert feedback['validation_errors'][0]['code']=='TOOL_REQUIRED_MISSING'
    finally: await service.close()


@pytest.mark.asyncio
async def test_repeated_early_finish_hits_round_limit_without_proposal(tmp_path):
    repo,day=seed(); g=await group(repo)
    model=ScriptedOpenAI([response(),response()])
    service=await make_service(repo,settings(tmp_path,agent_max_tool_rounds=2),model=model).open()
    try:
        run=await service.start(USER,RunStart(message='일정 생성',group_id=g['id']))
        assert run['status']=='failed'
        assert run['errors'][0]['code']=='TOOL_SELECTION_LIMIT'
        assert not (await repo.group(g['id']))['schedule']['proposals']
        assert len(model.requests)==2
    finally: await service.close()


@pytest.mark.asyncio
async def test_call_limit_never_applies_schedule(tmp_path):
    repo,day=seed(); g=await group(repo)
    repeated=[call('get_festival',{'festival_id':g['festivalId']},f'repeat_{i}') for i in range(4)]
    model=ScriptedOpenAI([response(*repeated)])
    service=await make_service(repo,settings(tmp_path,agent_max_tool_calls=3),model=model).open()
    try:
        run=await service.start(USER,RunStart(message='일정 생성',group_id=g['id']))
        assert run['status']=='failed'
        assert any(c.get('code')=='TOOL_CALL_LIMIT' for c in run['toolCalls'])
        assert sum(c['status']=='ok' for c in run['toolCalls'])==3
        assert (await repo.group(g['id']))['schedule']['version']==1
    finally: await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('status',['incomplete','failed'])
async def test_incomplete_model_selection_fails_closed(tmp_path,status):
    repo,day=seed(); g=await group(repo)
    model=ScriptedOpenAI([response(status=status)])
    service=await make_service(repo,settings(tmp_path),model=model).open()
    try:
        run=await service.start(USER,RunStart(message='일정 생성',group_id=g['id']))
        assert run['status']=='failed' and run['errors'][0]['code']=='MODEL_UNAVAILABLE'
        assert not run['toolCalls']
    finally: await service.close()


@pytest.mark.asyncio
async def test_required_approval_reads_detect_profile_change_and_require_new_approval(tmp_path):
    repo,day=seed(); g=await group(repo)
    model=ScriptedOpenAI([response(*required(g,day)),response(),response(*required(g,day,'fresh')),response()])
    service=await make_service(repo,settings(tmp_path),model=model).open()
    try:
        run=await service.start(USER,RunStart(message='일정 생성',group_id=g['id']))
        await repo.update_profile(USER,{'availableFrom':'17:00'})
        result=await resume(service,run)
        assert result['status']=='waiting_approval'
        assert result['proposalId']!=run['proposalId']
        assert result['candidate']['items'][0]['time']=='17:00'
        assert (await repo.group(g['id']))['schedule']['version']==1
        assert (await resume(service,result))['status']=='completed'
    finally: await service.close()


@pytest.mark.asyncio
async def test_matching_can_choose_optional_weather_after_candidate_result(tmp_path):
    repo,day=seed(); g=await group(repo)
    replies=[response(call('get_festival',{'festival_id':g['festivalId']})),
             response(call('get_candidates',{'festival_id':g['festivalId']})),
             response(call('get_weather',{'festival_id':g['festivalId'],'date':day})),response()]
    model=ScriptedOpenAI(replies)
    service=await make_service(repo,settings(tmp_path),model=model).open()
    try:
        run=await service.start(USER,RunStart(message='동행 추천',intent='matching',festival_id=g['festivalId'],conditions=Conditions(date=day,start_time='15:00')))
        assert run['status']=='completed'
        assert [c['tool'] for c in run['toolCalls']]==['get_festival','get_candidates','get_weather']
        assert not (await repo.group(g['id']))['schedule']['proposals']
    finally: await service.close()


@pytest.mark.asyncio
async def test_all_parallel_call_ids_receive_feedback_even_if_one_is_invalid(tmp_path):
    repo,day=seed(); g=await group(repo)
    model=ScriptedOpenAI([response(call('not_a_tool',{},'bad'),required(g,day)[0]),
                         response(*required(g,day,'next')[1:]),response()])
    service=await make_service(repo,settings(tmp_path),model=model).open()
    try:
        run=await service.start(USER,RunStart(message='일정 생성',group_id=g['id']))
        assert run['status']=='waiting_approval'
        outputs=[item for item in model.requests[1]['input'] if item.get('type')=='function_call_output']
        assert {item['call_id'] for item in outputs}=={'bad','call_festival'}
    finally: await service.close()


@pytest.mark.asyncio
async def test_tool_dispatch_rejects_non_tool_methods(tmp_path):
    repo,day=seed()
    tools=AgentTools(repo,settings(tmp_path))
    try:
        with pytest.raises(ToolFailure) as exc:
            await tools.invoke('close',{})
        assert exc.value.code=='TOOL_NOT_ALLOWED'
    finally: await tools.close()
