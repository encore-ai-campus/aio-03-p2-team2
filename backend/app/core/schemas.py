"""Backward-compatible schema exports.

New code should import request models from the owning business domain package.
"""

from app.features.alerts.schemas import AlertAnswer
from app.features.auth.schemas import NotificationConsentPatch, ProfilePatch
from app.features.chat.schemas import MessageCreate
from app.features.festivals.schemas import FestivalImportRequest, FestivalInput
from app.features.groups.schemas import CommentCreate, GroupCreate, GroupUpdate, JoinRequestCreate, RejectRequest, VersionRequest
from app.features.matching.schemas import MatchingConditions, MatchingGroupInput, MatchingParseRequest, MatchingRunRequest
from app.features.schedules.schemas import ProposalAction, ProposalCreate, ScheduleValidateRequest
from app.core.models import APIModel, to_camel

__all__ = [
    "APIModel", "to_camel",
    "AlertAnswer", "NotificationConsentPatch", "ProfilePatch", "MessageCreate",
    "FestivalImportRequest", "FestivalInput", "CommentCreate", "GroupCreate",
    "GroupUpdate", "JoinRequestCreate", "RejectRequest", "VersionRequest",
    "MatchingConditions", "MatchingGroupInput", "MatchingParseRequest", "MatchingRunRequest",
    "ProposalAction", "ProposalCreate", "ScheduleValidateRequest",
]
