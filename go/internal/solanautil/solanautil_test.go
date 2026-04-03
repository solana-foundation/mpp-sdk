package solanautil

import (
	"context"
	"testing"

	solana "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"

	"github.com/solana-foundation/mpp-sdk/go/internal/testutil"
	"github.com/solana-foundation/mpp-sdk/go/protocol"
)

func TestSplitAmounts(t *testing.T) {
	primary, err := SplitAmounts(1000, []protocol.Split{{Recipient: testutil.NewPrivateKey().PublicKey().String(), Amount: "100"}})
	if err != nil {
		t.Fatalf("split failed: %v", err)
	}
	if primary != 900 {
		t.Fatalf("unexpected primary amount %d", primary)
	}
}

func TestResolveRecentBlockhash(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	hash, err := ResolveRecentBlockhash(context.Background(), rpcClient, "")
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if hash != rpcClient.Blockhash {
		t.Fatalf("unexpected blockhash %s", hash)
	}
}

func TestResolveTokenProgram(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	mint := testutil.NewPrivateKey().PublicKey()
	rpcClient.MintOwners[mint.String()] = solana.TokenProgramID
	program, err := ResolveTokenProgram(context.Background(), rpcClient, mint, "")
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if !program.Equals(solana.TokenProgramID) {
		t.Fatalf("unexpected token program %s", program)
	}
}

func TestSignEncodeDecodeTransaction(t *testing.T) {
	signer := testutil.NewPrivateKey()
	recipient := testutil.NewPrivateKey().PublicKey()
	blockhash := testutil.NewFakeRPC().Blockhash
	transfer, err := BuildSOLTransfer(signer.PublicKey(), recipient, 1000)
	if err != nil {
		t.Fatalf("transfer failed: %v", err)
	}
	tx, err := solana.NewTransaction([]solana.Instruction{transfer}, blockhash, solana.TransactionPayer(signer.PublicKey()))
	if err != nil {
		t.Fatalf("tx failed: %v", err)
	}
	if err := SignTransaction(tx, signer); err != nil {
		t.Fatalf("sign failed: %v", err)
	}
	encoded, err := EncodeTransactionBase64(tx)
	if err != nil {
		t.Fatalf("encode failed: %v", err)
	}
	decoded, err := DecodeTransactionBase64(encoded)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if len(decoded.Signatures) != 1 || decoded.Signatures[0].IsZero() {
		t.Fatal("expected decoded signature")
	}
}

func TestWaitSimulateSendFetchTransaction(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	signer := testutil.NewPrivateKey()
	recipient := testutil.NewPrivateKey().PublicKey()
	transfer, _ := BuildSOLTransfer(signer.PublicKey(), recipient, 1000)
	tx, _ := solana.NewTransaction([]solana.Instruction{transfer}, rpcClient.Blockhash, solana.TransactionPayer(signer.PublicKey()))
	_ = SignTransaction(tx, signer)
	if err := SimulateTransaction(context.Background(), rpcClient, tx); err != nil {
		t.Fatalf("simulate failed: %v", err)
	}
	signature, err := SendTransaction(context.Background(), rpcClient, tx)
	if err != nil {
		t.Fatalf("send failed: %v", err)
	}
	if err := WaitForConfirmation(context.Background(), rpcClient, signature); err != nil {
		t.Fatalf("wait failed: %v", err)
	}
	fetched, _, err := FetchTransaction(context.Background(), rpcClient, signature)
	if err != nil {
		t.Fatalf("fetch failed: %v", err)
	}
	if len(fetched.Signatures) != 1 {
		t.Fatalf("unexpected fetched transaction")
	}
}

func TestAssociatedTokenHelpers(t *testing.T) {
	wallet := testutil.NewPrivateKey().PublicKey()
	mint := testutil.NewPrivateKey().PublicKey()
	ata, err := FindAssociatedTokenAddress(wallet, mint)
	if err != nil || ata.IsZero() {
		t.Fatalf("ata failed: %v", err)
	}
	ata2022, err := FindAssociatedTokenAddressWithProgram(wallet, mint, solana.MustPublicKeyFromBase58(protocol.Token2022Program))
	if err != nil || ata2022.IsZero() {
		t.Fatalf("ata2022 failed: %v", err)
	}
	ix, err := BuildCreateAssociatedTokenAccount(wallet, wallet, mint, solana.TokenProgramID)
	if err != nil || ix == nil {
		t.Fatalf("create ata failed: %v", err)
	}
	ix, err = BuildTransferChecked(1, 6, ata, mint, ata, wallet, solana.TokenProgramID)
	if err != nil || ix == nil {
		t.Fatalf("transfer checked failed: %v", err)
	}
	_, err = BuildTransferChecked(1, 6, ata, mint, ata, wallet, solana.SystemProgramID)
	if err == nil {
		t.Fatal("expected unsupported token program error")
	}
	_, err = BuildComputeUnitLimit(200_000)
	if err != nil {
		t.Fatalf("compute unit limit failed: %v", err)
	}
	_, err = BuildComputeUnitPrice(1)
	if err != nil {
		t.Fatalf("compute unit price failed: %v", err)
	}
}

func TestResolveTokenProgramUsesHint(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	mint := testutil.NewPrivateKey().PublicKey()
	program, err := ResolveTokenProgram(context.Background(), rpcClient, mint, protocol.Token2022Program)
	if err != nil {
		t.Fatalf("resolve with hint failed: %v", err)
	}
	if program.String() != protocol.Token2022Program {
		t.Fatalf("unexpected program %s", program)
	}
}

func TestWaitForConfirmationReturnsFailure(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	signature := solana.MustSignatureFromBase58("5jKh25biPsnrmLWXXuqKNH2Q67Q4UmVVx8Gf2wrS6VoCeyfGE9wKikjY7Q1GQQgmpQ3xy7wJX5U1rcz82q4R8Nkv")
	rpcClient.Statuses[signature.String()] = &rpc.SignatureStatusesResult{
		Err: "boom",
	}
	if err := WaitForConfirmation(context.Background(), rpcClient, signature); err == nil {
		t.Fatal("expected confirmation failure")
	}
}
