package intents

import (
	"testing"
	"time"
)

func TestSubscriptionAccountStateRenewalAccounting(t *testing.T) {
	state := SubscriptionAccountState{
		SubscriptionID: "sub_1",
		Anchor:         mustSubscriptionTime(t, "2026-01-15T12:03:10Z"),
		PeriodUnit:     SubscriptionPeriodDay,
		PeriodCount:    30,
		LastPaidPeriod: 0,
	}
	period, err := state.RecordRenewal(mustSubscriptionTime(t, "2026-02-14T12:03:10Z"))
	if err != nil {
		t.Fatalf("record failed: %v", err)
	}
	if period != 1 || state.LastPaidPeriod != 1 {
		t.Fatalf("expected period 1, got period=%d state=%#v", period, state)
	}
	if _, err := state.RecordRenewal(mustSubscriptionTime(t, "2026-02-15T00:00:00Z")); err == nil {
		t.Fatal("expected duplicate renewal to fail")
	}
}

func TestSubscriptionAccountStateMissedPeriodsDoNotAccumulate(t *testing.T) {
	state := SubscriptionAccountState{
		SubscriptionID: "sub_1",
		Anchor:         mustSubscriptionTime(t, "2026-01-15T12:03:10Z"),
		PeriodUnit:     SubscriptionPeriodDay,
		PeriodCount:    30,
		LastPaidPeriod: 0,
	}
	period, err := state.RecordRenewal(mustSubscriptionTime(t, "2026-04-15T12:03:10Z"))
	if err != nil {
		t.Fatalf("record failed: %v", err)
	}
	if period != 3 || state.LastPaidPeriod != 3 {
		t.Fatalf("expected a single current-period renewal, got period=%d state=%#v", period, state)
	}
}

func TestSubscriptionAccountStateRejectsCanceledAndRevoked(t *testing.T) {
	canceledAt := mustSubscriptionTime(t, "2026-02-01T00:00:00Z")
	state := SubscriptionAccountState{
		SubscriptionID: "sub_1",
		Anchor:         mustSubscriptionTime(t, "2026-01-15T12:03:10Z"),
		PeriodUnit:     SubscriptionPeriodDay,
		PeriodCount:    30,
		LastPaidPeriod: 0,
		CanceledAt:     &canceledAt,
	}
	ok, _, err := state.CanRenew(mustSubscriptionTime(t, "2026-02-14T12:03:10Z"))
	if err != nil {
		t.Fatalf("can renew failed: %v", err)
	}
	if ok {
		t.Fatal("canceled subscription should not renew")
	}
	state.CanceledAt = nil
	state.Revoked = true
	ok, _, err = state.CanRenew(mustSubscriptionTime(t, "2026-02-14T12:03:10Z"))
	if err != nil {
		t.Fatalf("can renew failed: %v", err)
	}
	if ok {
		t.Fatal("revoked subscription should not renew")
	}
}

func mustSubscriptionTime(t *testing.T, input string) time.Time {
	t.Helper()
	value, err := time.Parse(time.RFC3339, input)
	if err != nil {
		t.Fatalf("invalid test time: %v", err)
	}
	return value
}
