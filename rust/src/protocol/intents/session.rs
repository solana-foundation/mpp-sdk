//! Session intent request and voucher types.
//!
//! The session intent opens a payment channel between a client and server,
//! allowing incremental payments via off-chain signed vouchers backed by
//! an on-chain escrow (Fiber channel) or SPL token delegation.

use serde::{Deserialize, Serialize};

/// On-chain funding mechanism for a session.
///
/// Advertised by the server in [`SessionRequest::modes`]; the client picks
/// the mode it will use when sending its [`SessionAction::Open`].
///
/// Naming mirrors the charge intent:
///
/// | Mode | Charge analogy | Who pays on-chain fees |
/// |------|---------------|------------------------|
/// | `push` | push (client broadcasts) | Client |
/// | `pull` | pull (server broadcasts) | Operator |
///
/// ## Push
/// Client opens a Fiber payment channel, locking funds as a deposit.
/// Client needs SOL (for fees) + the session token (e.g. USDC).
///
/// ## Pull
/// Client calls SPL `approve` via the
/// [multi-delegator](https://github.com/solana-program/multi-delegator)
/// program, designating the operator as a token delegate up to
/// `approved_amount`.  The operator fee-pays and broadcasts the approve
/// transaction, then pulls from the token account at session close.
/// Client only needs the session token — no SOL required.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionMode {
    /// Fiber payment channel backed by an on-chain escrow deposit (client-funded).
    Push,
    /// SPL token delegation — operator fee-pays the approve tx and pulls at close.
    Pull,
}

/// Session intent request — the payload embedded in a 402 challenge.
///
/// Describes the channel parameters: cap, currency, splits, network, etc.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRequest {
    /// Maximum total amount the client may spend in this session (base units).
    pub cap: String,

    /// Currency/asset identifier (e.g., "USDC", mint address).
    pub currency: String,

    /// Token decimals (default 6 for USDC-like tokens).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decimals: Option<u8>,

    /// Solana network: "mainnet-beta", "devnet", "localnet".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<String>,

    /// Operator (server) public key (base58).
    pub operator: String,

    /// Primary recipient for channel proceeds (base58).
    pub recipient: String,

    /// Optional splits: fixed portions routed to specific recipients at close.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub splits: Vec<SessionSplit>,

    /// Channel program ID (base58). Defaults to the canonical Fiber program.
    #[serde(rename = "programId", skip_serializing_if = "Option::is_none")]
    pub program_id: Option<String>,

    /// Human-readable description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Merchant reference ID.
    #[serde(rename = "externalId", skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,

    /// Minimum voucher increment (base units). Prevents micro-increment spam.
    #[serde(rename = "minVoucherDelta", skip_serializing_if = "Option::is_none")]
    pub min_voucher_delta: Option<String>,

    /// Session modes supported by this server.
    ///
    /// Omitted/empty means only [`SessionMode::Push`] is supported.
    /// The client MUST use one of the advertised modes in its `open` action.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modes: Vec<SessionMode>,

    /// Recent blockhash pre-fetched by the server (base58).
    ///
    /// Included for pull-mode so the client can build delegation transactions
    /// without a second RPC round-trip. The client SHOULD use this when
    /// present rather than fetching its own.
    #[serde(rename = "recentBlockhash", skip_serializing_if = "Option::is_none")]
    pub recent_blockhash: Option<String>,
}

/// A payment split committed at channel open; distributed to a specific
/// recipient when the channel closes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSplit {
    /// Recipient address (base58).
    pub recipient: String,

    /// Fixed amount in base units.
    pub amount: String,
}

// ── Client actions ──

/// The action submitted by the client in an Authorization header.
///
/// Serialized as a tagged object with `"action": "open" | "voucher" | "topup" | "close"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum SessionAction {
    /// Open a new channel/delegation and start the session.
    Open(OpenPayload),

    /// Submit a signed voucher authorizing payment for an API call.
    Voucher(VoucherPayload),

    /// Top up an existing channel's deposit.
    TopUp(TopUpPayload),

    /// Request cooperative close of the channel.
    Close(ClosePayload),
}

