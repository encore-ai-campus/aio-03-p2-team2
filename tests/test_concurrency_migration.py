from pathlib import Path


ROOT = Path(__file__).parents[1]


def test_concurrency_rpc_migration_contains_atomic_paths():
    sql = (ROOT / "db" / "concurrency_rpc.sql").read_text(encoding="utf-8")

    for function_name in (
        "rpc_update_group",
        "rpc_create_group_join_request",
        "rpc_approve_group_join_request",
        "rpc_approve_schedule_proposal",
    ):
        assert f"function public.{function_name}" in sql

    assert sql.count("for update") >= 6
    assert "for share" in sql
    assert "p_expected_version" in sql
    assert "p_expected_group_version" in sql
    assert "p_expected_schedule_version" in sql
    assert sql.lstrip().startswith("-- FestaMate concurrency migration")
    assert sql.rstrip().endswith("commit;")


def test_repositories_call_concurrency_rpcs_inside_transactions():
    groups = (ROOT / "app" / "features" / "groups" / "repository.py").read_text(encoding="utf-8")
    schedules = (ROOT / "app" / "features" / "schedules" / "repository.py").read_text(encoding="utf-8")

    assert "rpc_create_group_join_request" in groups
    assert "rpc_approve_group_join_request" in groups
    assert "rpc_update_group" in groups
    assert "rpc_approve_schedule_proposal" in schedules
    assert groups.count("async with connection.transaction()") >= 3
    assert "assert_rpc_success(result)" in groups
    assert "assert_rpc_success(result)" in schedules
