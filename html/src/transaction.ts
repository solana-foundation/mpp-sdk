import { findAssociatedTokenPda } from '@solana-program/token';
import { address } from '@solana/kit';
import type { EmbeddedData } from './config';
import type { decodeRequest } from './credential';

type ChargeRequest = ReturnType<typeof decodeRequest>;

// Well-known program addresses
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Well-known mints (currency symbol → mint address per network)
const KNOWN_MINTS: Record<string, Record<string, string>> = {
  USDC: {
    'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    // Surfpool clones mainnet USDC
    localnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
};

/** Resolve a currency to a mint address. Returns null for native SOL. */
function resolveMint(currency: string, network: string): string | null {
  if (currency.toLowerCase() === 'sol') return null;
  if (currency.length >= 32) return currency;
  return KNOWN_MINTS[currency.toUpperCase()]?.[network] ?? currency;
}

/** Compact-u16 encoding used in Solana transaction format. */
function compactU16(value: number): Uint8Array {
  if (value < 0x80) return new Uint8Array([value]);
  if (value < 0x4000) return new Uint8Array([value & 0x7f | 0x80, value >> 7]);
  return new Uint8Array([value & 0x7f | 0x80, (value >> 7) & 0x7f | 0x80, value >> 14]);
}

// ── Base58 ──

const BS58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function bs58Decode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of str) {
    let carry = BS58_ALPHABET.indexOf(char);
    if (carry < 0) throw new Error(`Invalid base58 char: ${char}`);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function bs58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BS58_ALPHABET[digits[i]];
  }
  return result;
}

function decodePublicKey(base58: string): Uint8Array {
  const bytes = bs58Decode(base58);
  if (bytes.length !== 32) throw new Error(`Invalid public key length: ${bytes.length}`);
  return bytes;
}

function pubkeyHex(key: Uint8Array): string {
  return Array.from(key).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── RPC helpers ──

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<any> {
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await resp.json();
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result;
}

function getRpcUrl(network: string): string {
  switch (network) {
    case 'devnet': return 'https://api.devnet.solana.com';
    case 'localnet': return 'http://localhost:8899';
    default: return 'https://api.mainnet-beta.solana.com';
  }
}

// ── ATA derivation using @solana-program/token ──

async function findATA(owner: string, mint: string, tokenProgram: string): Promise<string> {
  const [ata] = await findAssociatedTokenPda({
    owner: address(owner),
    mint: address(mint),
    tokenProgram: address(tokenProgram),
  });
  return ata;
}

// ── Instructions ──

function systemTransferInstruction(from: Uint8Array, to: Uint8Array, lamports: bigint) {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true); // instruction index = Transfer
  view.setBigUint64(4, lamports, true);
  return {
    programId: SYSTEM_PROGRAM,
    accounts: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
    ],
    data,
  };
}

function tokenTransferCheckedInstruction(
  source: Uint8Array,
  mint: Uint8Array,
  destination: Uint8Array,
  authority: Uint8Array,
  amount: bigint,
  decimals: number,
  tokenProgram: string,
) {
  // Instruction index 12 = TransferChecked
  const data = new Uint8Array(10);
  const view = new DataView(data.buffer);
  data[0] = 12;
  view.setBigUint64(1, amount, true);
  data[9] = decimals;
  return {
    programId: tokenProgram,
    accounts: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  };
}

// ── Transaction compilation ──

type AccountMeta = { pubkey: Uint8Array; isSigner: boolean; isWritable: boolean };
type Instruction = { programId: string; accounts: AccountMeta[]; data: Uint8Array };

interface CompiledInstruction {
  programIdIndex: number;
  accountIndices: number[];
  data: Uint8Array;
}

/**
 * Compile and serialize a legacy Solana transaction from instructions.
 * Returns the raw message bytes (no signature prefix) for signing.
 */
