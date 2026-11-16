"""Shared errors for application service layers.

Services express business rules without depending on FastAPI's HTTP error
types. Routers translate these errors into the API error envelope.
"""

from __future__ import annotations

from typing import Any


class ServiceError(Exception):
    """A business rule failure that can be safely exposed by the API."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
