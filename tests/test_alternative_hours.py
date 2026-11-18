"""대체 축제는 모임 시간과 운영시간이 겹칠 때만 추천 (리허설: 모임 12:00~13:30에 14:00 개장 축제 → 새 일정 생성 실패)."""
from app.features.agents.tools import _overlaps_meeting

DAY = "2026-11-21"


def festival(open_time, close_time):
    return {"operatingHours": [{"date": DAY, "open": open_time, "close": close_time}]}


def test_festival_opening_after_meeting_end_is_excluded():
    assert not _overlaps_meeting(festival("14:00", "21:30"), DAY, {"start_time": "12:00", "end_time": "13:30"})


def test_festival_open_during_meeting_is_kept():
    assert _overlaps_meeting(festival("11:00", "15:40"), DAY, {"start_time": "12:00", "end_time": "13:30"})


def test_without_end_time_uses_default_90_minutes():
    assert _overlaps_meeting(festival("13:00", "17:00"), DAY, {"start_time": "12:00"})       # 12:00~13:30과 겹침
    assert not _overlaps_meeting(festival("19:00", "21:30"), DAY, {"start_time": "12:00"})   # 야간 축제 제외


def test_festival_without_hours_that_day_is_excluded():
    assert not _overlaps_meeting({"operatingHours": [{"date": "2026-11-22", "open": "10:00", "close": "18:00"}]},
                                 DAY, {"start_time": "12:00"})
