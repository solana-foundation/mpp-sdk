package core

import "testing"

func TestMethodNameNormalization(t *testing.T) {
	method := NewMethodName("SOLANA")
	if method != "solana" {
		t.Fatalf("unexpected method %q", method)
	}
	if !method.IsValid() {
		t.Fatal("expected normalized method to be valid")
	}
}

func TestBase64URLRoundTrip(t *testing.T) {
	encoded := Base64URLEncode([]byte("hello"))
	decoded, err := Base64URLDecode(encoded)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if string(decoded) != "hello" {
		t.Fatalf("unexpected decoded value %q", string(decoded))
	}
}

func TestBase64URLJSONRoundTrip(t *testing.T) {
	value, err := NewBase64URLJSONValue(map[string]string{"amount": "1000"})
	if err != nil {
		t.Fatalf("encode failed: %v", err)
	}
	var decoded map[string]string
	if err := value.Decode(&decoded); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if decoded["amount"] != "1000" {
		t.Fatalf("unexpected payload: %#v", decoded)
	}
	if value.IsEmpty() {
		t.Fatal("expected encoded value to be non-empty")
	}
	generic, err := value.DecodeValue()
	if err != nil {
		t.Fatalf("decode value failed: %v", err)
	}
	if generic["amount"] != "1000" {
		t.Fatalf("unexpected generic payload: %#v", generic)
	}
}

func TestIntentNameIsCharge(t *testing.T) {
	if !NewIntentName("Charge").IsCharge() {
		t.Fatal("expected charge intent")
	}
}