function compileMessage(
  instructions: Instruction[],
  feePayerPubkey: Uint8Array,
  signerPubkey: Uint8Array,
  blockhashBytes: Uint8Array,
  hasSeparateFeePayer: boolean,
): Uint8Array {
  // Collect all unique accounts, fee payer first
  const accountMap = new Map<string, AccountMeta & { index: number }>();
  const feePayerHex = pubkeyHex(feePayerPubkey);
  accountMap.set(feePayerHex, { pubkey: feePayerPubkey, isSigner: true, isWritable: true, index: 0 });

  // If the signer is different from fee payer, add as signer
  const signerHex = pubkeyHex(signerPubkey);
  if (signerHex !== feePayerHex) {
    accountMap.set(signerHex, { pubkey: signerPubkey, isSigner: true, isWritable: true, index: 0 });
  }

  const programIds = new Set<string>();
  for (const ix of instructions) {
    programIds.add(ix.programId);
    for (const acc of ix.accounts) {
      const hex = pubkeyHex(acc.pubkey);
      const existing = accountMap.get(hex);
      if (existing) {
        existing.isSigner = existing.isSigner || acc.isSigner;
        existing.isWritable = existing.isWritable || acc.isWritable;
      } else {
        accountMap.set(hex, { ...acc, index: 0 });
      }
    }
  }

  // Add program IDs as unsigned readonly
  for (const progId of programIds) {
    const progPubkey = decodePublicKey(progId);
    const hex = pubkeyHex(progPubkey);
    if (!accountMap.has(hex)) {
      accountMap.set(hex, { pubkey: progPubkey, isSigner: false, isWritable: false, index: 0 });
    }
  }

  // Sort: fee payer first, then signers+writable, signers+readonly, non-signers+writable, non-signers+readonly
  const allAccounts = [...accountMap.values()];
  const feePayer = allAccounts.find(a => pubkeyHex(a.pubkey) === feePayerHex)!;
  const rest = allAccounts.filter(a => pubkeyHex(a.pubkey) !== feePayerHex);

  const signedWritable = rest.filter(a => a.isSigner && a.isWritable);
  const signedReadonly = rest.filter(a => a.isSigner && !a.isWritable);
  const unsignedWritable = rest.filter(a => !a.isSigner && a.isWritable);
  const unsignedReadonly = rest.filter(a => !a.isSigner && !a.isWritable);

  const ordered = [feePayer, ...signedWritable, ...signedReadonly, ...unsignedWritable, ...unsignedReadonly];
  const keyToIndex = new Map<string, number>();
  for (let i = 0; i < ordered.length; i++) {
    keyToIndex.set(pubkeyHex(ordered[i].pubkey), i);
  }

  const numRequiredSignatures = 1 + signedWritable.length + signedReadonly.length;
  const numReadonlySignedAccounts = signedReadonly.length;
  const numReadonlyUnsignedAccounts = unsignedReadonly.length;

  // Compile instructions
  const compiledIxs: CompiledInstruction[] = instructions.map(ix => ({
    programIdIndex: keyToIndex.get(pubkeyHex(decodePublicKey(ix.programId)))!,
    accountIndices: ix.accounts.map(acc => keyToIndex.get(pubkeyHex(acc.pubkey))!),
    data: ix.data,
  }));

  // Serialize message
  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array([numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts]));
  parts.push(compactU16(ordered.length));
  for (const acc of ordered) parts.push(acc.pubkey);
  parts.push(blockhashBytes);
  parts.push(compactU16(compiledIxs.length));
  for (const ix of compiledIxs) {
    parts.push(new Uint8Array([ix.programIdIndex]));
    parts.push(compactU16(ix.accountIndices.length));
    parts.push(new Uint8Array(ix.accountIndices));
    parts.push(compactU16(ix.data.length));
    parts.push(ix.data);
  }

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const messageBytes = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) {
    messageBytes.set(p, off);
    off += p.length;
  }

  return messageBytes;
}

// ── Public API: buildTransaction (wallet mode) ──