/// Payload for the `open` action.
///
/// Use [`OpenPayload::push`] or [`OpenPayload::pull`] to construct.
/// Inspect [`OpenPayload::mode`] to distinguish variants on the server.
///
/// Wire format:
/// ```json
/// // Push mode
/// {"action":"open","mode":"push","channelId":"...","deposit":"...","authorizedSigner":"...","signature":"..."}
///
/// // Pull mode
/// {"action":"open","mode":"pull","tokenAccount":"...","approvedAmount":"...","authorizedSigner":"...","signature":"..."}
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenPayload {
    /// Session mode discriminant.
    pub mode: SessionMode,

    // ── Push mode ──────────────────────────────────────────────────────────
    /// Fiber channel address (base58). Required for `push` mode.
    #[serde(rename = "channelId", skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,

    /// Deposit locked on-chain (base units). Required for `push` mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deposit: Option<String>,

    // ── Pull mode ──────────────────────────────────────────────────────────
    /// SPL token account being delegated (base58). Required for `pull` mode.
    #[serde(rename = "tokenAccount", skip_serializing_if = "Option::is_none")]
    pub token_account: Option<String>,

    /// Amount approved for operator delegation (base units). Required for `pull` mode.
    #[serde(rename = "approvedAmount", skip_serializing_if = "Option::is_none")]
    pub approved_amount: Option<String>,

    /// Client wallet pubkey (base58). Required for `pull` mode.
    ///
    /// The operator uses this to derive the MultiDelegate PDA and build the
    /// `TransferFixed` instruction data at settlement time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,

    /// Pre-signed transaction (base64) that creates the `MultiDelegate` PDA
    /// and an initial `FixedDelegation`.
    ///
    /// The client should always include this for pull-mode opens. The server
    /// submits it only if the `MultiDelegate` PDA does not yet exist on-chain.
    #[serde(
        rename = "initMultiDelegateTx",
        skip_serializing_if = "Option::is_none"
    )]
    pub init_multi_delegate_tx: Option<String>,

    /// Pre-signed transaction (base64) that creates or raises the
    /// `FixedDelegation` cap.
    ///
    /// The client should always include this for pull-mode opens. The server
    /// submits it only if the existing delegation cap is below the session cap.
    #[serde(rename = "updateDelegationTx", skip_serializing_if = "Option::is_none")]
    pub update_delegation_tx: Option<String>,

    // ── Shared ─────────────────────────────────────────────────────────────
    /// The public key authorized to sign vouchers for this session (base58).
    /// Usually an ephemeral key generated by the client.
    #[serde(rename = "authorizedSigner")]
    pub authorized_signer: String,

    /// Transaction signature (base58) proving the on-chain action.
    ///
    /// - Push: open transaction signature confirming the Fiber channel exists.
    /// - Pull: approve transaction signature confirming the SPL delegation.
    pub signature: String,
}

impl OpenPayload {
    /// Construct a **push** (Fiber channel) open payload.
    pub fn push(
        channel_id: String,
        deposit: String,
        authorized_signer: String,
        signature: String,
    ) -> Self {
        Self {
            mode: SessionMode::Push,
            channel_id: Some(channel_id),
            deposit: Some(deposit),
            token_account: None,
            approved_amount: None,
            owner: None,
            init_multi_delegate_tx: None,
            update_delegation_tx: None,
            authorized_signer,
            signature,
        }
    }

    /// Construct a **pull** (SPL delegation) open payload.
    pub fn pull(
        token_account: String,
        approved_amount: String,
        owner: String,
        authorized_signer: String,
        signature: String,
    ) -> Self {
        Self {
            mode: SessionMode::Pull,
            channel_id: None,
            deposit: None,
            token_account: Some(token_account),
            approved_amount: Some(approved_amount),
            owner: Some(owner),
            init_multi_delegate_tx: None,
            update_delegation_tx: None,
            authorized_signer,
            signature,
        }
    }

