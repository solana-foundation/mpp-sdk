"""Payment decorator for ASGI/Starlette-style handlers."""

from __future__ import annotations

import functools
from collections.abc import Callable
from typing import Any

from solana_mpp._headers import format_www_authenticate
from solana_mpp.server.mpp import Mpp


def pay(mpp_handler: Mpp, amount: str, **options: Any) -> Callable:
    """Decorator for ASGI/Starlette-style handlers.

    Wraps a handler to automatically handle 402 Payment Required flows.
    The decorated handler receives (request, credential, receipt) when
    payment is verified.

    Example:
        @app.get("/paid")
        @pay(mpp, amount="0.50")
        async def handler(request, credential, receipt):
            return {"data": "paid content"}
    """
    from solana_mpp._headers import parse_authorization
    from solana_mpp.protocol.intents import ChargeRequest
    from solana_mpp.server.mpp import ChargeOptions

    charge_options = ChargeOptions(
        description=options.get("description", ""),
        external_id=options.get("external_id", ""),
        expires=options.get("expires", ""),
        fee_payer=options.get("fee_payer", False),
        splits=options.get("splits", []),
    )

    def decorator(handler: Callable) -> Callable:
        @functools.wraps(handler)
        async def wrapper(request: Any, *args: Any, **kwargs: Any) -> Any:
            # Build the route's expected charge first so verification can be
            # route-aware: the credential's claimed amount is compared to this
            # route's expected amount, not just to itself.
            challenge = mpp_handler.charge_with_options(amount, charge_options)

            # Try to get Authorization header
            auth_header = None
            if hasattr(request, "headers"):
                auth_header = request.headers.get("authorization")

            if auth_header:
                try:
                    credential = parse_authorization(auth_header)
                    expected = ChargeRequest.from_dict(challenge.decode_request())
                    receipt = await mpp_handler.verify_credential_with_expected(credential, expected)
                    return await handler(request, credential, receipt, *args, **kwargs)
                except Exception:
                    pass

            # Issue challenge
            www_auth = format_www_authenticate(challenge)

            # Return a dict that the framework can use to build a 402 response
            return {
                "__mpp_challenge": True,
                "status_code": 402,
                "headers": {"WWW-Authenticate": www_auth},
                "challenge": challenge,
            }

        return wrapper

    return decorator
