-- FestaMate authentication and authorization migration.
-- Run this in the Supabase SQL editor after the base FestaMate schema.
-- Existing public.users rows must be linked to auth.users manually by setting
-- users.auth_user_id before protected API calls can resolve an application user.

begin;

-- Keep auth/RLS setup applicable to projects whose base schema omitted the
-- external worker queue. The canonical table name is external_sync_runs;
-- sync_jobs is not used by the API or Worker.
create table if not exists public.external_sync_runs (
    id text primary key default ('job_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24)),
    kind text not null,
    status text not null default 'queued'
        check (status in ('queued', 'running', 'succeeded', 'failed')),
    params jsonb not null default '{}'::jsonb,
    accepted integer not null default 0,
    rejected integer not null default 0,
    rejections jsonb not null default '[]'::jsonb,
    error text,
    requested_by text,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz
);

alter table public.users
    add column if not exists auth_user_id uuid;

create unique index if not exists users_auth_user_id_uidx
    on public.users (auth_user_id)
    where auth_user_id is not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'users_auth_user_id_fkey'
          and conrelid = 'public.users'::regclass
    ) then
        alter table public.users
            add constraint users_auth_user_id_fkey
            foreign key (auth_user_id) references auth.users(id) on delete set null;
    end if;
end
$$;

create or replace function public.current_app_user_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select u.id
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.status = 'active'
    limit 1
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
    select coalesce(
        (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'service_role'),
        false
    )
$$;

-- New Supabase users receive an application user row. Existing rows should be
-- linked explicitly instead of being duplicated by this trigger.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    app_user_id text;
    display_name_value text;
begin
    display_name_value := left(coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        '새 사용자'
    ), 20);
    insert into public.users (id, auth_user_id, display_name, status)
    values ('usr_' || replace(new.id::text, '-', ''), new.id, display_name_value, 'active')
    on conflict (auth_user_id) do nothing;
    select id into app_user_id from public.users where auth_user_id = new.id;
    insert into public.user_profiles (user_id) values (app_user_id)
        on conflict (user_id) do nothing;
    insert into public.notification_consents (user_id) values (app_user_id)
        on conflict (user_id) do nothing;
    return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_auth_user();

insert into public.user_profiles (user_id)
    select id from public.users where auth_user_id is not null
    on conflict (user_id) do nothing;
insert into public.notification_consents (user_id)
    select id from public.users where auth_user_id is not null
    on conflict (user_id) do nothing;

-- RLS is enabled for every table reachable from the API. The FastAPI
-- connection sets request.jwt.claims and switches to anon/authenticated for
-- each pooled connection, so auth.uid() is available to these policies.
alter table public.users enable row level security;
alter table public.user_profiles enable row level security;
alter table public.notification_consents enable row level security;
alter table public.festivals enable row level security;
alter table public.festival_operating_hours enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_join_requests enable row level security;
alter table public.group_comments enable row level security;
alter table public.group_messages enable row level security;
alter table public.group_schedules enable row level security;
alter table public.schedule_proposals enable row level security;
alter table public.matching_runs enable row level security;
alter table public.matching_candidates enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_answers enable row level security;
alter table public.external_sync_runs enable row level security;

drop policy if exists users_select_active on public.users;
create policy users_select_active on public.users for select
    using (status = 'active');
drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users for update
    using (auth.uid() = auth_user_id)
    with check (auth.uid() = auth_user_id);

drop policy if exists user_profiles_select_active on public.user_profiles;
create policy user_profiles_select_active on public.user_profiles for select
    using (exists (select 1 from public.users u where u.id = user_id and u.status = 'active'));
drop policy if exists user_profiles_update_self on public.user_profiles;
create policy user_profiles_update_self on public.user_profiles for all
    using (user_id = public.current_app_user_id())
    with check (user_id = public.current_app_user_id());

drop policy if exists notification_consents_self on public.notification_consents;
create policy notification_consents_self on public.notification_consents for all
    using (user_id = public.current_app_user_id())
    with check (user_id = public.current_app_user_id());

drop policy if exists festivals_public_read on public.festivals;
create policy festivals_public_read on public.festivals for select using (true);
drop policy if exists festivals_admin_write on public.festivals;
create policy festivals_admin_write on public.festivals for all
    using (public.is_admin()) with check (public.is_admin());

drop policy if exists festival_hours_public_read on public.festival_operating_hours;
create policy festival_hours_public_read on public.festival_operating_hours for select using (true);
drop policy if exists festival_hours_admin_write on public.festival_operating_hours;
create policy festival_hours_admin_write on public.festival_operating_hours for all
    using (public.is_admin()) with check (public.is_admin());

drop policy if exists groups_public_read on public.groups;
create policy groups_public_read on public.groups for select
    using (status in ('open', 'full', 'closed'));
drop policy if exists groups_create_self on public.groups;
create policy groups_create_self on public.groups for insert
    with check (leader_id = public.current_app_user_id());
drop policy if exists groups_update_leader on public.groups;
create policy groups_update_leader on public.groups for update
    using (leader_id = public.current_app_user_id())
    with check (leader_id = public.current_app_user_id());

drop policy if exists group_members_public_read on public.group_members;
create policy group_members_public_read on public.group_members for select
    using (exists (select 1 from public.groups g where g.id = group_id and g.status in ('open', 'full', 'closed')));
