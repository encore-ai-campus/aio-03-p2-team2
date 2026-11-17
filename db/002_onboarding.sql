-- FestaMate onboarding completion.
-- Run after the base schema and db/supabase_auth_rls.sql (공용 DB 적용 전 DB 담당에게 공유).
-- Stores when a user finished or skipped onboarding so the frontend asks only once.

begin;

alter table public.user_profiles
    add column if not exists onboarding_completed_at timestamptz;

comment on column public.user_profiles.onboarding_completed_at is
    '온보딩 완료(저장 또는 나중에) 시각. null이면 첫 로그인 시 온보딩을 보여준다.';

commit;
