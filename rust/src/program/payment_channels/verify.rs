//! RPC-based verification of on-chain Channel state.
//!
//! Server handlers use these to assert on-chain state matches expectations
//! after `open` / `top_up` / `settle_and_finalize` / `distribute` complete.

use payment_channels_client::types::ChannelStatus;
use solana_account_decoder_client_types::{UiAccount, UiAccountEncoding};
use solana_client::client_error::ClientErrorKind;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::RpcAccountInfoConfig;
use solana_client::rpc_request::RpcError;
use solana_commitment_config::CommitmentConfig;
use solana_pubkey::Pubkey;
use tracing::debug;

use crate::program::payment_channels::state::ChannelView;

/// Build the `RpcAccountInfoConfig` used by every `verify_*` helper.
///
/// `Base64` is the cheapest encoding that round-trips raw account bytes:
/// `Base58` is size-limited by the RPC server, `Base64Zstd` adds a
/// decompression step we do not need for ~200-byte channel PDAs, and
/// `JsonParsed` would force the RPC to attempt program-specific parsing
/// (which it cannot do for the payment_channels program).
fn account_info_config(commitment: CommitmentConfig) -> RpcAccountInfoConfig {
    RpcAccountInfoConfig {
        encoding: Some(UiAccountEncoding::Base64),
        commitment: Some(commitment),
        ..RpcAccountInfoConfig::default()
    }
}

/// Decode a `UiAccount` payload back to raw bytes.
///
/// `UiAccountData::decode()` handles every binary encoding the RPC may
/// return (`LegacyBinary` / `Base58` / `Base64` / `Base64Zstd`); it only
/// returns `None` for `JsonParsed`, which we never request via
/// `account_info_config`. Any `None` here therefore signals the RPC
/// returned a shape we did not ask for, and is reported as a generic
/// `Rpc` error rather than a new variant.
fn decode_ui_account(channel_id: &Pubkey, ui: &UiAccount) -> Result<Vec<u8>, VerifyError> {
    ui.data.decode().ok_or_else(|| {
        VerifyError::Rpc(format!(
            "failed to decode UiAccount data for channel {channel_id}: \
             unexpected encoding (expected Base64)"
        ))
    })
}

/// Per-field on-chain state mismatches. Each variant carries the typed
/// expected and observed values so callers can match on the specific field
/// without parsing strings. Propagates into `VerifyError::Mismatch` via the
/// `#[from]` impl below.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum Mismatch {
    #[error("deposit mismatch: expected {expected}, got {got}")]
    Deposit { expected: u64, got: u64 },
    #[error("settled mismatch: expected {expected}, got {got}")]
    Settled { expected: u64, got: u64 },
    #[error("bump mismatch: expected {expected}, got {got}")]
    Bump { expected: u8, got: u8 },
    #[error("version mismatch: expected 1, got {got}")]
    Version { got: u8 },
    #[error("status mismatch: expected {expected}, got {got}")]
    Status { expected: u8, got: u8 },
    #[error("grace period mismatch: expected {expected}, got {got}")]
    GracePeriod { expected: u32, got: u32 },
    #[error("closure_started_at mismatch: expected {expected}, got {got}")]
    ClosureStartedAt { expected: i64, got: i64 },
    #[error("payer mismatch: expected {expected}, got {got}")]
    Payer {
        expected: solana_pubkey::Pubkey,
        got: solana_pubkey::Pubkey,
    },
    #[error("payee mismatch: expected {expected}, got {got}")]
    Payee {
        expected: solana_pubkey::Pubkey,
        got: solana_pubkey::Pubkey,
    },
    #[error("authorized_signer mismatch: expected {expected}, got {got}")]
    AuthorizedSigner {
        expected: solana_pubkey::Pubkey,
        got: solana_pubkey::Pubkey,
    },
    #[error("mint mismatch: expected {expected}, got {got}")]
    Mint {
        expected: solana_pubkey::Pubkey,
        got: solana_pubkey::Pubkey,
    },
    #[error("closure not started: closure_started_at == 0 but verify_closing was called")]
    ClosureNotStarted,
}

