"""Subscription intent types."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


class SubscriptionPeriodUnit(StrEnum):
    """Shared subscription billing period units."""

    DAY = "day"
    WEEK = "week"
    MONTH = "month"


@dataclass
class SubscriptionRequest:
    """Shared subscription intent request body."""

    amount: str
    currency: str
    period_unit: SubscriptionPeriodUnit | str
    period_count: str
    recipient: str = ""
    subscription_expires: str = ""
    description: str = ""
    external_id: str = ""
    method_details: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        self.period_unit = normalize_period_unit(self.period_unit)

    def validate(self) -> None:
        parse_positive_decimal(self.amount, "amount")
        if not self.currency:
            raise ValueError("currency is required")
        parse_positive_decimal(self.period_count, "periodCount")
        normalize_period_unit(self.period_unit)
        if self.subscription_expires:
            parse_subscription_expires(self.subscription_expires)

    def to_dict(self) -> dict[str, Any]:
        self.validate()
        data: dict[str, Any] = {
            "amount": self.amount,
            "currency": self.currency,
            "periodUnit": normalize_period_unit(self.period_unit).value,
            "periodCount": self.period_count,
        }
        if self.recipient:
            data["recipient"] = self.recipient
        if self.subscription_expires:
            data["subscriptionExpires"] = self.subscription_expires
        if self.description:
            data["description"] = self.description
        if self.external_id:
            data["externalId"] = self.external_id
        if self.method_details:
            data["methodDetails"] = self.method_details
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SubscriptionRequest:
        return cls(
            amount=str(data.get("amount", "")),
            currency=str(data.get("currency", "")),
            period_unit=str(data.get("periodUnit", "")),
            period_count=str(data.get("periodCount", "")),
            recipient=str(data.get("recipient", "")),
            subscription_expires=str(data.get("subscriptionExpires", "")),
            description=str(data.get("description", "")),
            external_id=str(data.get("externalId", "")),
            method_details=data.get("methodDetails"),
        )


@dataclass
class SubscriptionReceipt:
    """Receipt shape returned after activation or renewal."""

    method: str
    reference: str
    status: str
    subscription_id: str
    timestamp: str
    external_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        data = {
            "method": self.method,
            "reference": self.reference,
            "status": self.status,
            "subscriptionId": self.subscription_id,
            "timestamp": self.timestamp,
        }
        if self.external_id:
            data["externalId"] = self.external_id
        return data


def normalize_period_unit(period_unit: SubscriptionPeriodUnit | str) -> SubscriptionPeriodUnit:
    """Normalize a period unit from wire value."""
    if isinstance(period_unit, SubscriptionPeriodUnit):
        return period_unit
    try:
        return SubscriptionPeriodUnit(period_unit)
    except ValueError as exc:
        raise ValueError(f"unsupported periodUnit: {period_unit}") from exc


def parse_positive_decimal(value: str, field: str) -> int:
    """Parse a positive decimal integer with canonical string form."""
    if not value:
        raise ValueError(f"{field} is required")
    if not value.isdecimal():
        raise ValueError(f"invalid {field}: {value}")
    parsed = int(value, 10)
    if parsed <= 0 or str(parsed) != value:
        raise ValueError(f"invalid {field}: {value}")
    return parsed


def parse_subscription_expires(value: str) -> datetime:
    """Parse subscriptionExpires as RFC3339."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid subscriptionExpires: {value}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"invalid subscriptionExpires: {value}")
    return parsed.astimezone(UTC)