drop policy if exists group_members_self_write on public.group_members;
create policy group_members_self_write on public.group_members for insert
    with check (user_id = public.current_app_user_id() or exists (
        select 1 from public.groups g where g.id = group_id and g.leader_id = public.current_app_user_id()
    ));
drop policy if exists group_members_self_leave on public.group_members;
create policy group_members_self_leave on public.group_members for update
    using (user_id = public.current_app_user_id() or exists (
        select 1 from public.groups g where g.id = group_id and g.leader_id = public.current_app_user_id()
    ));

drop policy if exists join_requests_owner_or_leader_read on public.group_join_requests;
create policy join_requests_owner_or_leader_read on public.group_join_requests for select
    using (user_id = public.current_app_user_id() or exists (
        select 1 from public.groups g where g.id = group_id and g.leader_id = public.current_app_user_id()
    ));
drop policy if exists join_requests_owner_create on public.group_join_requests;
create policy join_requests_owner_create on public.group_join_requests for insert
    with check (user_id = public.current_app_user_id());
drop policy if exists join_requests_leader_update on public.group_join_requests;
create policy join_requests_leader_update on public.group_join_requests for update
    using (exists (select 1 from public.groups g where g.id = group_id and g.leader_id = public.current_app_user_id()));

drop policy if exists comments_public_read on public.group_comments;
create policy comments_public_read on public.group_comments for select
    using (deleted_at is null);
drop policy if exists comments_create_self on public.group_comments;
create policy comments_create_self on public.group_comments for insert
    with check (author_id = public.current_app_user_id());
drop policy if exists comments_author_or_leader_update on public.group_comments;
create policy comments_author_or_leader_update on public.group_comments for update
    using (author_id = public.current_app_user_id() or exists (
        select 1 from public.groups g where g.id = group_id and g.leader_id = public.current_app_user_id()
    ));

drop policy if exists messages_member_read on public.group_messages;
create policy messages_member_read on public.group_messages for select
    using (exists (
        select 1 from public.group_members gm
        where gm.group_id = group_messages.group_id and gm.user_id = public.current_app_user_id() and gm.left_at is null
    ));
drop policy if exists messages_member_create on public.group_messages;
create policy messages_member_create on public.group_messages for insert
    with check (
        (sender_id = public.current_app_user_id() or (
            sender_id is null and exists (select 1 from public.groups g where g.id = group_id and g.leader_id = public.current_app_user_id())
        ))
        and exists (
            select 1 from public.group_members gm
            where gm.group_id = group_messages.group_id and gm.user_id = public.current_app_user_id() and gm.left_at is null
        )
    );

drop policy if exists schedules_member_read on public.group_schedules;
create policy schedules_member_read on public.group_schedules for select
    using (exists (select 1 from public.group_members gm where gm.group_id = group_schedules.group_id and gm.user_id = public.current_app_user_id() and gm.left_at is null));
drop policy if exists schedules_leader_write on public.group_schedules;
create policy schedules_leader_write on public.group_schedules for all
    using (exists (select 1 from public.groups g where g.id = group_id and g.leader_id = public.current_app_user_id()))
    with check (exists (select 1 from public.groups g where g.id = group_id and g.leader_id = public.current_app_user_id()));

drop policy if exists proposals_member_read on public.schedule_proposals;
create policy proposals_member_read on public.schedule_proposals for select
    using (exists (select 1 from public.group_members gm where gm.group_id = schedule_proposals.group_id and gm.user_id = public.current_app_user_id() and gm.left_at is null));
drop policy if exists proposals_member_create on public.schedule_proposals;
create policy proposals_member_create on public.schedule_proposals for insert
    with check (created_by = public.current_app_user_id());
drop policy if exists proposals_leader_update on public.schedule_proposals;
create policy proposals_leader_update on public.schedule_proposals for update
    using (exists (select 1 from public.groups g where g.id = group_id and g.leader_id = public.current_app_user_id()));

drop policy if exists matching_runs_owner on public.matching_runs;
create policy matching_runs_owner on public.matching_runs for all
    using (user_id = public.current_app_user_id())
    with check (user_id = public.current_app_user_id());
drop policy if exists matching_candidates_owner_read on public.matching_candidates;
create policy matching_candidates_owner_read on public.matching_candidates for select
    using (exists (select 1 from public.matching_runs r where r.id = run_id and r.user_id = public.current_app_user_id()));
drop policy if exists matching_candidates_owner_write on public.matching_candidates;
create policy matching_candidates_owner_write on public.matching_candidates for insert
    with check (exists (select 1 from public.matching_runs r where r.id = run_id and r.user_id = public.current_app_user_id()));

drop policy if exists alerts_owner_read on public.alerts;
create policy alerts_owner_read on public.alerts for select
    using (user_id = public.current_app_user_id());
drop policy if exists alerts_owner_update on public.alerts;
create policy alerts_owner_update on public.alerts for update
    using (user_id = public.current_app_user_id());
drop policy if exists alerts_server_insert on public.alerts;
create policy alerts_server_insert on public.alerts for insert
    with check (public.is_admin() or exists (
        select 1 from public.groups g where g.id = group_id and g.leader_id = public.current_app_user_id()
    ));

drop policy if exists alert_answers_owner on public.alert_answers;
create policy alert_answers_owner on public.alert_answers for all
    using (user_id = public.current_app_user_id())
    with check (user_id = public.current_app_user_id());

drop policy if exists sync_runs_admin on public.external_sync_runs;
create policy sync_runs_admin on public.external_sync_runs for all
    using (public.is_admin()) with check (public.is_admin());

commit;
