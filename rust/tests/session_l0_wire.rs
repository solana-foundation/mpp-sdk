//! L0 wire format tests.
//!
//! Two kinds of assertions per wire type:
//!   1. `*_roundtrip`, survives T to JSON to T without field drops/renames.
//!   2. `*_json_shape_is_stable`, literal `serde_json::json!(...)` fixture
//!      equality so a rename (e.g. `channelId` to `chanId`) fails the test.
//!      Roundtrip alone does NOT catch renames.
//!
//! Also covers JCS canonicalization + base64url transport via the existing
//! helpers in `rust/src/protocol/intents/mod.rs` (`serialize_request` /
//! `deserialize_request`).

use solana_mpp::protocol::intents::session::*;

fn roundtrip<T: serde::Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug>(v: &T) {
    let json = serde_json::to_string(v).expect("serialize");
    let back: T = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(v, &back, "roundtrip diff:\n  original: {v:?}\n  roundtrip: {back:?}\n  json: {json}");
}

#[test]
fn voucher_data_roundtrip_minimal() {
    roundtrip(&VoucherData {
        channel_id: "ChA9XyZabcdef1234567890abcdef1234567890abc".into(),
        cumulative_amount: "42500".into(),
        expires_at: None,
    });
}

#[test]
fn voucher_data_roundtrip_with_expiry() {
    roundtrip(&VoucherData {
        channel_id: "ChA9XyZabcdef1234567890abcdef1234567890abc".into(),
        cumulative_amount: "842500".into(),
        // RFC3339 wire form.
        expires_at: Some("2025-04-20T18:30:00Z".into()),
    });
}

#[test]
fn signed_voucher_roundtrip() {
    roundtrip(&SignedVoucher {
        voucher: VoucherData {
            channel_id: "ChA...".into(),
            cumulative_amount: "1000".into(),
            expires_at: None,
        },
        signer: "Sgnr...".into(),
        signature: "Sg1...".into(),
        signature_type: SigType::Ed25519,
    });
}

#[test]
fn session_request_roundtrip() {
    roundtrip(&SessionRequest {
        amount: "10".into(),
        unit_type: Some("request".into()),
        recipient: "PayeeMerchant1234567890abcdefghijklmnop".into(),
        currency: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".into(),
        description: None,
        external_id: None,
        method_details: MethodDetails {
            network: Some("mainnet-beta".into()),
            channel_program: "PayCh111111111111111111111111111111111111".into(),
            channel_id: None,
            decimals: Some(6),
            token_program: None,
            fee_payer: Some(true),
            fee_payer_key: Some("SrvrFeePayer9876543210zyxwvutsrqponmlkji".into()),
            recent_blockhash: Some("GHtXQBsoZHVnNFa9YevAzFr1aDZ9tNDTSyhb5nhHUknz".into()),
            min_voucher_delta: None,
            ttl_seconds: None,
            grace_period_seconds: Some(900),
            distribution_splits: vec![
                BpsSplit { recipient: "PayeeMerchant1234567890abcdefghijklmnop".into(), share_bps: 9_500 },
                BpsSplit { recipient: "PltfrmFee456789abcdefghijklmnopqrstuv".into(), share_bps: 500 },
            ],
            minimum_deposit: "1000000".into(),
        },
    });
}

#[test]
fn session_action_open_roundtrip() {
    let action = SessionAction::Open(OpenPayload {
        challenge_id: "018f1a2b-7d1e-7c4a-9e12-3d0f5a8b2c4d".into(),
        channel_id: "ChA9XyZ...".into(),
        payer: "PayerA...".into(),
        payee: "PayeeM...".into(),
        mint: "EPjFWdd5...".into(),
        authorized_signer: "PayerA...".into(),
        salt: "42".into(),
        bump: 254,
        deposit_amount: "1000000".into(),
        distribution_splits: vec![BpsSplit { recipient: "r".into(), share_bps: 10_000 }],
        transaction: "AQABA...".into(),
    });
    roundtrip(&action);
}

#[test]
fn session_action_voucher_roundtrip() {
    // Voucher variant wraps SignedVoucher directly: wire is
    // {"action":"voucher", "voucher":{...}, "signer":..., ...} with the
    // SignedVoucher fields flat beside `action`, no nested `voucher` wrapper.
    roundtrip(&SessionAction::Voucher(SignedVoucher {
        voucher: VoucherData {
            channel_id: "ChA...".into(),
            cumulative_amount: "500".into(),
            expires_at: None,
        },
        signer: "Sgnr...".into(),
        signature: "Sg1...".into(),
        signature_type: SigType::Ed25519,
    }));
}

