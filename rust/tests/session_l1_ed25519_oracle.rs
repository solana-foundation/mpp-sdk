//! L1 integration oracle for Contract 2 (160-byte ed25519 precompile ix).
//!
//! Submits a transaction containing ONLY `build_verify_ix(...)` against
//! Solana's native ed25519 precompile inside litesvm. If the SDK builder's
//! layout is wrong, the precompile rejects the tx and the test fails. If
//! right, the tx lands. No program binary needed: the precompile is a
//! native Solana program always present in any SVM.

use ed25519_dalek::SigningKey;
use litesvm::LiteSVM;
use solana_mpp::program::payment_channels::voucher::build_verify_ix;
use solana_pubkey::Pubkey as MppPubkey;
use solana_sdk::{
    message::Message,
    signature::{Keypair, Signer as _},
    transaction::Transaction,
};

// Deterministic inputs shared between the positive and negative cases.
const SK_BYTES: [u8; 32] = [7u8; 32];
const CHANNEL_ID_BYTES: [u8; 32] = [0xcdu8; 32];
const CUMULATIVE_AMOUNT: u64 = 1_234_567;
const EXPIRES_AT: i64 = 1_800_000_000;

#[test]
fn precompile_tx_lands_against_native_ed25519() {
    let mut svm = LiteSVM::new();

    let fee_payer = Keypair::new();
    svm.airdrop(&fee_payer.pubkey(), 1_000_000_000)
        .expect("airdrop");

    let sk = SigningKey::from_bytes(&SK_BYTES);
    let channel_id = MppPubkey::new_from_array(CHANNEL_ID_BYTES);

    let precompile_ix = build_verify_ix(&channel_id, CUMULATIVE_AMOUNT, EXPIRES_AT, &sk)
        .expect("in-process dalek signer is infallible");

    let msg = Message::new(&[precompile_ix], Some(&fee_payer.pubkey()));
    let tx = Transaction::new(&[&fee_payer], msg, svm.latest_blockhash());

    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "ed25519 precompile rejected SDK-built ix: {result:?}"
    );
}

#[test]
fn precompile_rejects_tampered_signature() {
    // Negative control: flip a bit inside the signature region of the
    // canonical 160-byte layout. The precompile must reject. Proves the
    // positive case isn't passing because the precompile accepts any
    // well-formed layout regardless of signature bytes.
    //
    // Canonical layout (single signature, inline message, no separate data):
    //   bytes  0..2   = header: num_signatures (u8) + padding (u8)
    //   bytes  2..16  = Ed25519SignatureOffsets (pubkey, signature, message)
    //   bytes 16..48  = pubkey (32 bytes)
    //   bytes 48..112 = signature (64 bytes)
    //   bytes 112..160 = message (48 bytes; the voucher payload)
    //
    // Flipping a bit at offset 48 mutates the first byte of the signature.
    let mut svm = LiteSVM::new();
    let fee_payer = Keypair::new();
    svm.airdrop(&fee_payer.pubkey(), 1_000_000_000).unwrap();

    let sk = SigningKey::from_bytes(&SK_BYTES);
    let channel_id = MppPubkey::new_from_array(CHANNEL_ID_BYTES);

    let mut precompile_ix = build_verify_ix(&channel_id, CUMULATIVE_AMOUNT, EXPIRES_AT, &sk)
        .expect("in-process dalek signer is infallible");
    assert_eq!(
        precompile_ix.data.len(),
        160,
        "canonical single-signature ed25519 precompile layout is 160 bytes"
    );
    precompile_ix.data[48] ^= 1;

    let tx = Transaction::new(
        &[&fee_payer],
        Message::new(&[precompile_ix], Some(&fee_payer.pubkey())),
        svm.latest_blockhash(),
    );

    assert!(
        svm.send_transaction(tx).is_err(),
        "precompile accepted tampered signature; builder or layout is wrong"
    );
}
