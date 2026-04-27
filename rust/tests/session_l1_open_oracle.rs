//! L1 integration oracle for Contract 3 (Channel PDA derivation) and the
//! SDK's open-ix account wiring.
//!
//! Loads the pinned program binary into litesvm, sets up a real SPL mint +
//! payer ATA + channel ATA, derives the canonical PDA via the SDK's
//! `find_channel_pda`, builds the open ix via the Codama-generated
//! `OpenBuilder`, signs with fresh payer + authorized_signer keys, and
//! submits. Upstream's `open` validates the PDA seeds and full account
//! list; if either diverges, the tx fails.

use litesvm::LiteSVM;
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
use payment_channels_client::instructions::OpenBuilder;
use payment_channels_client::programs::PAYMENT_CHANNELS_ID;
use payment_channels_client::types::{DistributionEntry, DistributionRecipients, OpenArgs};
use solana_address::Address;
use solana_message::Message;
use solana_mpp::program::payment_channels::state::find_channel_pda;
use solana_pubkey::Pubkey as MppPubkey;
use solana_pubkey_v2::Pubkey as AtaPubkey;
use solana_sdk::{signature::Keypair, signer::Signer as _, transaction::Transaction};
use solana_sdk_ids::{system_program, sysvar};
use spl_associated_token_account_client::address::get_associated_token_address_with_program_id;

fn program_so_path() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/payment_channels.so")
}

fn program_id_address() -> Address {
    PAYMENT_CHANNELS_ID
}

fn program_id_mpp() -> MppPubkey {
    MppPubkey::new_from_array(PAYMENT_CHANNELS_ID.to_bytes())
}

fn to_mpp(addr: &Address) -> MppPubkey {
    MppPubkey::new_from_array(addr.to_bytes())
}

#[test]
fn sdk_built_open_tx_lands_against_loaded_program() {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(program_id_address(), program_so_path())
        .expect("load program binary");

    let payer = Keypair::new();
    let mint_authority = Keypair::new();
    let authorized_signer = Keypair::new();
    let payee = Address::new_from_array([0xeeu8; 32]);

    svm.airdrop(&payer.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&mint_authority.pubkey(), 1_000_000_000).unwrap();

    // SPL setup: classic SPL Token mint (NOT Token-2022; the program rejects
    // Token-2022 at process_open), payer ATA, and enough tokens to fund the
    // open deposit. Upstream's program-side tests follow the same shape; we
    // keep the setup local rather than depending on upstream test code.
    //
    // `litesvm_token::CreateMint::send` returns the mint Address it generated
    // internally (the Keypair never escapes the builder), so we capture it
    // here.
    let token_program_id = litesvm_token::TOKEN_ID;
    let mint = CreateMint::new(&mut svm, &mint_authority)
        .decimals(6)
        .token_program_id(&token_program_id)
        .send()
        .expect("create mint");

    let payer_token_account = CreateAssociatedTokenAccount::new(&mut svm, &payer, &mint)
        .owner(&payer.pubkey())
        .send()
        .expect("create payer ATA");

    MintTo::new(
        &mut svm,
        &mint_authority,
        &mint,
        &payer_token_account,
        5_000_000,
    )
    .send()
    .expect("mint to payer ATA");

    let salt: u64 = 42;
    // `find_channel_pda` is typed against `solana_pubkey::Pubkey` (3.x); the
    // litesvm path is in `solana_address::Address` (2.x). We bridge through
    // `to_bytes` since both are 32-byte newtypes.
    let (channel_pda_mpp, bump) = find_channel_pda(
        &to_mpp(&payer.pubkey()),
        &to_mpp(&payee),
        &to_mpp(&mint),
        &to_mpp(&authorized_signer.pubkey()),
        salt,
        &program_id_mpp(),
    );
    let channel_pda = Address::new_from_array(channel_pda_mpp.to_bytes());

    // The SPL helper takes/returns `solana_pubkey::Pubkey` at the 2.x major,
    // which is a distinct type from our `Address` (2.x) / `Pubkey` (3.x). Bridge
    // through bytes; both are 32-byte newtypes.
    let channel_token_account = Address::new_from_array(
        get_associated_token_address_with_program_id(
            &AtaPubkey::new_from_array(channel_pda.to_bytes()),
            &AtaPubkey::new_from_array(mint.to_bytes()),
            &AtaPubkey::new_from_array(token_program_id.to_bytes()),
        )
        .to_bytes(),
    );

    // The fixed-amount `DistributionRecipients` shape is what upstream pins
    // at this rev. Future revs are expected to move to a basis-points model;
    // when they do, this construction updates alongside the upstream type.
    // The unused entries are zero-padded; only entries[0..count] are read by
    // the program.
    let deposit: u64 = 1_000_000;
    let grace_period: u32 = 60;
    let zero_entry = DistributionEntry {
        recipient: Address::new_from_array([0u8; 32]),
        amount: 0,
    };
    let entries: [DistributionEntry; 32] = std::array::from_fn(|i| {
        if i == 0 {
            DistributionEntry {
                recipient: payee,
                amount: deposit,
            }
        } else {
            zero_entry.clone()
        }
    });
    let open_args = OpenArgs {
        salt,
        deposit,
        grace_period,
        recipients: DistributionRecipients { count: 1, entries },
    };

    // The event_authority PDA is derived from a single literal seed; note
    // the seed is `b"event_authority"`, NOT the Anchor-default
    // `b"__event_authority"`. Upstream defines it via const-derivation in
    // `program/payment_channels/src/event_engine.rs` but does not re-export
    // the address through the Codama client, so we derive it here.
    let (event_authority_mpp, _event_authority_bump) =
        MppPubkey::find_program_address(&[b"event_authority"], &program_id_mpp());
    let event_authority = Address::new_from_array(event_authority_mpp.to_bytes());

    // The associated-token-account program ID. The Codama `OpenBuilder`
    // requires this account explicitly; without `.associated_token_program(...)`,
    // `.instruction()` panics at builder finalization.
    let ata_program =
        Address::new_from_array(spl_associated_token_account_client::program::ID.to_bytes());

    let open_ix = OpenBuilder::new()
        .payer(payer.pubkey())
        .payee(payee)
        .mint(mint)
        .authorized_signer(authorized_signer.pubkey())
        .channel(channel_pda)
        .payer_token_account(payer_token_account)
        .channel_token_account(channel_token_account)
        .token_program(token_program_id)
        .system_program(system_program::ID)
        .rent(sysvar::rent::ID)
        .associated_token_program(ata_program)
        .event_authority(event_authority)
        .self_program(program_id_address())
        .open_args(open_args)
        .instruction();

    // Upstream's OpenBuilder marks `authorized_signer` as readonly + non-signer
    // (see `clients/rust/src/generated/instructions/open.rs`); only `payer`
    // signs the open ix. The keypair stays around because we still need its
    // pubkey for PDA derivation and the account meta.
    let tx = Transaction::new(
        &[&payer],
        Message::new(&[open_ix], Some(&payer.pubkey())),
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "open tx rejected by program; SDK PDA derivation or account wiring diverged: {result:?}"
    );

    let account = svm.get_account(&channel_pda).expect("channel pda exists");
    assert!(
        account.data.len() > 8,
        "channel account data is too small; program didn't initialize it"
    );
    // Channel struct byte layout (see upstream
    // `clients/rust/src/generated/accounts/channel.rs`):
    //   byte 0 = discriminator
    //   byte 1 = version
    //   byte 2 = bump
    //   byte 3 = status
    //   bytes 4+ = deposit, settled, ...
    assert_eq!(account.data[2], bump, "canonical bump mismatch");
}