#[derive(Debug, thiserror::Error)]
pub enum VerifyError {
    #[error("channel account not found")]
    NotFound,
    #[error("channel account is tombstoned (data.len == 8)")]
    Tombstoned,
    #[error("channel account is not tombstoned: expected data.len == 8, got {data_len}")]
    NotTombstoned { data_len: usize },
    #[error(transparent)]
    Mismatch(#[from] Mismatch),
    #[error("rpc error: {0}")]
    Rpc(String),
    #[error("channel decode failed: {0}")]
    Decode(String),
}

pub struct ExpectedOpenState {
    pub deposit: u64,
    pub payer: Pubkey,
    pub payee: Pubkey,
    pub mint: Pubkey,
    pub authorized_signer: Pubkey,
    pub bump: u8,
}

/// Fetch the Channel PDA at the caller-supplied commitment (typically
/// `SessionConfig::commitment`; defaults to `Confirmed`) and assert the
/// post-`open` invariants: account exists, not tombstoned, supported
/// version, status `Open`, and every persistent field matches `expected`.
///
/// The on-chain `Channel.distribution_hash` field is intentionally NOT
/// verified here. The hash is computed from the splits canonicalization
/// helper, and that helper is not yet finalized (see `splits_ext`). Once the
/// canonicalization ships, splits-aware verification lands as a separate
/// function (sketched as `verify_distribution_hash(rpc, commitment,
/// channel_id, expected_hash) -> Result<(), VerifyError>` for callers to
/// compose alongside `verify_open`). Keeping the splits check out of
/// `verify_open` keeps the always-knowable invariants in one place and
/// avoids the "optional forever, mandatory in practice" anti-pattern.
pub async fn verify_open(
    rpc: &RpcClient,
    commitment: CommitmentConfig,
    channel_id: &Pubkey,
    expected: &ExpectedOpenState,
) -> Result<(), VerifyError> {
    let ui_account = rpc
        .get_ui_account_with_config(channel_id, account_info_config(commitment))
        .await
        .map_err(|e| VerifyError::Rpc(format!("{e}")))?
        .value
        .ok_or(VerifyError::NotFound)?;

    let data = decode_ui_account(channel_id, &ui_account)?;

    if data.len() == 8 {
        return Err(VerifyError::Tombstoned);
    }

    let view = ChannelView::from_account_data(&data)
        .map_err(|e| VerifyError::Decode(format!("failed to decode Channel PDA account: {e}")))?;

    if view.version() != 1 {
        return Err(Mismatch::Version { got: view.version() }.into());
    }
    if view.status() != ChannelStatus::Open as u8 {
        return Err(Mismatch::Status {
            expected: ChannelStatus::Open as u8,
            got: view.status(),
        }
        .into());
    }
    if view.deposit() != expected.deposit {
        return Err(Mismatch::Deposit {
            expected: expected.deposit,
            got: view.deposit(),
        }
        .into());
    }
    if view.payer() != expected.payer {
        return Err(Mismatch::Payer {
            expected: expected.payer,
            got: view.payer(),
        }
        .into());
    }
    if view.payee() != expected.payee {
        return Err(Mismatch::Payee {
            expected: expected.payee,
            got: view.payee(),
        }
        .into());
    }
    if view.mint() != expected.mint {
        return Err(Mismatch::Mint {
            expected: expected.mint,
            got: view.mint(),
        }
        .into());
    }
    if view.authorized_signer() != expected.authorized_signer {
        return Err(Mismatch::AuthorizedSigner {
            expected: expected.authorized_signer,
            got: view.authorized_signer(),
        }
        .into());
    }
    if view.bump() != expected.bump {
        return Err(Mismatch::Bump {
            expected: expected.bump,
            got: view.bump(),
        }
        .into());
    }
    Ok(())
}

/// Verify a `top_up` produced the expected new deposit, at the
/// caller-supplied commitment (matches `verify_open`'s semantics).
pub async fn verify_topup(
    rpc: &RpcClient,
    commitment: CommitmentConfig,
    channel_id: &Pubkey,
    expected_new_deposit: u64,
) -> Result<(), VerifyError> {
    let ui_account = rpc
        .get_ui_account_with_config(channel_id, account_info_config(commitment))
        .await
        .map_err(|e| VerifyError::Rpc(format!("{e}")))?
        .value
        .ok_or(VerifyError::NotFound)?;
    let data = decode_ui_account(channel_id, &ui_account)?;
    if data.len() == 8 {
        return Err(VerifyError::Tombstoned);
    }
    let view = ChannelView::from_account_data(&data)
        .map_err(|e| VerifyError::Decode(format!("failed to decode Channel PDA account: {e}")))?;
    if view.deposit() != expected_new_deposit {
        return Err(Mismatch::Deposit {
            expected: expected_new_deposit,
            got: view.deposit(),
        }
        .into());
    }
    Ok(())
}

/// Verify a `settle` left the channel still `Open` with the expected
/// settled amount. Settle does not transition status; finalize does.
pub async fn verify_settled(
    rpc: &RpcClient,
    commitment: CommitmentConfig,
    channel_id: &Pubkey,
    expected_settled: u64,
) -> Result<(), VerifyError> {
    let ui_account = rpc
        .get_ui_account_with_config(channel_id, account_info_config(commitment))
        .await
        .map_err(|e| VerifyError::Rpc(format!("{e}")))?
        .value
        .ok_or(VerifyError::NotFound)?;
    let data = decode_ui_account(channel_id, &ui_account)?;
    if data.len() == 8 {
        return Err(VerifyError::Tombstoned);
    }
    let view = ChannelView::from_account_data(&data)
        .map_err(|e| VerifyError::Decode(format!("failed to decode Channel PDA account: {e}")))?;

    if view.version() != 1 {
        return Err(Mismatch::Version { got: view.version() }.into());
    }
    if view.status() != ChannelStatus::Open as u8 {
        return Err(Mismatch::Status {
            expected: ChannelStatus::Open as u8,
            got: view.status(),
        }
        .into());
    }
    if view.settled() != expected_settled {
        return Err(Mismatch::Settled {
            expected: expected_settled,
            got: view.settled(),
        }
        .into());
    }
    Ok(())
}

/// Verify the channel is in the `Closing` window with the expected settled
/// amount and grace period, and that `closure_started_at` has been
/// populated by the on-chain transition.
pub async fn verify_closing(
    rpc: &RpcClient,
    commitment: CommitmentConfig,
    channel_id: &Pubkey,
    expected_settled: u64,
    expected_grace_period: u32,
) -> Result<(), VerifyError> {
    let ui_account = rpc
        .get_ui_account_with_config(channel_id, account_info_config(commitment))
        .await
        .map_err(|e| VerifyError::Rpc(format!("{e}")))?
        .value
        .ok_or(VerifyError::NotFound)?;
    let data = decode_ui_account(channel_id, &ui_account)?;
    if data.len() == 8 {
        return Err(VerifyError::Tombstoned);
    }
    let view = ChannelView::from_account_data(&data)
        .map_err(|e| VerifyError::Decode(format!("failed to decode Channel PDA account: {e}")))?;

    if view.version() != 1 {
        return Err(Mismatch::Version { got: view.version() }.into());
    }
    if view.status() != ChannelStatus::Closing as u8 {
        return Err(Mismatch::Status {
            expected: ChannelStatus::Closing as u8,
            got: view.status(),
        }
        .into());
    }
    if view.settled() != expected_settled {
        return Err(Mismatch::Settled {
            expected: expected_settled,
            got: view.settled(),
        }
        .into());
    }
    if view.grace_period() != expected_grace_period {
        return Err(Mismatch::GracePeriod {
            expected: expected_grace_period,
            got: view.grace_period(),
        }
        .into());
    }
    if view.closure_started_at() == 0 {
        return Err(Mismatch::ClosureNotStarted.into());
    }
    Ok(())
}

/// Result of probing a channel PDA for tombstone state.
///
/// Centralizes the fetch + decode + AccountNotFound classification used by
/// both `verify_tombstoned` (strict) and `verify_finalized_or_absent`
/// (broad). The two public helpers differ only in how they map `Absent`,
/// so the shared boilerplate lives here.
enum TombstoneProbe {
    /// Account exists and `data.len() == 8` (program-emitted tombstone).
    Tombstoned,
    /// Account exists but `data.len() != 8`.
    NotTombstoned { data_len: usize },
    /// Account does not exist on the cluster: either `Ok(value: None)` or
    /// the typed `AccountNotFound` (JSON-RPC code `-32004`).
    Absent,
}

/// Fetch the channel PDA and classify it for tombstone verification.
///
/// Some RPC providers report a missing account as `Ok(value: None)`,
/// others as a typed `RpcResponseError { code: -32004, .. }`. Both are
/// folded into `TombstoneProbe::Absent`. `ClientError.kind` is
/// `Box<ClientErrorKind>` on the 3.x track, hence the `*` deref in the
/// pattern.
async fn tombstone_probe(
    rpc: &RpcClient,
    commitment: CommitmentConfig,
    channel_id: &Pubkey,
) -> Result<TombstoneProbe, VerifyError> {
    match rpc
        .get_ui_account_with_config(channel_id, account_info_config(commitment))
        .await
    {
        Ok(resp) => match resp.value {
            Some(ui_account) => {
                let data = decode_ui_account(channel_id, &ui_account)?;
                if data.len() == 8 {
                    Ok(TombstoneProbe::Tombstoned)
                } else {
                    Ok(TombstoneProbe::NotTombstoned { data_len: data.len() })
                }
            }
            None => Ok(TombstoneProbe::Absent),
        },
        Err(e) => match &*e.kind {
            ClientErrorKind::RpcError(RpcError::RpcResponseError { code: -32004, .. }) => {
                Ok(TombstoneProbe::Absent)
            }
            _ => Err(VerifyError::Rpc(format!("{e}"))),
        },
    }
}

/// Verify post-close state: the PDA exists and is the program-emitted
/// tombstone (`data.len() == 8`).
///
/// Strict variant. Any other outcome is rejected:
/// - account absent (`Ok(value: None)` or RPC `AccountNotFound`) yields
///   `VerifyError::NotFound`,
/// - account exists with `data.len() != 8` yields
///   `VerifyError::NotTombstoned { data_len }`.
///
/// Use this whenever the caller needs evidence that the channel was in
/// fact created and then closed by the program. Callers who can also
/// accept "account absent" as evidence of finalization (because they
/// hold independent proof the channel previously existed and was
/// closed) should use `verify_finalized_or_absent` instead.
pub async fn verify_tombstoned(
    rpc: &RpcClient,
    commitment: CommitmentConfig,
    channel_id: &Pubkey,
) -> Result<(), VerifyError> {
    match tombstone_probe(rpc, commitment, channel_id).await? {
        TombstoneProbe::Tombstoned => Ok(()),
        TombstoneProbe::NotTombstoned { data_len } => {
            Err(VerifyError::NotTombstoned { data_len })
        }
        TombstoneProbe::Absent => Err(VerifyError::NotFound),
    }
}

/// Verify the channel PDA is either tombstoned (`data.len() == 8`) or
/// absent on the cluster.
///
/// Broad variant: intentionally weaker than `verify_tombstoned`. It
/// accepts "account absent" (`Ok(value: None)` or RPC `AccountNotFound`,
/// JSON-RPC code `-32004`) as success in addition to the program-emitted
/// tombstone.
///
/// This helper is for callers that already hold independent evidence the
/// channel was created and finalized on-chain (for example, a recorded
/// `close_tx` signature in a local store). Under that precondition,
/// "absent" is acceptable evidence of finalization, since a finalize
/// path that fully reclaims rent is observationally identical to a PDA
/// that never existed.
///
/// Callers WITHOUT such independent evidence MUST use
/// `verify_tombstoned` instead. Otherwise "channel was finalized" and
/// "channel never existed" become indistinguishable, and recovery code
/// will treat unrelated absent PDAs as already-closed.
pub async fn verify_finalized_or_absent(
    rpc: &RpcClient,
    commitment: CommitmentConfig,
    channel_id: &Pubkey,
) -> Result<(), VerifyError> {
    match tombstone_probe(rpc, commitment, channel_id).await? {
        TombstoneProbe::Tombstoned => Ok(()),
        TombstoneProbe::Absent => {
            debug!(
                channel_id = %channel_id,
                "channel PDA absent; accepting as finalized given caller-held close evidence"
            );
            Ok(())
        }
        TombstoneProbe::NotTombstoned { data_len } => {
            Err(VerifyError::NotTombstoned { data_len })
        }
    }
}
