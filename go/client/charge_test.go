package client

import (
	"context"
	"testing"

	solana "github.com/gagliardetto/solana-go"

	"github.com/solana-foundation/mpp-sdk/go"
	"github.com/solana-foundation/mpp-sdk/go/internal/solanautil"
	"github.com/solana-foundation/mpp-sdk/go/internal/testutil"
	"github.com/solana-foundation/mpp-sdk/go/protocol"
)

func TestBuildChargeTransactionSOLPull(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	signer := testutil.NewPrivateKey()
	recipient := testutil.NewPrivateKey().PublicKey().String()

	payload, err := BuildChargeTransaction(context.Background(), signer, rpcClient, "1000", "sol", recipient, protocol.MethodDetails{}, BuildOptions{})
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	if payload.Type != "transaction" || payload.Transaction == "" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
	tx, err := solanautil.DecodeTransactionBase64(payload.Transaction)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if len(tx.Message.Instructions) != 3 {
		t.Fatalf("expected 3 instructions, got %d", len(tx.Message.Instructions))
	}
	if tx.Signatures[0].IsZero() {
		t.Fatal("expected signer signature to be populated")
	}
}

func TestBuildChargeTransactionSOLPush(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	signer := testutil.NewPrivateKey()
	recipient := testutil.NewPrivateKey().PublicKey().String()

	payload, err := BuildChargeTransaction(context.Background(), signer, rpcClient, "1000", "sol", recipient, protocol.MethodDetails{}, BuildOptions{Broadcast: true})
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	if payload.Type != "signature" || payload.Signature == "" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestBuildChargeTransactionWithFeePayer(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	signer := testutil.NewPrivateKey()
	feePayer := testutil.NewPrivateKey().PublicKey()
	recipient := testutil.NewPrivateKey().PublicKey().String()
	enabled := true

	payload, err := BuildChargeTransaction(context.Background(), signer, rpcClient, "1000", "sol", recipient, protocol.MethodDetails{
		FeePayer:    &enabled,
		FeePayerKey: feePayer.String(),
	}, BuildOptions{})
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	tx, err := solanautil.DecodeTransactionBase64(payload.Transaction)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if tx.Message.AccountKeys[0] != feePayer {
		t.Fatalf("expected fee payer to be first account, got %s", tx.Message.AccountKeys[0])
	}
	if len(tx.Signatures) != 2 {
		t.Fatalf("expected partial signatures for fee payer flow, got %d", len(tx.Signatures))
	}
}

func TestBuildChargeTransactionTokenPull(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	signer := testutil.NewPrivateKey()
	recipient := testutil.NewPrivateKey().PublicKey().String()
	mint := testutil.NewPrivateKey().PublicKey()
	rpcClient.MintOwners[mint.String()] = solana.TokenProgramID
	decimals := uint8(6)

	payload, err := BuildChargeTransaction(context.Background(), signer, rpcClient, "1000", mint.String(), recipient, protocol.MethodDetails{
		Decimals: &decimals,
	}, BuildOptions{})
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	tx, err := solanautil.DecodeTransactionBase64(payload.Transaction)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if len(tx.Message.Instructions) != 4 {
		t.Fatalf("expected 4 instructions, got %d", len(tx.Message.Instructions))
	}
}

func TestBuildCredentialHeaderRoundTrip(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	signer := testutil.NewPrivateKey()
	challengeRequest, _ := mpp.NewBase64URLJSONValue(map[string]any{
		"amount":        "1000",
		"currency":      "sol",
		"recipient":     testutil.NewPrivateKey().PublicKey().String(),
		"methodDetails": map[string]any{"network": "localnet"},
	})
	challenge := mpp.NewChallengeWithSecret("secret", "realm", "solana", "charge", challengeRequest)

	header, err := BuildCredentialHeader(context.Background(), signer, rpcClient, challenge)
	if err != nil {
		t.Fatalf("header failed: %v", err)
	}
	credential, err := mpp.ParseAuthorization(header)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if credential.Challenge.ID != challenge.ID {
		t.Fatalf("unexpected credential: %#v", credential)
	}
}