#[test]
fn session_action_topup_roundtrip() {
    roundtrip(&SessionAction::TopUp(TopUpPayload {
        challenge_id: "018f1c3d-...".into(),
        channel_id: "ChA...".into(),
        additional_amount: "500000".into(),
        transaction: "AQABA...".into(),
    }));
}

#[test]
fn session_action_close_with_voucher_roundtrip() {
    roundtrip(&SessionAction::Close(ClosePayload {
        challenge_id: "018f1d4e-...".into(),
        channel_id: "ChA...".into(),
        voucher: Some(SignedVoucher {
            voucher: VoucherData {
                channel_id: "ChA...".into(),
                cumulative_amount: "842500".into(),
                expires_at: Some("2025-04-20T18:30:00Z".into()),
            },
            signer: "Sgnr...".into(),
            signature: "Sg1...".into(),
            signature_type: SigType::Ed25519,
        }),
    }));
}

#[test]
fn session_action_close_without_voucher_omits_voucher_field() {
    // Confirm `voucher` is absent (not `null`) in JSON when None, required so the
    // program doesn't see a null where it expects a struct or an absent field.
    let action = SessionAction::Close(ClosePayload {
        challenge_id: "c".into(),
        channel_id: "ch".into(),
        voucher: None,
    });
    let json = serde_json::to_string(&action).expect("serialize");
    assert!(
        !json.contains("voucher"),
        "close without voucher should omit the field; got {json}"
    );
}

#[test]
fn session_action_close_without_voucher_roundtrip() {
    roundtrip(&SessionAction::Close(ClosePayload {
        challenge_id: "c".into(),
        channel_id: "ch".into(),
        voucher: None,
    }));
}

