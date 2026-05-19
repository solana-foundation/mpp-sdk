"""Tests for subscription intent types."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from solana_mpp.protocol.subscriptions import (
    SubscriptionPeriodUnit,
    SubscriptionReceipt,
    SubscriptionRequest,
    parse_subscription_expires,
)


def test_subscription_request_to_dict_uses_wire_field_names() -> None:
    request = SubscriptionRequest(
        amount="1000000",
        currency="usd",
        period_unit=SubscriptionPeriodUnit.MONTH,
        period_count="1",
        description="Monthly API plan",
        external_id="plan_monthly_api",
    )

    assert request.to_dict() == {
        "amount": "1000000",
        "currency": "usd",
        "periodUnit": "month",
        "periodCount": "1",
        "description": "Monthly API plan",
        "externalId": "plan_monthly_api",
    }


def test_subscription_request_roundtrip_and_validate() -> None:
    request = SubscriptionRequest.from_dict(
        {
            "amount": "10000000",
            "currency": "0x20c0000000000000000000000000000000000001",
            "periodUnit": "day",
            "periodCount": "30",
            "subscriptionExpires": "2026-07-14T12:00:00Z",
            "recipient": "0x742d35cc6634c0532925a3b844bc9e7595f8fe00",
            "methodDetails": {"chainId": 42431},
        }
    )

    request.validate()

    assert request.period_unit == SubscriptionPeriodUnit.DAY
    assert request.to_dict()["periodCount"] == "30"


@pytest.mark.parametrize(
    "payload",
    [
        {"amount": "0", "currency": "usd", "periodUnit": "month", "periodCount": "1"},
        {"amount": "9.99", "currency": "usd", "periodUnit": "month", "periodCount": "1"},
        {"amount": "100", "currency": "", "periodUnit": "month", "periodCount": "1"},
        {"amount": "100", "currency": "usd", "periodUnit": "year", "periodCount": "1"},
        {"amount": "100", "currency": "usd", "periodUnit": "month", "periodCount": "0"},
        {"amount": "100", "currency": "usd", "periodUnit": "month", "periodCount": "01"},
        {
            "amount": "100",
            "currency": "usd",
            "periodUnit": "month",
            "periodCount": "1",
            "subscriptionExpires": "not-a-date",
        },
    ],
)
def test_subscription_request_rejects_invalid_shapes(payload: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        SubscriptionRequest.from_dict(payload).validate()


def test_parse_subscription_expires_requires_rfc3339_timezone() -> None:
    assert parse_subscription_expires("2026-07-14T12:00:00Z") == datetime(2026, 7, 14, 12, tzinfo=UTC)

    with pytest.raises(ValueError, match="invalid subscriptionExpires"):
        parse_subscription_expires("2026-07-14T12:00:00")


def test_subscription_receipt_to_dict_uses_wire_field_names() -> None:
    receipt = SubscriptionReceipt(
        method="tempo",
        reference="0xabc",
        status="success",
        subscription_id="c3ViXzAxMjM0NTY",
        timestamp="2026-01-15T12:03:10Z",
    )

    assert receipt.to_dict() == {
        "method": "tempo",
        "reference": "0xabc",
        "status": "success",
        "subscriptionId": "c3ViXzAxMjM0NTY",
        "timestamp": "2026-01-15T12:03:10Z",
    }
