-- FestaMate concurrency migration.
-- Run after the base FestaMate schema and db/supabase_auth_rls.sql.
-- Each function is invoked inside the caller's transaction.  The FOR UPDATE /
-- FOR SHARE locks and version predicates are deliberately kept in the DB so
-- no API process can bypass the invariant with a stale read.

begin;

create or replace function public.rpc_update_group(
    p_group_id text,
    p_leader_id text,
    p_expected_version bigint,
    p_title text default null,
    p_post_body text default null,
    p_capacity integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    group_row public.groups%rowtype;
begin
    select g.* into group_row
    from public.groups g
    where g.id = p_group_id
    for update;

    if not found then
        return jsonb_build_object('ok', false, 'code', 'GROUP_NOT_FOUND', 'status', 404,
                                  'message', '모임을 찾을 수 없습니다.');
    end if;
    if group_row.leader_id <> p_leader_id then
        return jsonb_build_object('ok', false, 'code', 'LEADER_ONLY', 'status', 403,
                                  'message', '모임장만 수행할 수 있습니다.');
    end if;
    if public.current_app_user_id() is distinct from p_leader_id then
        return jsonb_build_object('ok', false, 'code', 'LEADER_ONLY', 'status', 403,
                                  'message', '현재 인증 사용자만 수행할 수 있습니다.');
    end if;
    if group_row.version <> p_expected_version then
        return jsonb_build_object('ok', false, 'code', 'RESOURCE_VERSION_CONFLICT', 'status', 409,
                                  'message', '모임 버전이 변경되었습니다.');
    end if;
    if group_row.status in ('closed', 'cancelled') then
        return jsonb_build_object('ok', false, 'code', 'GROUP_CLOSED', 'status', 409,
                                  'message', '변경할 수 없는 모임입니다.');
    end if;
    if p_capacity is not null and p_capacity < group_row.member_count then
        return jsonb_build_object('ok', false, 'code', 'GROUP_CAPACITY_EXCEEDED', 'status', 409,
                                  'message', '현재 멤버 수보다 작은 정원은 설정할 수 없습니다.');
    end if;

    update public.groups
    set title = coalesce(p_title, title),
        post_body = coalesce(p_post_body, post_body),
        capacity = coalesce(p_capacity, capacity),
        status = case when member_count >= coalesce(p_capacity, capacity) then 'full' else 'open' end,
        version = version + 1,
        updated_at = now()
    where id = p_group_id and version = p_expected_version;

    if not found then
        return jsonb_build_object('ok', false, 'code', 'RESOURCE_VERSION_CONFLICT', 'status', 409,
                                  'message', '모임 버전이 변경되었습니다.');
    end if;
    return jsonb_build_object('ok', true, 'version', p_expected_version + 1);
end;
$$;

create or replace function public.rpc_create_group_join_request(
    p_group_id text,
    p_user_id text,
    p_message text default null,
    p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    group_row public.groups%rowtype;
    request_id text;
begin
    select g.* into group_row
    from public.groups g
    where g.id = p_group_id
    for update;

    if not found then
        return jsonb_build_object('ok', false, 'code', 'GROUP_NOT_FOUND', 'status', 404,
                                  'message', '모임을 찾을 수 없습니다.');
    end if;
    if public.current_app_user_id() is distinct from p_user_id then
        return jsonb_build_object('ok', false, 'code', 'GROUP_MEMBER_ONLY', 'status', 403,
                                  'message', '현재 인증 사용자만 참여할 수 있습니다.');
    end if;
    if p_expected_version is not null and group_row.version <> p_expected_version then
        return jsonb_build_object('ok', false, 'code', 'RESOURCE_VERSION_CONFLICT', 'status', 409,
                                  'message', '모임 버전이 변경되었습니다.');
    end if;
    if exists (
        select 1 from public.group_members gm
        where gm.group_id = p_group_id and gm.user_id = p_user_id and gm.left_at is null
    ) then
        return jsonb_build_object('ok', false, 'code', 'ALREADY_MEMBER', 'status', 409,
                                  'message', '이미 참여 중인 모임입니다.');
    end if;
    if exists (
        select 1 from public.group_join_requests jr
        where jr.group_id = p_group_id and jr.user_id = p_user_id and jr.status = 'pending'
    ) then
        return jsonb_build_object('ok', false, 'code', 'JOIN_REQUEST_ALREADY_EXISTS', 'status', 409,
                                  'message', '이미 대기 중인 참여 신청이 있습니다.');
    end if;
    if group_row.status in ('full', 'closed', 'cancelled') then
        return jsonb_build_object('ok', false, 'code', 'GROUP_CLOSED', 'status', 409,
                                  'message', '참여할 수 없는 모임입니다.');
    end if;

    if group_row.join_mode = 'instant' then
        if group_row.member_count >= group_row.capacity then
            return jsonb_build_object('ok', false, 'code', 'GROUP_CAPACITY_EXCEEDED', 'status', 409,
                                      'message', '모임 정원이 가득 찼습니다.');
        end if;
        insert into public.group_members (group_id, user_id, role)
        values (p_group_id, p_user_id, 'member');
        update public.groups
        set member_count = member_count + 1,
            status = case when member_count + 1 >= capacity then 'full' else 'open' end,
            version = version + 1,
            updated_at = now()
        where id = p_group_id and version = group_row.version;
        if not found then
            return jsonb_build_object('ok', false, 'code', 'RESOURCE_VERSION_CONFLICT', 'status', 409,
                                      'message', '모임 버전이 변경되었습니다.');
        end if;
        return jsonb_build_object('ok', true, 'mode', 'instant',
                                  'version', group_row.version + 1);
    end if;

    insert into public.group_join_requests (group_id, user_id, message)
    values (p_group_id, p_user_id, p_message)
    returning id::text into request_id;
    return jsonb_build_object('ok', true, 'mode', 'approval', 'request_id', request_id,
                              'version', group_row.version);
end;
$$;

create or replace function public.rpc_approve_group_join_request(
    p_group_id text,
    p_request_id text,
    p_leader_id text,
    p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    group_row public.groups%rowtype;
    request_row public.group_join_requests%rowtype;
    next_version bigint;
begin
    select g.* into group_row
    from public.groups g
    where g.id = p_group_id
    for update;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'GROUP_NOT_FOUND', 'status', 404,
                                  'message', '모임을 찾을 수 없습니다.');
    end if;
    if group_row.leader_id <> p_leader_id or public.current_app_user_id() is distinct from p_leader_id then
        return jsonb_build_object('ok', false, 'code', 'LEADER_ONLY', 'status', 403,
                                  'message', '모임장만 수행할 수 있습니다.');
    end if;
    if group_row.version <> p_expected_version then
        return jsonb_build_object('ok', false, 'code', 'RESOURCE_VERSION_CONFLICT', 'status', 409,
                                  'message', '모임 버전이 변경되었습니다.');
    end if;

    select jr.* into request_row
    from public.group_join_requests jr
    where jr.id::text = p_request_id and jr.group_id = p_group_id
    for update;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'JOIN_REQUEST_NOT_FOUND', 'status', 404,
                                  'message', '참여 신청을 찾을 수 없습니다.');
    end if;
    if request_row.status <> 'pending' then
        return jsonb_build_object('ok', false, 'code', 'JOIN_REQUEST_NOT_PENDING', 'status', 409,
                                  'message', '대기 중인 참여 신청이 아닙니다.');
    end if;
    if exists (
        select 1 from public.group_members gm
        where gm.group_id = p_group_id and gm.user_id = request_row.user_id and gm.left_at is null
    ) then
        return jsonb_build_object('ok', false, 'code', 'ALREADY_MEMBER', 'status', 409,
                                  'message', '신청자가 이미 멤버입니다.');
    end if;
    if group_row.member_count >= group_row.capacity then
        return jsonb_build_object('ok', false, 'code', 'GROUP_CAPACITY_EXCEEDED', 'status', 409,
                                  'message', '모임 정원이 가득 찼습니다.');
    end if;

    update public.group_join_requests
    set status = 'approved', decided_by = p_leader_id, decided_at = now(), updated_at = now()
    where id::text = p_request_id and group_id = p_group_id and status = 'pending';
    insert into public.group_members (group_id, user_id, role)
    values (p_group_id, request_row.user_id, 'member');
    update public.groups
    set member_count = member_count + 1,
        status = case when member_count + 1 >= capacity then 'full' else 'open' end,
        version = version + 1,
        updated_at = now()
    where id = p_group_id and version = p_expected_version
    returning version into next_version;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'RESOURCE_VERSION_CONFLICT', 'status', 409,
                                  'message', '모임 버전이 변경되었습니다.');
    end if;
    insert into public.group_messages (group_id, type, text, system_event)
    values (p_group_id, 'system', '새 멤버가 모임에 합류했습니다.', 'member_approved');
    insert into public.alerts (user_id, type, festival_id, group_id, severity, title, message, event_key)
    values (request_row.user_id, 'festival_changed', group_row.festival_id, p_group_id, 'info',
            '참여 신청이 승인되었습니다.', '모임 채팅에 참여할 수 있습니다.', 'join-approved:' || p_request_id)
    on conflict do nothing;
    return jsonb_build_object('ok', true, 'user_id', request_row.user_id, 'version', next_version);