#[test]
fn action_tag_is_camelcase_action_field() {
    let action = SessionAction::TopUp(TopUpPayload {
        challenge_id: "c".into(),
        channel_id: "ch".into(),
        additional_amount: "1".into(),
        transaction: "tx".into(),
    });
    let json = serde_json::to_string(&action).expect("serialize");
    // Verify the action tag is rendered as `"action":"topUp"` per ADR-002 camelCase.
    assert!(json.contains(r#""action":"topUp""#), "unexpected action tag serialization: {json}");
}

// ── Literal JSON shape fixtures (rename detection) ─────────────────────────
//
// These lock the EXACT camelCase keys the wire contract requires. A rename
// (e.g. `channelId` to `chanId`) fails here even though T to JSON to T
// roundtrip above would still pass cleanly.

#[test]
fn voucher_data_json_shape_is_stable() {
    let sample = VoucherData {
        channel_id: "ChA".into(),
        cumulative_amount: "500".into(),
        expires_at: Some("2025-04-20T18:30:00Z".into()),
    };
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(json, serde_json::json!({
        "channelId": "ChA",
        "cumulativeAmount": "500",
        "expiresAt": "2025-04-20T18:30:00Z",
    }));
}

#[test]
fn signed_voucher_json_shape_is_stable() {
    let sample = SignedVoucher {
        voucher: VoucherData {
            channel_id: "ChA".into(),
            cumulative_amount: "500".into(),
            expires_at: None,
        },
        signer: "Sgnr".into(),
        signature: "Sg1".into(),
        signature_type: SigType::Ed25519,
    };
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(json, serde_json::json!({
        "voucher": { "channelId": "ChA", "cumulativeAmount": "500" },
        "signer": "Sgnr",
        "signature": "Sg1",
        "signatureType": "ed25519",
    }));
}

#[test]
fn bps_split_json_shape_is_stable() {
    let sample = BpsSplit { recipient: "R".into(), share_bps: 9_500 };
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(json, serde_json::json!({
        "recipient": "R",
        "shareBps": 9_500,
    }));
}

#[test]
fn session_request_json_shape_is_stable() {
    let sample = SessionRequest {
        amount: "10".into(),
        unit_type: Some("request".into()),
        recipient: "P".into(),
        currency: "M".into(),
        description: None,
        external_id: None,
        method_details: MethodDetails {
            network: None,
            channel_program: "Prg".into(),
            channel_id: None,
            decimals: None,
            token_program: None,
            fee_payer: None,
            fee_payer_key: None,
            recent_blockhash: None,
            min_voucher_delta: None,
            ttl_seconds: None,
            grace_period_seconds: None,
            distribution_splits: vec![],
            minimum_deposit: "0".into(),
        },
    };
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(json, serde_json::json!({
        "amount": "10",
        "unitType": "request",
        "recipient": "P",
        "currency": "M",
        "methodDetails": {
            "channelProgram": "Prg",
            "distributionSplits": [],
            "minimumDeposit": "0",
        },
    }));
}

#[test]
fn method_details_json_shape_is_stable() {
    let sample = MethodDetails {
        network: Some("mainnet-beta".into()),
        channel_program: "Prg".into(),
        channel_id: Some("ChA".into()),
        decimals: Some(6),
        token_program: Some("Tok".into()),
        fee_payer: Some(true),
        fee_payer_key: Some("Fp".into()),
        recent_blockhash: Some("Bh".into()),
        min_voucher_delta: Some("1".into()),
        ttl_seconds: Some(900),
        grace_period_seconds: Some(86_400),
        distribution_splits: vec![BpsSplit { recipient: "R".into(), share_bps: 10_000 }],
        minimum_deposit: "1000".into(),
    };
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(json, serde_json::json!({
        "network": "mainnet-beta",
        "channelProgram": "Prg",
        "channelId": "ChA",
        "decimals": 6,
        "tokenProgram": "Tok",
        "feePayer": true,
        "feePayerKey": "Fp",
        "recentBlockhash": "Bh",
        "minVoucherDelta": "1",
        "ttlSeconds": 900,
        "gracePeriodSeconds": 86_400,
        "distributionSplits": [{ "recipient": "R", "shareBps": 10_000 }],
        "minimumDeposit": "1000",
    }));
}

#[test]
fn open_payload_json_shape_is_stable() {
    let sample = OpenPayload {
        challenge_id: "cid".into(),
        channel_id: "ChA".into(),
        payer: "Pa".into(),
        payee: "Pe".into(),
        mint: "M".into(),
        authorized_signer: "As".into(),
        salt: "42".into(),
        bump: 254,
        deposit_amount: "1000".into(),
        distribution_splits: vec![BpsSplit { recipient: "R".into(), share_bps: 10_000 }],
        transaction: "AQ".into(),
    };
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(json, serde_json::json!({
        "challengeId": "cid",
        "channelId": "ChA",
        "payer": "Pa",
        "payee": "Pe",
        "mint": "M",
        "authorizedSigner": "As",
        "salt": "42",
        "bump": 254,
        "depositAmount": "1000",
        "distributionSplits": [{ "recipient": "R", "shareBps": 10_000 }],
        "transaction": "AQ",
    }));
}

#[test]
fn topup_payload_json_shape_is_stable() {
    let sample = TopUpPayload {
        challenge_id: "cid".into(),
        channel_id: "ChA".into(),
        additional_amount: "500".into(),
        transaction: "AQ".into(),
    };
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(json, serde_json::json!({
        "challengeId": "cid",
        "channelId": "ChA",
        "additionalAmount": "500",
        "transaction": "AQ",
    }));
}

#[test]
fn close_payload_json_shape_is_stable() {
    let sample = ClosePayload {
        challenge_id: "cid".into(),
        channel_id: "ChA".into(),
        voucher: None,
    };
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(json, serde_json::json!({
        "challengeId": "cid",
        "channelId": "ChA",
    }));
}

#[test]
fn session_action_voucher_json_shape_is_flat() {
    // Voucher variant flattens SignedVoucher fields beside the action
    // tag. NO nested `voucher_payload` wrapper.
    let sample = SessionAction::Voucher(SignedVoucher {
        voucher: VoucherData {
            channel_id: "ChA".into(),
            cumulative_amount: "500".into(),
            expires_at: None,
        },
        signer: "Sgnr".into(),
        signature: "Sg1".into(),
        signature_type: SigType::Ed25519,
    });
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(json, serde_json::json!({
        "action": "voucher",
        "voucher": { "channelId": "ChA", "cumulativeAmount": "500" },
        "signer": "Sgnr",
        "signature": "Sg1",
        "signatureType": "ed25519",
    }));
}

#[test]
fn session_action_open_json_shape_is_stable() {
    let sample = SessionAction::Open(OpenPayload {
        challenge_id: "cid".into(),
        channel_id: "ChA".into(),
        payer: "Pa".into(),
        payee: "Pe".into(),
        mint: "M".into(),
        authorized_signer: "As".into(),
        salt: "42".into(),
        bump: 254,
        deposit_amount: "1000".into(),
        distribution_splits: vec![],
        transaction: "AQ".into(),
    });
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "action": "open",
            "challengeId": "cid",
            "channelId": "ChA",
            "payer": "Pa",
            "payee": "Pe",
            "mint": "M",
            "authorizedSigner": "As",
            "salt": "42",
            "bump": 254,
            "depositAmount": "1000",
            "distributionSplits": [],
            "transaction": "AQ",
        })
    );
}

#[test]
fn session_action_topup_json_shape_is_stable() {
    let sample = SessionAction::TopUp(TopUpPayload {
        challenge_id: "cid".into(),
        channel_id: "ChA".into(),
        additional_amount: "500".into(),
        transaction: "AQ".into(),
    });
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(json, serde_json::json!({
        "action": "topUp",
        "challengeId": "cid",
        "channelId": "ChA",
        "additionalAmount": "500",
        "transaction": "AQ",
    }));
}

