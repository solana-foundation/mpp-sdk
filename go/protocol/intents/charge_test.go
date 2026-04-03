package intents

import "testing"

func TestParseUnits(t *testing.T) {
	value, err := ParseUnits("1.5", 6)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if value != "1500000" {
		t.Fatalf("unexpected units %q", value)
	}
}

func TestChargeRequestWithBaseUnits(t *testing.T) {
	decimals := uint8(6)
	request, err := (ChargeRequest{Amount: "2.25", Decimals: &decimals}).WithBaseUnits()
	if err != nil {
		t.Fatalf("conversion failed: %v", err)
	}
	if request.Amount != "2250000" || request.Decimals != nil {
		t.Fatalf("unexpected request: %#v", request)
	}
}

func TestValidateMaxAmount(t *testing.T) {
	if err := (ChargeRequest{Amount: "10"}).ValidateMaxAmount("9"); err == nil {
		t.Fatal("expected max amount validation to fail")
	}
}
