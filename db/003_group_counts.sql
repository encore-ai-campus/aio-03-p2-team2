-- FestaMate: 모임 목록의 실제 인원·신청 대기 수.
-- Run after the base schema and db/supabase_auth_rls.sql. Safe to re-run.
--
-- 신청 목록(group_join_requests)은 RLS 로 신청자 본인과 모임장만 볼 수 있어서,
-- 일반 사용자가 모임 목록을 보면 신청 대기 수가 0 으로 계산되었다.
-- 이 함수는 누가 신청했는지는 숨기고 "개수"만 돌려준다 (security definer).

create or replace function public.group_counts(p_group_ids text[])
returns table (group_id text, member_count integer, pending_request_count integer)
language sql
stable
security definer
set search_path = public
as $$
    select g.id,
           (select count(*)::int from public.group_members m
             where m.group_id = g.id and m.left_at is null),
           (select count(*)::int from public.group_join_requests r
             where r.group_id = g.id and r.status = 'pending')
    from public.groups g
    where g.id = any(p_group_ids)
$$;

revoke all on function public.group_counts(text[]) from public;
grant execute on function public.group_counts(text[]) to anon, authenticated;

-- 확인: 모임별 인원·대기 수
select * from public.group_counts(array(select id from public.groups));
