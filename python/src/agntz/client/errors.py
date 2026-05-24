"""Errors raised by the hosted Agntz client."""

from __future__ import annotations


class AgntzError(Exception):
    """Base exception for Agntz client failures."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        code: str | None = None,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.__cause__ = cause


class AuthenticationError(AgntzError):
    """Raised when the worker returns HTTP 401."""


class NotFoundError(AgntzError):
    """Raised when the worker returns HTTP 404."""


class StreamError(AgntzError):
    """Raised when an SSE stream violates the Agntz protocol."""
