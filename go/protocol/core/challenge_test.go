package core

import (
	"testing"
	"time"
)

func TestChallengeVerify(t *testing.T) {
	request, err := NewBase64URLJSONValue(map[string]string{"amount": "1000"})
	if err != nil {
		t.Fatalf("request encode failed: %v", err)
	}
	challenge := NewChallengeWithSecret("secret", "realm", NewMethodName("solana"), NewIntentName("charge"), request)
	if !challenge.Verify("secret") {
		t.Fatal("expected challenge verification to succeed")
	}
	if challenge.Verify("wrong") {
		t.Fatal("expected challenge verification to fail with wrong key")
	}
}

func TestChallengeIsExpired(t *testing.T) {
	request, _ := NewBase64URLJSONValue(map[string]string{"amount": "1000"})
	challenge := NewChallengeWithSecretFull("secret", "realm", NewMethodName("solana"), NewIntentName("charge"), request, "2020-01-01T00:00:00Z", "", "", nil)
	if !challenge.IsExpired(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("expected challenge to be expired")
	}
}

func TestPaymentCredentialPayloadAs(t *testing.T) {
	request, _ := NewBase64URLJSONValue(map[string]string{"amount": "1000"})
	challenge := NewChallengeWithSecret("secret", "realm", NewMethodName("solana"), NewIntentName("charge"), request)
	credential, err := NewPaymentCredential(challenge.ToEcho(), map[string]string{"type": "transaction"})
	if err != nil {
		t.Fatalf("credential failed: %v", err)
	}
	var payload map[string]string
	if err := credential.PayloadAs(&payload); err != nil {
		t.Fatalf("payload decode failed: %v", err)
	}
	if payload["type"] != "transaction" {
		t.Fatalf("unexpected payload %#v", payload)
	}
}
