"""Helpers for selecting client-compatible payment challenges."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

from solana_mpp._types import PaymentChallenge
from solana_mpp.protocol.intents import ChargeRequest
from solana_mpp.protocol.solana import MethodDetails, resolve_mint

CurrencyPreference = str | Sequence[str]


def is_solana_charge_challenge(challenge: PaymentChallenge) -> bool:
    """Return True when a challenge is a valid Solana charge challenge."""
    if challenge.method != "solana" or challenge.intent != "charge":
        return False

    try:
        _decode_charge_request(challenge)
    except (TypeError, ValueError):
        return False
    return True


def select_solana_charge_challenge(
    challenges: Iterable[PaymentChallenge],
    *,
    currency: CurrencyPreference | None = None,
    network: str | None = None,
) -> PaymentChallenge | None:
    """Select the first Solana charge challenge matching client preferences.

    Server responses may include multiple challenges for the same resource,
    commonly one per supported stablecoin. This helper preserves server order,
    optionally filtering by Solana network and accepted currency.
    """
    candidates: list[tuple[PaymentChallenge, ChargeRequest, MethodDetails]] = []

    for challenge in challenges:
        if challenge.method != "solana" or challenge.intent != "charge":
            continue

        request = _decode_charge_request(challenge)
        details = _decode_method_details(request)
        if network is not None and details.network != network:
            continue

        candidates.append((challenge, request, details))

    accepted_currencies = _normalize_currency_preference(currency)
    if not accepted_currencies:
        return candidates[0][0] if candidates else None

    for accepted_currency in accepted_currencies:
        for challenge, request, details in candidates:
            if _currencies_match(request.currency, accepted_currency, details.network):
                return challenge

    return None


def _decode_charge_request(challenge: PaymentChallenge) -> ChargeRequest:
    try:
        data = challenge.decode_request()
    except Exception as exc:
        raise ValueError("Invalid Solana charge challenge request") from exc

    if not isinstance(data, dict):
        raise ValueError("Invalid Solana charge challenge request")

    request = ChargeRequest.from_dict(data)
    if not request.amount or not request.currency or not request.recipient:
        raise ValueError("Invalid Solana charge challenge request")
    if not isinstance(request.method_details, dict):
        raise ValueError("Invalid Solana charge challenge request")
    return request


def _decode_method_details(request: ChargeRequest) -> MethodDetails:
    method_details: Any = request.method_details
    if not isinstance(method_details, dict):
        raise ValueError("Invalid Solana charge challenge methodDetails")
    return MethodDetails.from_dict(method_details)


def _normalize_currency_preference(currency: CurrencyPreference | None) -> tuple[str, ...]:
    if currency is None:
        return ()
    if isinstance(currency, str):
        return (currency,)
    return tuple(currency)


def _currencies_match(challenge_currency: str, accepted_currency: str, network: str) -> bool:
    challenge_mint = resolve_mint(challenge_currency, network)
    accepted_mint = resolve_mint(accepted_currency, network)
    return challenge_mint == accepted_mint