end;
$$;

create or replace function public.rpc_approve_schedule_proposal(
    p_group_id text,
    p_proposal_id text,
    p_user_id text,
    p_expected_group_version bigint,
    p_expected_schedule_version bigint,
    p_availability jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    group_row public.groups%rowtype;
    schedule_row public.group_schedules%rowtype;
    proposal_row public.schedule_proposals%rowtype;
    member_row record;
    available_from_value time;
    current_availability jsonb := '[]'::jsonb;
    requested_availability jsonb := '[]'::jsonb;
    next_group_version bigint;
    next_schedule_version bigint;
begin
    select g.* into group_row from public.groups g
    where g.id = p_group_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'GROUP_NOT_FOUND', 'status', 404,
                                  'message', '모임을 찾을 수 없습니다.');
    end if;
    if group_row.leader_id <> p_user_id or public.current_app_user_id() is distinct from p_user_id then
        return jsonb_build_object('ok', false, 'code', 'LEADER_ONLY', 'status', 403,
                                  'message', '모임장만 수행할 수 있습니다.');
    end if;
    select s.* into schedule_row from public.group_schedules s
    where s.group_id = p_group_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'SCHEDULE_MISSING', 'status', 409,
                                  'message', '일정을 찾을 수 없습니다.');
    end if;
    select p.* into proposal_row from public.schedule_proposals p
    where p.id::text = p_proposal_id and p.group_id = p_group_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'PROPOSAL_NOT_FOUND', 'status', 404,
                                  'message', '일정 제안을 찾을 수 없습니다.');
    end if;
    -- Safe retry after the original transaction committed.
    if proposal_row.status = 'approved' then
        return jsonb_build_object('ok', true, 'already_committed', true,
                                  'group_version', group_row.version,
                                  'schedule_version', schedule_row.version);
    end if;
    if group_row.version <> p_expected_group_version
       or schedule_row.version <> p_expected_schedule_version
       or proposal_row.base_version <> p_expected_schedule_version then
        return jsonb_build_object('ok', false, 'code', 'RESOURCE_VERSION_CONFLICT', 'status', 409,
                                  'message', '모임 또는 일정 버전이 변경되었습니다.');
    end if;
    if proposal_row.status <> 'draft' then
        return jsonb_build_object('ok', false, 'code', 'RESOURCE_VERSION_CONFLICT', 'status', 409,
                                  'message', '일정 제안이 만료되었습니다.');
    end if;

    -- Lock each profile while reading it. A profile update therefore cannot
    -- race the availability snapshot used for this approval.
    for member_row in
        select gm.user_id from public.group_members gm
        where gm.group_id = p_group_id and gm.left_at is null
        order by gm.user_id
    loop
        select up.available_from into available_from_value
        from public.user_profiles up
        where up.user_id = member_row.user_id
        for share;
        current_availability := current_availability || jsonb_build_array(
            jsonb_build_object(
                'userId', member_row.user_id,
                'availableFrom', to_char(available_from_value, 'HH24:MI'),
                'availableUntil', null
            )
        );
    end loop;
    select coalesce(jsonb_agg(items.item order by items.item->>'userId'), '[]'::jsonb)
    into requested_availability
    from jsonb_array_elements(coalesce(p_availability, '[]'::jsonb)) as items(item);
    if current_availability <> requested_availability then
        return jsonb_build_object('ok', false, 'code', 'RESOURCE_VERSION_CONFLICT', 'status', 409,
                                  'message', '참여자의 가능 시간이 변경되었습니다.');
    end if;

    update public.schedule_proposals
    set status = 'approved', decided_by = p_user_id, decided_at = now()
    where id::text = p_proposal_id and group_id = p_group_id and status = 'draft';
    update public.group_schedules
    set items = proposal_row.items, version = version + 1,
        validation_status = 'valid', conflict = null,
        updated_by = p_user_id, updated_at = now()
    where group_id = p_group_id and version = p_expected_schedule_version
    returning version into next_schedule_version;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'RESOURCE_VERSION_CONFLICT', 'status', 409,
                                  'message', '일정 버전이 변경되었습니다.');
    end if;
    update public.groups
    set version = version + 1, updated_at = now()
    where id = p_group_id and version = p_expected_group_version
    returning version into next_group_version;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'RESOURCE_VERSION_CONFLICT', 'status', 409,
                                  'message', '모임 버전이 변경되었습니다.');
    end if;
    insert into public.group_messages (group_id, type, text, system_event)
    values (p_group_id, 'system', '검증된 일정이 승인되었습니다.', 'schedule_changed');
    return jsonb_build_object('ok', true, 'group_version', next_group_version,
                              'schedule_version', next_schedule_version);
end;
$$;

comment on function public.rpc_update_group(text, text, bigint, text, text, integer)
    is 'Atomic group update with leader and optimistic-version validation.';
comment on function public.rpc_create_group_join_request(text, text, text, bigint)
    is 'Atomic join request/instant membership creation with capacity protection.';
comment on function public.rpc_approve_group_join_request(text, text, text, bigint)
    is 'Atomic join approval with capacity and optimistic-version validation.';
comment on function public.rpc_approve_schedule_proposal(text, text, text, bigint, bigint, jsonb)
    is 'Atomic schedule approval with group/schedule/profile version validation.';

commit;
