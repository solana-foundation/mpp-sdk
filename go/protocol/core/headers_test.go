package core

import "testing"

func TestWWWAuthenticateRoundTrip(t *testing.T) {
	request, _ := NewBase64URLJSONValue(map[string]string{"amount": "1000", "currency": "sol"})
	challenge := NewChallengeWithSecretFull("secret", "realm", NewMethodName("solana"), NewIntentName("charge"), request, "2030-01-01T00:00:00Z", "", "desc", nil)
	header, err := FormatWWWAuthenticate(challenge)
	if err != nil {
		t.Fatalf("format failed: %v", err)
	}
	parsed, err := ParseWWWAuthenticate(header)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if parsed.ID != challenge.ID || parsed.Realm != challenge.Realm || parsed.Request.Raw() != challenge.Request.Raw() {
		t.Fatalf("unexpected parsed challenge: %#v", parsed)
	}
}

func TestAuthorizationRoundTrip(t *testing.T) {
	request, _ := NewBase64URLJSONValue(map[string]string{"amount": "1000"})
	challenge := NewChallengeWithSecret("secret", "realm", NewMethodName("solana"), NewIntentName("charge"), request)
	credential, err := NewPaymentCredential(challenge.ToEcho(), map[string]string{"type": "transaction", "transaction": "abc"})
	if err != nil {
		t.Fatalf("credential failed: %v", err)
	}
	header, err := FormatAuthorization(credential)
	if err != nil {
		t.Fatalf("format failed: %v", err)
	}
	parsed, err := ParseAuthorization(header)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if parsed.Challenge.ID != challenge.ID {
		t.Fatalf("unexpected parsed credential: %#v", parsed)
	}
}

func TestReceiptRoundTrip(t *testing.T) {
	header, err := FormatReceipt(Receipt{Status: ReceiptStatusSuccess, Method: "solana", Timestamp: "2026-01-01T00:00:00Z", Reference: "sig", ChallengeID: "id"})
	if err != nil {
		t.Fatalf("format failed: %v", err)
	}
	receipt, err := ParseReceipt(header)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if receipt.Reference != "sig" {
		t.Fatalf("unexpected receipt: %#v", receipt)
	}
}

func TestSortedHeaderParams(t *testing.T) {
	params := SortedHeaderParams(map[string]string{"b": "2", "a": "1"})
	if len(params) != 2 || params[0] != "a=1" || params[1] != "b=2" {
		t.Fatalf("unexpected params %#v", params)
	}
}
