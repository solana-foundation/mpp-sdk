//! Client-side helpers for payment-channel open transactions.

use base64::Engine;
use solana_hash::Hash;
use solana_keychain::SolanaSigner;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;

use crate::error::{Error, Result};
use crate::program::payment_channels::{
    build_open_instruction, derive_channel_addresses, Distribution, OpenChannelParams,
};

#[derive(Debug, Clone)]
pub struct PaymentChannelOpenTransaction {
    pub channel_id: Pubkey,
    pub transaction: String,
}

#[allow(clippy::too_many_arguments)]
pub async fn build_open_payment_channel_tx(
    signer: &dyn SolanaSigner,
    payee: &Pubkey,
    mint: &Pubkey,
    authorized_signer: &Pubkey,
    salt: u64,
    deposit: u64,
    grace_period: u32,
    recipients: Vec<Distribution>,
    token_program: &Pubkey,
    program_id: &Pubkey,
    fee_payer: &Pubkey,
    recent_blockhash: Hash,
) -> Result<PaymentChannelOpenTransaction> {
    let params = OpenChannelParams {
        payer: signer.pubkey(),
        payee: *payee,
        mint: *mint,
        authorized_signer: *authorized_signer,
        salt,
        deposit,
        grace_period,
        recipients,
        token_program: *token_program,
        program_id: *program_id,
    };
    let channel_id = derive_channel_addresses(&params).channel;
    let ix = build_open_instruction(&params);
    let message = Message::new_with_blockhash(&[ix], Some(fee_payer), &recent_blockhash);
    let mut tx = Transaction::new_unsigned(message);

    signer
        .sign_transaction(&mut tx)
        .await
        .map_err(|e| Error::Other(format!("payment-channel open signing failed: {e}")))?;

    let bytes = bincode::serialize(&tx)
        .map_err(|e| Error::Other(format!("payment-channel open tx serialization failed: {e}")))?;
    Ok(PaymentChannelOpenTransaction {
        channel_id,
        transaction: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}
