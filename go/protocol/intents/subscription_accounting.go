package intents

import "time"

// SubscriptionAccountState is the minimum durable state needed to avoid
// duplicate charges for a fixed-amount subscription.
type SubscriptionAccountState struct {
	SubscriptionID string
	Anchor         time.Time
	PeriodUnit     SubscriptionPeriodUnit
	PeriodCount    uint64
	LastPaidPeriod int64
	CanceledAt     *time.Time
	Revoked        bool
}

// CurrentPeriod returns the day/week period index for now.
func (s SubscriptionAccountState) CurrentPeriod(now time.Time) (int64, error) {
	return (SubscriptionState)(s).CurrentPeriod(now)
}

// CanRenew returns whether one renewal may be charged for now's period.
func (s SubscriptionAccountState) CanRenew(now time.Time) (bool, int64, error) {
	return (SubscriptionState)(s).CanRenew(now)
}

// RecordRenewal marks now's billing period as paid.
func (s *SubscriptionAccountState) RecordRenewal(now time.Time) (int64, error) {
	state := SubscriptionState(*s)
	period, err := (&state).RecordRenewal(now)
	*s = SubscriptionAccountState(state)
	return period, err
}
