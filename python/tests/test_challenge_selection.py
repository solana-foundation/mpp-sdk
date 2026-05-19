"""Tests for client challenge selection helpers."""

from __future__ import annotations

import pytest

from solana_mpp._base64url import encode_json
from solana_mpp._types import PaymentChallenge
from solana_mpp.client.challenge_selection import (
    is_solana_charge_challenge,
    select_solana_charge_challenge,
)
from solana_mpp.protocol.solana import resolve_mint


def _challenge(
    *,
    id_: str,
    currency: str = "USDC",
    network: str = "mainnet-beta",
    method: str = "solana",
    intent: str = "charge",
    request: dict | None = None,
) -> PaymentChallenge:
    request_obj = request or {
        "amount": "1000000",
        "currency": currency,
        "methodDetails": {"network": network},
        "recipient": "recipient",
    }
    return PaymentChallenge(
        id=id_,
        realm="api",
        method=method,
        intent=intent,
        request=encode_json(request_obj),
    )


class TestIsSolanaChargeChallenge:
    def test_accepts_valid_solana_charge_challenge(self):
        assert is_solana_charge_challenge(_challenge(id_="usdc"))

    def test_rejects_other_method_or_intent(self):
        assert not is_solana_charge_challenge(_challenge(id_="card", method="card"))
        assert not is_solana_charge_challenge(_challenge(id_="refund", intent="refund"))

    def test_rejects_invalid_charge_request(self):
        challenge = _challenge(id_="invalid", request={"currency": "USDC"})
        assert not is_solana_charge_challenge(challenge)


class TestSelectSolanaChargeChallenge:
    def test_preserves_server_order_without_preferences(self):
        first = _challenge(id_="first", currency="USDC")
        second = _challenge(id_="second", currency="PYUSD")

        selected = select_solana_charge_challenge([first, second])

        assert selected is first

    def test_filters_by_network(self):
        mainnet = _challenge(id_="mainnet", currency="USDC", network="mainnet-beta")
        devnet = _challenge(id_="devnet", currency="USDC", network="devnet")

        selected = select_solana_charge_challenge([mainnet, devnet], network="devnet")

        assert selected is devnet

    def test_defaults_missing_network_to_mainnet_beta(self):
        challenge = _challenge(
            id_="default-network",
            request={
                "amount": "1000000",
                "currency": "USDC",
                "methodDetails": {},
                "recipient": "recipient",
            },
        )

        selected = select_solana_charge_challenge([challenge], network="mainnet-beta")

        assert selected is challenge

    def test_filters_by_currency_symbol_preference(self):
        usdc = _challenge(id_="usdc", currency="USDC")
        pyusd = _challenge(id_="pyusd", currency="PYUSD")

        selected = select_solana_charge_challenge([usdc, pyusd], currency="PYUSD")

        assert selected is pyusd

    def test_filters_by_ordered_currency_preferences(self):
        usdc = _challenge(id_="usdc", currency="USDC")
        pyusd = _challenge(id_="pyusd", currency="PYUSD")

        selected = select_solana_charge_challenge([usdc, pyusd], currency=["USDG", "PYUSD"])

        assert selected is pyusd

    def test_matches_symbol_against_mint_on_same_network(self):
        devnet_usdc_mint = resolve_mint("USDC", "devnet")
        challenge = _challenge(id_="devnet-usdc-mint", currency=devnet_usdc_mint, network="devnet")

        selected = select_solana_charge_challenge([challenge], currency="USDC", network="devnet")

        assert selected is challenge

    def test_ignores_non_matching_challenges(self):
        refund = _challenge(id_="refund", intent="refund")
        card = _challenge(id_="card", method="card")

        selected = select_solana_charge_challenge([refund, card])

        assert selected is None

    def test_raises_for_invalid_matching_charge_request(self):
        invalid = _challenge(id_="invalid", request={"currency": "USDC"})

        with pytest.raises(ValueError, match="Invalid Solana charge challenge request"):
            select_solana_charge_challenge([invalid])