interface TransactionSigner {
  readonly address: string;
  signTransaction(transaction: unknown): Promise<unknown>;
}

export async function buildTransaction(
  request: ChargeRequest,
  data: EmbeddedData,
  signer: TransactionSigner,
): Promise<Uint8Array> {
  const md = request.methodDetails ?? {};
  const network = md.network ?? data.network;
  const amount = BigInt(request.amount);
  const signerPubkey = decodePublicKey(signer.address);
  const recipientPubkey = decodePublicKey(request.recipient);
  const rpcUrl = data.rpcUrl ?? getRpcUrl(network);

  const blockhashBytes = md.recentBlockhash
    ? decodePublicKey(md.recentBlockhash) // same format as pubkey (32 bytes)
    : decodePublicKey((await rpcCall(rpcUrl, 'getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash);

  const mint = resolveMint(request.currency, network);
  const isNativeSOL = mint === null;
  const instructions: Instruction[] = [];

  const splits = md.splits ?? [];
  let splitTotal = 0n;
  for (const split of splits) splitTotal += BigInt(split.amount);
  const primaryAmount = amount - splitTotal;

  if (isNativeSOL) {
    instructions.push(systemTransferInstruction(signerPubkey, recipientPubkey, primaryAmount));
    for (const split of splits) {
      instructions.push(systemTransferInstruction(signerPubkey, decodePublicKey(split.recipient), BigInt(split.amount)));
    }
  } else {
    const mintPubkey = decodePublicKey(mint);
    const tokenProg = md.tokenProgram === TOKEN_2022_PROGRAM ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
    const decimals = md.decimals ?? 6;
    const sourceAta = decodePublicKey(await findATA(signer.address, mint, tokenProg));
    const destAta = decodePublicKey(await findATA(request.recipient, mint, tokenProg));

    instructions.push(tokenTransferCheckedInstruction(sourceAta, mintPubkey, destAta, signerPubkey, primaryAmount, decimals, tokenProg));
    for (const split of splits) {
      const splitAta = decodePublicKey(await findATA(split.recipient, mint, tokenProg));
      instructions.push(tokenTransferCheckedInstruction(sourceAta, mintPubkey, splitAta, signerPubkey, BigInt(split.amount), decimals, tokenProg));
    }
  }

  const feePayerPubkey = md.feePayer && md.feePayerKey
    ? decodePublicKey(md.feePayerKey)
    : signerPubkey;

  const messageBytes = compileMessage(instructions, feePayerPubkey, signerPubkey, blockhashBytes, md.feePayer === true);
  const signed = (await signer.signTransaction(messageBytes)) as Uint8Array;
  return signed instanceof Uint8Array ? signed : messageBytes;
}

// ── Public API: buildTestTransaction (surfpool / test mode) ──

/**
 * Build and sign a payment transaction in test mode.
 *
 * Uses surfpool cheatcodes to fund the test account:
 * - `surfnet_setAccount` for SOL (gas fees)
 * - `surfnet_setTokenAccount` for SPL tokens (USDC)
 *
 * Supports fee payer mode: the test keypair only signs as transfer authority,
 * the server co-signs as fee payer after receiving the credential.
 */
export async function buildTestTransaction(
  request: ChargeRequest,
  data: EmbeddedData,
): Promise<Uint8Array> {
  const md = request.methodDetails ?? {};
  const network = md.network ?? data.network;
  const rpcUrl = data.rpcUrl ?? getRpcUrl(network);

  // Generate a test keypair
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const publicKeyB58 = bs58Encode(publicKeyRaw);

  const mint = resolveMint(request.currency, network);
  const isNativeSOL = mint === null;
  const hasSeparateFeePayer = md.feePayer === true && !!md.feePayerKey;

  // Fund the test account via surfpool cheatcodes
  // Always give SOL for fees (even with fee payer, the account needs to exist)
  await rpcCall(rpcUrl, 'surfnet_setAccount', [
    publicKeyB58,
    { lamports: 1_000_000_000, data: '', executable: false, owner: SYSTEM_PROGRAM, rentEpoch: 0 },
  ]);

  if (!isNativeSOL) {
    // Fund with SPL tokens via surfnet_setTokenAccount
    const tokenProg = md.tokenProgram ?? TOKEN_PROGRAM;
    const amount = BigInt(request.amount);
    await rpcCall(rpcUrl, 'surfnet_setTokenAccount', [
      publicKeyB58,
      mint,
      { amount: Number(amount), state: 'initialized' },
      tokenProg,
    ]);

    // Also ensure recipient has a token account (surfpool creates ATAs automatically)
    await rpcCall(rpcUrl, 'surfnet_setTokenAccount', [
      request.recipient,
      mint,
      { amount: 0, state: 'initialized' },
      tokenProg,
    ]);
  }

  // Get a fresh blockhash
  const blockhash = md.recentBlockhash
    ?? (await rpcCall(rpcUrl, 'getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
  const blockhashBytes = decodePublicKey(blockhash);

  const amount = BigInt(request.amount);
  const recipientPubkey = decodePublicKey(request.recipient);
  const splits = md.splits ?? [];
  let splitTotal = 0n;
  for (const s of splits) splitTotal += BigInt(s.amount);
  const primaryAmount = amount - splitTotal;

  const instructions: Instruction[] = [];

  if (isNativeSOL) {
    instructions.push(systemTransferInstruction(publicKeyRaw, recipientPubkey, primaryAmount));
    for (const split of splits) {
      instructions.push(systemTransferInstruction(publicKeyRaw, decodePublicKey(split.recipient), BigInt(split.amount)));
    }
  } else {
    const mintPubkey = decodePublicKey(mint!);
    const tokenProg = md.tokenProgram ?? TOKEN_PROGRAM;
    const decimals = md.decimals ?? 6;

    // Look up ATAs via RPC (surfnet_setTokenAccount created them)
    const sourceAta = decodePublicKey(await findATA(publicKeyB58, mint!, tokenProg));
    const destAta = decodePublicKey(await findATA(request.recipient, mint!, tokenProg));

    instructions.push(tokenTransferCheckedInstruction(sourceAta, mintPubkey, destAta, publicKeyRaw, primaryAmount, decimals, tokenProg));
    for (const split of splits) {
      const splitAta = decodePublicKey(await findATA(split.recipient, mint!, tokenProg));
      instructions.push(tokenTransferCheckedInstruction(sourceAta, mintPubkey, splitAta, publicKeyRaw, BigInt(split.amount), decimals, tokenProg));
    }
  }

  // Determine fee payer
  const feePayerPubkey = hasSeparateFeePayer
    ? decodePublicKey(md.feePayerKey!)
    : publicKeyRaw;

  // Compile the message
  const messageBytes = compileMessage(instructions, feePayerPubkey, publicKeyRaw, blockhashBytes, hasSeparateFeePayer);

  // Sign with the test keypair
  const signature = new Uint8Array(
    await crypto.subtle.sign('Ed25519', keyPair.privateKey, messageBytes),
  );

  // Assemble transaction: [num_sigs, sig_slots..., message]
  // With fee payer mode: 2 signature slots (fee payer empty + client signed)
  // Without: 1 signature slot (client signed)
  const numSigs = hasSeparateFeePayer ? 2 : 1;
  const txBytes = new Uint8Array(1 + numSigs * 64 + messageBytes.length);
  txBytes[0] = numSigs;

  if (hasSeparateFeePayer) {
    // Slot 0: fee payer (empty — server will fill this)
    // Slot 1: client signature
    txBytes.set(signature, 1 + 64);
  } else {
    // Slot 0: client signature
    txBytes.set(signature, 1);
  }

  txBytes.set(messageBytes, 1 + numSigs * 64);
  return txBytes;
}