    /// Attach a pre-signed `InitMultiDelegate` + `CreateFixedDelegation`
    /// transaction.  The server submits this if the `MultiDelegate` PDA does
    /// not yet exist on-chain.
    pub fn with_init_tx(mut self, tx_base64: String) -> Self {
        self.init_multi_delegate_tx = Some(tx_base64);
        self
    }

    /// Attach a pre-signed `CreateFixedDelegation` (cap update) transaction.
    /// The server submits this if the existing delegation cap is below the
    /// session amount.
    pub fn with_update_tx(mut self, tx_base64: String) -> Self {
        self.update_delegation_tx = Some(tx_base64);
        self
    }

    /// Session identifier used as the store key.
    ///
    /// - Push: `channel_id` (Fiber channel address)
    /// - Pull: `token_account` (SPL token account address)
    pub fn session_id(&self) -> crate::error::Result<&str> {
        match self.mode {
            SessionMode::Push => self.channel_id.as_deref().ok_or_else(|| {
                crate::error::Error::Other("push open missing channelId".to_string())
            }),
            SessionMode::Pull => self.token_account.as_deref().ok_or_else(|| {
                crate::error::Error::Other("pull open missing tokenAccount".to_string())
            }),
        }
    }

    /// Deposit / approved amount for this open (base units).
    pub fn deposit_amount(&self) -> crate::error::Result<u64> {
        let raw = match self.mode {
            SessionMode::Push => self.deposit.as_deref().ok_or_else(|| {
                crate::error::Error::Other("push open missing deposit".to_string())
            })?,
            SessionMode::Pull => self.approved_amount.as_deref().ok_or_else(|| {
                crate::error::Error::Other("pull open missing approvedAmount".to_string())
            })?,
        };
        raw.parse()
            .map_err(|_| crate::error::Error::Other(format!("invalid deposit amount: {raw}")))
    }
}

/// Payload for the `voucher` action (per-request micropayment).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoucherPayload {
    /// The signed voucher authorizing cumulative spend.
    pub voucher: SignedVoucher,
}

/// Payload for the `topup` action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopUpPayload {
    /// The on-chain channel address (base58).
    #[serde(rename = "channelId")]
    pub channel_id: String,

    /// New total deposit amount after the top-up (base units).
    #[serde(rename = "newDeposit")]
    pub new_deposit: String,

    /// The top-up transaction signature (base58).
    pub signature: String,
}

/// Payload for the `close` action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClosePayload {
    /// The on-chain channel address (base58).
    #[serde(rename = "channelId")]
    pub channel_id: String,

    /// Final signed voucher for any remaining balance owed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voucher: Option<SignedVoucher>,
}

// ── Vouchers ──

/// A signed voucher authorizing cumulative payment up to `cumulative`.
///
/// Vouchers are **cumulative**: the server always uses the latest valid voucher
/// it has received. The client MUST increment `cumulative` with each request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedVoucher {
    /// The voucher content.
    pub data: VoucherData,

    /// Ed25519 signature over the JCS-canonical JSON of `data` (base64url).
    pub signature: String,
}

/// The canonical content of a voucher, signed by the client's session key.
///
/// Serialized using JCS (JSON Canonicalization Scheme) before signing to
/// ensure a deterministic byte representation across implementations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoucherData {
    /// The channel/session ID this voucher is bound to (base58).
    ///
    /// For push sessions: the Fiber channel address.
    /// For pull sessions: the SPL token account address.
    #[serde(rename = "channelId")]
    pub channel_id: String,

    /// Cumulative amount authorized (base units, monotonically increasing).
    pub cumulative: String,

    /// Nonce for freshness (e.g., request counter).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nonce: Option<u64>,
}

