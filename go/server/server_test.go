package server

import (
	"context"
	"testing"
	"time"

	solana "github.com/gagliardetto/solana-go"

	"github.com/solana-foundation/mpp-sdk/go"
	"github.com/solana-foundation/mpp-sdk/go/client"
	"github.com/solana-foundation/mpp-sdk/go/internal/testutil"
)

func newTestMpp(t *testing.T) (*Mpp, *testutil.FakeRPC, testutilConfig) {
	t.Helper()
	rpcClient := testutil.NewFakeRPC()
	recipientSigner := testutil.NewPrivateKey()
	cfg := testutilConfig{
		Recipient: recipientSigner.PublicKey().String(),
		Client:    testutil.NewPrivateKey(),
		SecretKey: "test-secret",
	}
	handler, err := New(Config{
		Recipient: cfg.Recipient,
		Currency:  "sol",
		Decimals:  9,
		Network:   "localnet",
		SecretKey: cfg.SecretKey,
		RPC:       rpcClient,
		Store:     mpp.NewMemoryStore(),
	})
	if err != nil {
		t.Fatalf("new mpp failed: %v", err)
	}
	return handler, rpcClient, cfg
}

type testutilConfig struct {
	Recipient string
	Client    solana.PrivateKey
	SecretKey string
}

func TestChargeBuildsChallenge(t *testing.T) {
	handler, _, _ := newTestMpp(t)
	challenge, err := handler.ChargeWithOptions(context.Background(), "0.001", ChargeOptions{
		Description: "demo",
		ExternalID:  "order-1",
	})
	if err != nil {
		t.Fatalf("charge failed: %v", err)
	}
	if challenge.Method != "solana" || challenge.Intent != "charge" || challenge.Realm == "" {
		t.Fatalf("unexpected challenge: %#v", challenge)
	}
}

func TestVerifyCredentialTransactionSuccess(t *testing.T) {
	handler, rpcClient, cfg := newTestMpp(t)
	challenge, err := handler.Charge(context.Background(), "0.001")
	if err != nil {
		t.Fatalf("charge failed: %v", err)
	}
	authHeader, err := client.BuildCredentialHeader(context.Background(), cfg.Client, rpcClient, challenge)
	if err != nil {
		t.Fatalf("build credential failed: %v", err)
	}
	credential, err := mpp.ParseAuthorization(authHeader)
	if err != nil {
		t.Fatalf("parse authorization failed: %v", err)
	}
	receipt, err := handler.VerifyCredential(context.Background(), credential)
	if err != nil {
		t.Fatalf("verify failed: %v", err)
	}
	if receipt.Status != mpp.ReceiptStatusSuccess || receipt.Reference == "" {
		t.Fatalf("unexpected receipt: %#v", receipt)
	}
}

func TestVerifyCredentialSignatureReplayRejected(t *testing.T) {
	handler, rpcClient, cfg := newTestMpp(t)
	challenge, err := handler.Charge(context.Background(), "0.001")
	if err != nil {
		t.Fatalf("charge failed: %v", err)
	}
	authHeader, err := client.BuildCredentialHeaderWithOptions(context.Background(), cfg.Client, rpcClient, challenge, client.BuildOptions{Broadcast: true})
	if err != nil {
		t.Fatalf("build credential failed: %v", err)
	}
	credential, err := mpp.ParseAuthorization(authHeader)
	if err != nil {
		t.Fatalf("parse authorization failed: %v", err)
	}
	if _, err := handler.VerifyCredential(context.Background(), credential); err != nil {
		t.Fatalf("first verify failed: %v", err)
	}
	if _, err := handler.VerifyCredential(context.Background(), credential); err == nil {
		t.Fatal("expected replay to be rejected")
	}
}

func TestVerifyCredentialTransactionReplayRejected(t *testing.T) {
	handler, rpcClient, cfg := newTestMpp(t)
	challenge, err := handler.Charge(context.Background(), "0.001")
	if err != nil {
		t.Fatalf("charge failed: %v", err)
	}
	authHeader, err := client.BuildCredentialHeader(context.Background(), cfg.Client, rpcClient, challenge)
	if err != nil {
		t.Fatalf("build credential failed: %v", err)
	}
	credential, err := mpp.ParseAuthorization(authHeader)
	if err != nil {
		t.Fatalf("parse authorization failed: %v", err)
	}
	if _, err := handler.VerifyCredential(context.Background(), credential); err != nil {
		t.Fatalf("first verify failed: %v", err)
	}
	if _, err := handler.VerifyCredential(context.Background(), credential); err == nil {
		t.Fatal("expected replay to be rejected")
	}
}

func TestVerifyCredentialRejectsSponsoredPushMode(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	recipient := testutil.NewPrivateKey()
	feePayer := testutil.NewPrivateKey()
	handler, err := New(Config{
		Recipient:      recipient.PublicKey().String(),
		Currency:       "sol",
		Decimals:       9,
		Network:        "localnet",
		SecretKey:      "test-secret",
		RPC:            rpcClient,
		Store:          mpp.NewMemoryStore(),
		FeePayerSigner: feePayer,
	})
	if err != nil {
		t.Fatalf("new mpp failed: %v", err)
	}
	challenge, err := handler.Charge(context.Background(), "0.001")
	if err != nil {
		t.Fatalf("charge failed: %v", err)
	}
	credential, err := mpp.NewPaymentCredential(challenge.ToEcho(), map[string]string{
		"type":      "signature",
		"signature": "5jKh25biPsnrmLWXXuqKNH2Q67Q4UmVVx8Gf2wrS6VoCeyfGE9wKikjY7Q1GQQgmpQ3xy7wJX5U1rcz82q4R8Nkv",
	})
	if err != nil {
		t.Fatalf("credential failed: %v", err)
	}
	if _, err := handler.VerifyCredential(context.Background(), credential); err == nil {
		t.Fatal("expected sponsored push mode to fail")
	}
}

