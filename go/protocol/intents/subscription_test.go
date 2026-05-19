package intents

import (
	"encoding/json"
	"testing"
	"time"
)

func TestSubscriptionRequestValidate(t *testing.T) {
	request := SubscriptionRequest{
		Amount:              "1000000",
		Currency:            "usd",
		PeriodUnit:          SubscriptionPeriodMonth,
		PeriodCount:         "1",
		SubscriptionExpires: "2026-07-14T12:00:00Z",
	}
	if err := request.Validate(); err != nil {
		t.Fatalf("valid request failed: %v", err)
	}
}

func TestSubscriptionRequestRejectsInvalidShapes(t *testing.T) {
	tests := []SubscriptionRequest{
		{Amount: "0", Currency: "usd", PeriodUnit: SubscriptionPeriodMonth, PeriodCount: "1"},
		{Amount: "9.99", Currency: "usd", PeriodUnit: SubscriptionPeriodMonth, PeriodCount: "1"},
		{Amount: "100", Currency: "", PeriodUnit: SubscriptionPeriodMonth, PeriodCount: "1"},
		{Amount: "100", Currency: "usd", PeriodUnit: "year", PeriodCount: "1"},
		{Amount: "100", Currency: "usd", PeriodUnit: SubscriptionPeriodMonth, PeriodCount: "0"},
		{Amount: "100", Currency: "usd", PeriodUnit: SubscriptionPeriodMonth, PeriodCount: "01"},
		{Amount: "100", Currency: "usd", PeriodUnit: SubscriptionPeriodMonth, PeriodCount: "1", SubscriptionExpires: "not-a-date"},
	}
	for _, request := range tests {
		if err := request.Validate(); err == nil {
			t.Fatalf("expected request to fail: %#v", request)
		}
	}
}

func TestSubscriptionRequestRoundTrip(t *testing.T) {
	input := []byte(`{"amount":"1000000","currency":"usd","periodUnit":"month","periodCount":"1","description":"Monthly API plan","externalId":"plan_monthly_api"}`)
	var request SubscriptionRequest
	if err := json.Unmarshal(input, &request); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if err := request.Validate(); err != nil {
		t.Fatalf("validate failed: %v", err)
	}
	output, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(output, &decoded); err != nil {
		t.Fatalf("roundtrip output invalid: %v", err)
	}
	if decoded["periodUnit"] != "month" {
		t.Fatalf("unexpected period unit: %v", decoded["periodUnit"])
	}
}

func TestSubscriptionStateRenewalAccounting(t *testing.T) {
	anchor := mustTime(t, "2026-01-15T12:03:10Z")
	state := SubscriptionState{
		SubscriptionID: "sub_1",
		Anchor:         anchor,
		PeriodUnit:     SubscriptionPeriodDay,
		PeriodCount:    30,
		LastPaidPeriod: 0,
	}
	ok, period, err := state.CanRenew(mustTime(t, "2026-02-14T12:03:10Z"))
	if err != nil {
		t.Fatalf("can renew failed: %v", err)
	}
	if !ok || period != 1 {
		t.Fatalf("expected period 1 renewal, got ok=%v period=%d", ok, period)
	}
	recorded, err := state.RecordRenewal(mustTime(t, "2026-02-14T12:03:10Z"))
	if err != nil {
		t.Fatalf("record failed: %v", err)
	}
	if recorded != 1 || state.LastPaidPeriod != 1 {
		t.Fatalf("unexpected recorded period %d state %#v", recorded, state)
	}
	if _, err := state.RecordRenewal(mustTime(t, "2026-02-15T00:00:00Z")); err == nil {
		t.Fatal("expected duplicate period renewal to fail")
	}
}

func TestSubscriptionStateMissedPeriodsDoNotAccumulate(t *testing.T) {
	state := SubscriptionState{
		SubscriptionID: "sub_1",
		Anchor:         mustTime(t, "2026-01-15T12:03:10Z"),
		PeriodUnit:     SubscriptionPeriodDay,
		PeriodCount:    30,
		LastPaidPeriod: 0,
	}
	period, err := state.RecordRenewal(mustTime(t, "2026-04-15T12:03:10Z"))
	if err != nil {
		t.Fatalf("record failed: %v", err)
	}
	if period != 3 || state.LastPaidPeriod != 3 {
		t.Fatalf("expected one renewal for current period 3, got %d", period)
	}
}

func TestSubscriptionStateCancellationAndMonthHandling(t *testing.T) {
	canceledAt := mustTime(t, "2026-02-01T00:00:00Z")
	state := SubscriptionState{
		SubscriptionID: "sub_1",
		Anchor:         mustTime(t, "2026-01-15T12:03:10Z"),
		PeriodUnit:     SubscriptionPeriodDay,
		PeriodCount:    30,
		LastPaidPeriod: 0,
		CanceledAt:     &canceledAt,
	}
	ok, _, err := state.CanRenew(mustTime(t, "2026-02-14T12:03:10Z"))
	if err != nil {
		t.Fatalf("can renew failed: %v", err)
	}
	if ok {
		t.Fatal("canceled subscription should not renew")
	}

	state.PeriodUnit = SubscriptionPeriodMonth
	state.CanceledAt = nil
	if _, err := state.CurrentPeriod(mustTime(t, "2026-02-14T12:03:10Z")); err == nil {
		t.Fatal("month accounting should be deferred")
	}
}

func mustTime(t *testing.T, input string) time.Time {
	t.Helper()
	value, err := time.Parse(time.RFC3339, input)
	if err != nil {
		t.Fatalf("invalid test time: %v", err)
	}
	return value
}