impl VoucherData {
    /// Serialize to canonical JSON bytes suitable for Ed25519 signing.
    pub fn canonical_bytes(&self) -> crate::error::Result<Vec<u8>> {
        serde_json_canonicalizer::to_string(self)
            .map(|s| s.into_bytes())
            .map_err(|e| crate::error::Error::Other(format!("JCS serialization failed: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── SessionMode ───────────────────────────────────────────────────────────

    #[test]
    fn session_mode_push_serializes_as_push() {
        let json = serde_json::to_string(&SessionMode::Push).unwrap();
        assert_eq!(json, r#""push""#);
    }

    #[test]
    fn session_mode_pull_serializes_as_pull() {
        let json = serde_json::to_string(&SessionMode::Pull).unwrap();
        assert_eq!(json, r#""pull""#);
    }

    #[test]
    fn session_mode_roundtrip() {
        for mode in [SessionMode::Push, SessionMode::Pull] {
            let json = serde_json::to_string(&mode).unwrap();
            let back: SessionMode = serde_json::from_str(&json).unwrap();
            assert_eq!(back, mode);
        }
    }

    // ── SessionRequest ────────────────────────────────────────────────────────

    #[test]
    fn session_request_roundtrip() {
        let req = SessionRequest {
            cap: "10000000".to_string(),
            currency: "USDC".to_string(),
            decimals: Some(6),
            network: Some("mainnet-beta".to_string()),
            operator: "CXhrFZJLKqjzmP3sjYLcF4dTeXWKCy9e2SXXZ2Yo6MPY".to_string(),
            recipient: "CXhrFZJLKqjzmP3sjYLcF4dTeXWKCy9e2SXXZ2Yo6MPY".to_string(),
            splits: vec![],
            program_id: None,
            description: Some("API session".to_string()),
            external_id: None,
            min_voucher_delta: None,
            modes: vec![SessionMode::Push],
            recent_blockhash: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: SessionRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.cap, "10000000");
        assert_eq!(back.currency, "USDC");
        assert_eq!(back.description.as_deref(), Some("API session"));
        assert_eq!(back.modes, vec![SessionMode::Push]);
    }

    #[test]
    fn session_request_omits_empty_splits_and_modes() {
        let req = SessionRequest {
            cap: "1000".to_string(),
            currency: "USDC".to_string(),
            decimals: None,
            network: None,
            operator: "op".to_string(),
            recipient: "rec".to_string(),
            splits: vec![],
            program_id: None,
            description: None,
            external_id: None,
            min_voucher_delta: None,
            modes: vec![],
            recent_blockhash: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("splits"));
        assert!(!json.contains("modes"));
        assert!(!json.contains("decimals"));
        assert!(!json.contains("network"));
        assert!(!json.contains("description"));
        assert!(!json.contains("externalId"));
    }

    #[test]
    fn session_request_with_modes_push_and_pull() {
        let req = SessionRequest {
            cap: "1000".to_string(),
            currency: "USDC".to_string(),
            decimals: None,
            network: None,
            operator: "op".to_string(),
            recipient: "rec".to_string(),
            splits: vec![],
            program_id: None,
            description: None,
            external_id: None,
            min_voucher_delta: None,
            modes: vec![SessionMode::Push, SessionMode::Pull],
            recent_blockhash: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"push\""));
        assert!(json.contains("\"pull\""));
        let back: SessionRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.modes.len(), 2);
        assert_eq!(back.modes[0], SessionMode::Push);
        assert_eq!(back.modes[1], SessionMode::Pull);
    }

    #[test]
    fn session_request_with_splits() {
        let req = SessionRequest {
            cap: "1000".to_string(),
            currency: "USDC".to_string(),
            decimals: None,
            network: None,
            operator: "op".to_string(),
            recipient: "rec".to_string(),
            splits: vec![
                SessionSplit {
                    recipient: "s1".to_string(),
                    amount: "100".to_string(),
                },
                SessionSplit {
                    recipient: "s2".to_string(),
                    amount: "200".to_string(),
                },
            ],
            program_id: Some("prog123".to_string()),
            description: None,
            external_id: Some("ref-1".to_string()),
            min_voucher_delta: None,
            modes: vec![],
            recent_blockhash: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: SessionRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.splits.len(), 2);
        assert_eq!(back.splits[0].amount, "100");
        assert_eq!(back.program_id.as_deref(), Some("prog123"));
        assert_eq!(back.external_id.as_deref(), Some("ref-1"));
    }

    // ── OpenPayload constructors ──────────────────────────────────────────────

    #[test]
    fn open_payload_push_fields() {
        let p = OpenPayload::push(
            "chan1".to_string(),
            "1000000".to_string(),
            "signer1".to_string(),
            "txsig".to_string(),
        );
        assert_eq!(p.mode, SessionMode::Push);
        assert_eq!(p.channel_id.as_deref(), Some("chan1"));
        assert_eq!(p.deposit.as_deref(), Some("1000000"));
        assert!(p.token_account.is_none());
        assert!(p.approved_amount.is_none());
        assert_eq!(p.authorized_signer, "signer1");
        assert_eq!(p.signature, "txsig");
    }

    #[test]
    fn open_payload_pull_fields() {
        let p = OpenPayload::pull(
            "tokacct".to_string(),
            "5000000".to_string(),
            "wallet1".to_string(),
            "signer1".to_string(),
            "approvesig".to_string(),
        );
        assert_eq!(p.mode, SessionMode::Pull);
        assert!(p.channel_id.is_none());
        assert!(p.deposit.is_none());
        assert_eq!(p.token_account.as_deref(), Some("tokacct"));
        assert_eq!(p.approved_amount.as_deref(), Some("5000000"));
        assert_eq!(p.owner.as_deref(), Some("wallet1"));
    }

    #[test]
    fn open_payload_push_session_id_and_deposit() {
        let p = OpenPayload::push(
            "chan1".to_string(),
            "2000000".to_string(),
            "s".to_string(),
            "sig".to_string(),
        );
        assert_eq!(p.session_id().unwrap(), "chan1");
        assert_eq!(p.deposit_amount().unwrap(), 2_000_000);
    }

    #[test]
    fn open_payload_pull_session_id_and_deposit() {
        let p = OpenPayload::pull(
            "tokacct".to_string(),
            "3000000".to_string(),
            "wallet1".to_string(),
            "s".to_string(),
            "sig".to_string(),
        );
        assert_eq!(p.session_id().unwrap(), "tokacct");
        assert_eq!(p.deposit_amount().unwrap(), 3_000_000);
    }

    #[test]
    fn open_payload_push_roundtrip_json() {
        let p = OpenPayload::push(
            "chan1".to_string(),
            "1000000".to_string(),
            "signer1".to_string(),
            "txsig".to_string(),
        );
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains(r#""mode":"push""#));
        assert!(json.contains(r#""channelId":"chan1""#));
        assert!(!json.contains("tokenAccount"));
        let back: OpenPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.mode, SessionMode::Push);
        assert_eq!(back.channel_id.as_deref(), Some("chan1"));
    }

    #[test]
    fn open_payload_pull_roundtrip_json() {
        let p = OpenPayload::pull(
            "tokacct".to_string(),
            "5000000".to_string(),
            "wallet1".to_string(),
            "signer1".to_string(),
            "approvesig".to_string(),
        );
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains(r#""mode":"pull""#));
        assert!(json.contains(r#""tokenAccount":"tokacct""#));
        assert!(json.contains(r#""owner":"wallet1""#));
        assert!(!json.contains("channelId"));
        let back: OpenPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.mode, SessionMode::Pull);
        assert_eq!(back.token_account.as_deref(), Some("tokacct"));
        assert_eq!(back.owner.as_deref(), Some("wallet1"));
    }

    #[test]
    fn open_payload_missing_mode_fails_deserialization() {
        // Clients must always send "mode" — no default.
        let json =
            r#"{"channelId":"chan1","deposit":"1000","authorizedSigner":"s","signature":"sig"}"#;
        assert!(serde_json::from_str::<OpenPayload>(json).is_err());
    }

    // ── SessionAction variants ────────────────────────────────────────────────

    #[test]
    fn session_action_open_push_roundtrip() {
        let action = SessionAction::Open(OpenPayload::push(
            "chan123".to_string(),
            "5000000".to_string(),
            "signer123".to_string(),
            "sig456".to_string(),
        ));
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains(r#""action":"open""#));
        assert!(json.contains(r#""mode":"push""#));
        let back: SessionAction = serde_json::from_str(&json).unwrap();
        match back {
            SessionAction::Open(p) => {
                assert_eq!(p.mode, SessionMode::Push);
                assert_eq!(p.session_id().unwrap(), "chan123");
                assert_eq!(p.deposit_amount().unwrap(), 5_000_000);
                assert_eq!(p.authorized_signer, "signer123");
            }
            _ => panic!("Expected Open"),
        }
    }

    #[test]
    fn session_action_open_pull_roundtrip() {
        let action = SessionAction::Open(OpenPayload::pull(
            "tokacct".to_string(),
            "3000000".to_string(),
            "wallet1".to_string(),
            "signer1".to_string(),
            "approvesig".to_string(),
        ));
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains(r#""action":"open""#));
        assert!(json.contains(r#""mode":"pull""#));
        assert!(json.contains("tokenAccount"));
        let back: SessionAction = serde_json::from_str(&json).unwrap();
        match back {
            SessionAction::Open(p) => {
                assert_eq!(p.mode, SessionMode::Pull);
                assert_eq!(p.session_id().unwrap(), "tokacct");
                assert_eq!(p.deposit_amount().unwrap(), 3_000_000);
            }
            _ => panic!("Expected Open"),
        }
    }

    #[test]
    fn session_action_voucher_roundtrip() {
        let action = SessionAction::Voucher(VoucherPayload {
            voucher: SignedVoucher {
                data: VoucherData {
                    channel_id: "chan1".to_string(),
                    cumulative: "500000".to_string(),
                    nonce: Some(3),
                },
                signature: "sig_here".to_string(),
            },
        });
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains(r#""action":"voucher""#));
        let back: SessionAction = serde_json::from_str(&json).unwrap();
        match back {
            SessionAction::Voucher(p) => {
                assert_eq!(p.voucher.data.cumulative, "500000");
                assert_eq!(p.voucher.data.nonce, Some(3));
            }
            _ => panic!("Expected Voucher"),
        }
    }

    #[test]
    fn session_action_topup_roundtrip() {
        let action = SessionAction::TopUp(TopUpPayload {
            channel_id: "chan1".to_string(),
            new_deposit: "9000000".to_string(),
            signature: "txsig".to_string(),
        });
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains(r#""action":"topUp""#));
        let back: SessionAction = serde_json::from_str(&json).unwrap();
        match back {
            SessionAction::TopUp(p) => {
                assert_eq!(p.new_deposit, "9000000");
                assert_eq!(p.signature, "txsig");
            }
            _ => panic!("Expected TopUp"),
        }
    }

    #[test]
    fn session_action_close_no_voucher_roundtrip() {
        let action = SessionAction::Close(ClosePayload {
            channel_id: "chan1".to_string(),
            voucher: None,
        });
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains(r#""action":"close""#));
        assert!(!json.contains("voucher"));
        let back: SessionAction = serde_json::from_str(&json).unwrap();
        match back {
            SessionAction::Close(p) => assert!(p.voucher.is_none()),
            _ => panic!("Expected Close"),
        }
    }

    #[test]
    fn session_action_close_with_voucher_roundtrip() {
        let action = SessionAction::Close(ClosePayload {
            channel_id: "chan1".to_string(),
            voucher: Some(SignedVoucher {
                data: VoucherData {
                    channel_id: "chan1".to_string(),
                    cumulative: "700000".to_string(),
                    nonce: Some(7),
                },
                signature: "final_sig".to_string(),
            }),
        });
        let json = serde_json::to_string(&action).unwrap();
        let back: SessionAction = serde_json::from_str(&json).unwrap();
        match back {
            SessionAction::Close(p) => {
                let v = p.voucher.unwrap();
                assert_eq!(v.data.cumulative, "700000");
            }
            _ => panic!("Expected Close"),
        }
    }

    // ── VoucherData ───────────────────────────────────────────────────────────

    #[test]
    fn voucher_data_canonical_bytes_with_nonce() {
        let data = VoucherData {
            channel_id: "chan123".to_string(),
            cumulative: "1000".to_string(),
            nonce: Some(1),
        };
        let bytes = data.canonical_bytes().unwrap();
        let s = std::str::from_utf8(&bytes).unwrap();
        // JCS alphabetical key order: channelId, cumulative, nonce
        assert!(s.contains("\"channelId\""));
        assert!(s.contains("\"cumulative\""));
        assert!(s.contains("\"nonce\""));
    }

    #[test]
    fn voucher_data_canonical_bytes_without_nonce() {
        let data = VoucherData {
            channel_id: "chan123".to_string(),
            cumulative: "1000".to_string(),
            nonce: None,
        };
        let bytes = data.canonical_bytes().unwrap();
        let s = std::str::from_utf8(&bytes).unwrap();
        assert!(!s.contains("nonce"));
        assert!(s.contains("\"channelId\""));
    }

    #[test]
    fn voucher_data_canonical_bytes_deterministic() {
        let data = VoucherData {
            channel_id: "chan123".to_string(),
            cumulative: "1000".to_string(),
            nonce: Some(5),
        };
        assert_eq!(
            data.canonical_bytes().unwrap(),
            data.canonical_bytes().unwrap()
        );
    }

    #[test]
    fn voucher_data_canonical_bytes_differs_by_cumulative() {
        let a = VoucherData {
            channel_id: "c".to_string(),
            cumulative: "100".to_string(),
            nonce: None,
        };
        let b = VoucherData {
            channel_id: "c".to_string(),
            cumulative: "200".to_string(),
            nonce: None,
        };
        assert_ne!(a.canonical_bytes().unwrap(), b.canonical_bytes().unwrap());
    }

    #[test]
    fn signed_voucher_fields() {
        let v = SignedVoucher {
            data: VoucherData {
                channel_id: "c".to_string(),
                cumulative: "100".to_string(),
                nonce: None,
            },
            signature: "abc123".to_string(),
        };
        assert_eq!(v.data.cumulative, "100");
        assert_eq!(v.signature, "abc123");
    }

    // ── Pricing fields ────────────────────────────────────────────────────────

    #[test]
    fn session_request_with_min_voucher_delta() {
        let req = SessionRequest {
            cap: "10000000".to_string(),
            currency: "USDC".to_string(),
            decimals: Some(6),
            network: Some("mainnet-beta".to_string()),
            operator: "op".to_string(),
            recipient: "rec".to_string(),
            splits: vec![],
            program_id: None,
            description: None,
            external_id: None,
            min_voucher_delta: Some("500".to_string()),
            modes: vec![],
            recent_blockhash: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: SessionRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.min_voucher_delta.as_deref(), Some("500"));
        assert!(json.contains("\"minVoucherDelta\""));
    }

    #[test]
    fn session_request_omits_min_voucher_delta_when_none() {
        let req = SessionRequest {
            cap: "1000".to_string(),
            currency: "USDC".to_string(),
            decimals: None,
            network: None,
            operator: "op".to_string(),
            recipient: "rec".to_string(),
            splits: vec![],
            program_id: None,
            description: None,
            external_id: None,
            min_voucher_delta: None,
            modes: vec![],
            recent_blockhash: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("minVoucherDelta"));
    }
}