func TestVerifyCredentialTokenSignatureSuccess(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	recipient := testutil.NewPrivateKey()
	clientSigner := testutil.NewPrivateKey()
	mint := testutil.NewPrivateKey().PublicKey()
	rpcClient.MintOwners[mint.String()] = solana.TokenProgramID
	handler, err := New(Config{
		Recipient: recipient.PublicKey().String(),
		Currency:  mint.String(),
		Decimals:  6,
		Network:   "localnet",
		SecretKey: "test-secret",
		RPC:       rpcClient,
		Store:     mpp.NewMemoryStore(),
	})
	if err != nil {
		t.Fatalf("new mpp failed: %v", err)
	}
	challenge, err := handler.Charge(context.Background(), "1.000000")
	if err != nil {
		t.Fatalf("charge failed: %v", err)
	}
	authHeader, err := client.BuildCredentialHeaderWithOptions(context.Background(), clientSigner, rpcClient, challenge, client.BuildOptions{Broadcast: true})
	if err != nil {
		t.Fatalf("build credential failed: %v", err)
	}
	credential, err := mpp.ParseAuthorization(authHeader)
	if err != nil {
		t.Fatalf("parse authorization failed: %v", err)
	}
	receipt, err := handler.VerifyCredential(context.Background(), credential)
	if err != nil {
		t.Fatalf("verify failed: %v", err)
	}
	if receipt.Status != mpp.ReceiptStatusSuccess {
		t.Fatalf("unexpected receipt: %#v", receipt)
	}
}

func TestVerifyCredentialUSDCSymbolSignatureSuccess(t *testing.T) {
	rpcClient := testutil.NewFakeRPC()
	recipient := testutil.NewPrivateKey()
	clientSigner := testutil.NewPrivateKey()
	usdcMint := solana.MustPublicKeyFromBase58("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
	rpcClient.MintOwners[usdcMint.String()] = solana.TokenProgramID
	handler, err := New(Config{
		Recipient: recipient.PublicKey().String(),
		Currency:  "USDC",
		Decimals:  6,
		Network:   "localnet",
		SecretKey: "test-secret",
		RPC:       rpcClient,
		Store:     mpp.NewMemoryStore(),
	})
	if err != nil {
		t.Fatalf("new mpp failed: %v", err)
	}
	challenge, err := handler.Charge(context.Background(), "1.000000")
	if err != nil {
		t.Fatalf("charge failed: %v", err)
	}
	authHeader, err := client.BuildCredentialHeaderWithOptions(context.Background(), clientSigner, rpcClient, challenge, client.BuildOptions{Broadcast: true})
	if err != nil {
		t.Fatalf("build credential failed: %v", err)
	}
	credential, err := mpp.ParseAuthorization(authHeader)
	if err != nil {
		t.Fatalf("parse authorization failed: %v", err)
	}
	receipt, err := handler.VerifyCredential(context.Background(), credential)
	if err != nil {
		t.Fatalf("verify failed: %v", err)
	}
	if receipt.Status != mpp.ReceiptStatusSuccess {
		t.Fatalf("unexpected receipt: %#v", receipt)
	}
}

func TestVerifyCredentialExpiredChallengeRejected(t *testing.T) {
	handler, _, _ := newTestMpp(t)
	challenge, err := handler.ChargeWithOptions(context.Background(), "0.001", ChargeOptions{
		Expires: time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("charge failed: %v", err)
	}
	credential, err := mpp.NewPaymentCredential(challenge.ToEcho(), map[string]string{
		"type":      "signature",
		"signature": testutil.NewPrivateKey().PublicKey().String(),
	})
	if err != nil {
		t.Fatalf("credential failed: %v", err)
	}
	if _, err := handler.VerifyCredential(context.Background(), credential); err == nil {
		t.Fatal("expected expired challenge to fail")
	}
}

func TestVerifyCredentialChallengeMismatchRejected(t *testing.T) {
	handler, _, _ := newTestMpp(t)
	request, _ := mpp.NewBase64URLJSONValue(map[string]any{
		"amount":    "1000",
		"currency":  "sol",
		"recipient": testutil.NewPrivateKey().PublicKey().String(),
	})
	challenge := mpp.NewChallengeWithSecret("wrong-secret", "realm", "solana", "charge", request)
	credential, err := mpp.NewPaymentCredential(challenge.ToEcho(), map[string]string{
		"type":      "signature",
		"signature": testutil.NewPrivateKey().PublicKey().String(),
	})
	if err != nil {
		t.Fatalf("credential failed: %v", err)
	}
	if _, err := handler.VerifyCredential(context.Background(), credential); err == nil {
		t.Fatal("expected challenge mismatch to fail")
	}
}