#[test]
fn session_action_close_json_shape_is_stable() {
    let sample = SessionAction::Close(ClosePayload {
        challenge_id: "cid".into(),
        channel_id: "ChA".into(),
        voucher: None,
    });
    let json = serde_json::to_value(&sample).unwrap();
    assert_eq!(json, serde_json::json!({
        "action": "close",
        "challengeId": "cid",
        "channelId": "ChA",
    }));
}

// ── JCS + base64url canonicalization roundtrip ─────────────────────────────
//
// The helpers in `rust/src/protocol/intents/mod.rs` (`serialize_request` /
// `deserialize_request`) apply JCS canonicalization on the way out and
// base64url on top. Assert every session wire type round-trips through them.

#[test]
fn session_request_jcs_base64url_roundtrip() {
    use solana_mpp::protocol::intents::{serialize_request, deserialize_request};
    let sample = SessionRequest {
        amount: "10".into(),
        unit_type: Some("request".into()),
        recipient: "P".into(),
        currency: "M".into(),
        description: None,
        external_id: None,
        method_details: MethodDetails {
            network: None,
            channel_program: "Prg".into(),
            channel_id: None,
            decimals: None,
            token_program: None,
            fee_payer: None,
            fee_payer_key: None,
            recent_blockhash: None,
            min_voucher_delta: None,
            ttl_seconds: None,
            grace_period_seconds: None,
            distribution_splits: vec![],
            minimum_deposit: "0".into(),
        },
    };
    let encoded = serialize_request(&sample).expect("jcs serialize");
    let decoded: SessionRequest = deserialize_request(&encoded).expect("jcs deserialize");
    assert_eq!(sample, decoded);
}

#[test]
fn session_action_jcs_base64url_roundtrip_all_variants() {
    use solana_mpp::protocol::intents::{serialize_request, deserialize_request};
    let cases = vec![
        SessionAction::Open(OpenPayload {
            challenge_id: "cid".into(),
            channel_id: "ChA".into(),
            payer: "Pa".into(),
            payee: "Pe".into(),
            mint: "M".into(),
            authorized_signer: "As".into(),
            salt: "42".into(),
            bump: 254,
            deposit_amount: "1000".into(),
            distribution_splits: vec![],
            transaction: "AQ".into(),
        }),
        SessionAction::Voucher(SignedVoucher {
            voucher: VoucherData {
                channel_id: "ChA".into(),
                cumulative_amount: "500".into(),
                expires_at: Some("2025-04-20T18:30:00Z".into()),
            },
            signer: "Sgnr".into(),
            signature: "Sg1".into(),
            signature_type: SigType::Ed25519,
        }),
        SessionAction::TopUp(TopUpPayload {
            challenge_id: "cid".into(),
            channel_id: "ChA".into(),
            additional_amount: "500".into(),
            transaction: "AQ".into(),
        }),
        SessionAction::Close(ClosePayload {
            challenge_id: "cid".into(),
            channel_id: "ChA".into(),
            voucher: None,
        }),
    ];
    for sample in &cases {
        let encoded = serialize_request(sample).expect("jcs serialize");
        let decoded: SessionAction = deserialize_request(&encoded).expect("jcs deserialize");
        assert_eq!(sample, &decoded, "jcs roundtrip mismatch on {sample:?}");
    }
}

// ── Negative coverage: malformed JSON and unknown tag rejection ──────────

#[test]
fn session_action_rejects_unknown_action_tag() {
    let bad = r#"{"action":"unknown","challengeId":"c","channelId":"ch"}"#;
    let result: Result<SessionAction, _> = serde_json::from_str(bad);
    assert!(
        result.is_err(),
        "expected deserialization to reject unknown action tag, got {result:?}"
    );
}

#[test]
fn session_action_rejects_missing_action_tag() {
    let bad = r#"{"challengeId":"c","channelId":"ch"}"#;
    let result: Result<SessionAction, _> = serde_json::from_str(bad);
    assert!(
        result.is_err(),
        "expected deserialization to reject payload without action tag, got {result:?}"
    );
}

#[test]
fn voucher_data_rejects_missing_required_field() {
    // `cumulativeAmount` is required; the wire form must reject a payload
    // that drops it rather than silently defaulting to an empty string.
    let bad = r#"{"channelId":"ChA"}"#;
    let result: Result<VoucherData, _> = serde_json::from_str(bad);
    assert!(
        result.is_err(),
        "expected deserialization to reject voucher data missing cumulativeAmount, got {result:?}"
    );
}
