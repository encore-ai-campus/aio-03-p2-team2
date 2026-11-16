"""Verify JWT protection and graph approval across the PR integration boundary."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.auth import require_current_user
from app.core.database import Database, _auth_claims
from app.main import create_app
from tests.auth_helpers import install_test_identity, token_headers
from tests.ephemeral_storage import EphemeralAgentStorage
from tests.test_agent_workflow import seed, group, settings, USER


@pytest.mark.asyncio
async def test_jwt_authenticated_graph_resume_and_schedule_read(tmp_path):
    repo, _ = seed()
    g = await group(repo)
    app = create_app(settings(tmp_path), repository=repo, agent_storage=EphemeralAgentStorage())
    install_test_identity(app, repo)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            path = '/api/v1/agents/runs'
            body = {'message': '일정 생성', 'groupId': g['id']}
            for headers in ({}, {'X-Demo-User-Id': USER}, {'Authorization': 'Bearer invalid'},
                            token_headers(exp=datetime.now(timezone.utc)-timedelta(seconds=1)),
                            token_headers(aud='wrong-audience'), token_headers(iss='wrong-issuer')):
                response = await client.post(path, headers=headers, json=body)
                assert response.status_code == 401, response.text
            unlinked = await client.post(path, headers=token_headers(sub='00000000-0000-0000-0000-000000000099'), json=body)
            assert unlinked.status_code == 403
            created = await client.post(path, headers=token_headers(), json=body)
            assert created.status_code == 201, created.text
            run = created.json()['data']
            assert run['status'] == 'waiting_approval'
            assert (await repo.group(g['id']))['schedule']['version'] == 1
            denied = await client.get(path+'/'+run['runId'], headers=token_headers('usr_demo_01'))
            assert denied.status_code == 403
            approved = await client.post(path+'/'+run['runId']+'/resume', headers=token_headers(),
                                         json={'checkpointId': run['checkpointId'], 'decision': 'approve'})
            assert approved.status_code == 200, approved.text
            assert approved.json()['data']['status'] == 'completed'
            read = await client.get(f"/api/v1/groups/{g['id']}/schedule", headers=token_headers())
            assert read.status_code == 200 and read.json()['data']['version'] == 2
            assert len(read.json()['data']['items']) == 2
            assert (await client.get(f"/api/v1/groups/{g['id']}/schedule", headers={'X-Demo-User-Id': USER})).status_code == 401
    assert _auth_claims.get() is None


@pytest.mark.asyncio
async def test_scoped_connection_releases_on_setup_failure(tmp_path):
    database = Database(settings(tmp_path))
    connection = AsyncMock()
    database.pool = AsyncMock()
    database.pool.acquire.return_value = connection
    database._set_connection_claims = AsyncMock(side_effect=RuntimeError('role setup failed'))
    with pytest.raises(RuntimeError, match='role setup failed'):
        async with database.acquire():
            pytest.fail('connection setup must fail before yielding')
    database.pool.release.assert_awaited_once_with(connection)


def test_protected_routes_use_common_auth_and_ws_has_no_http_dependency(tmp_path):
    app = create_app(settings(tmp_path))
    schema = app.openapi()
    protected = ['/api/v1/agents/runs', '/api/v1/groups/{group_id}/schedule', '/api/v1/groups/{group_id}/messages']
    for path in protected:
        operation = schema['paths'][path].get('get') or schema['paths'][path]['post']
        assert {'HTTPBearer': []} in operation['security']
    from app.features.chat.router import router as chat_router
    websocket = next(route for route in chat_router.routes if getattr(route, 'path', None) == '/ws/groups/{group_id}/chat')
    assert not websocket.dependant.dependencies



def test_auth_sql_preserves_signup_rows_and_correlates_group_policies():
    sql = (Path(__file__).resolve().parents[1]/'db/supabase_auth_rls.sql').read_text(encoding='utf-8')
    trigger = sql.split('create or replace function public.handle_new_auth_user()', 1)[1].split('$$;', 1)[0]
    assert 'insert into public.user_profiles' in trigger
    assert 'insert into public.notification_consents' in trigger
    assert '), 20)' in trigger
    assert 'gm.group_id = group_id' not in sql
    for table in ('group_messages', 'group_schedules', 'schedule_proposals'):
        assert f'gm.group_id = {table}.group_id' in sql
