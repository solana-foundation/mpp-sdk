package intents

import (
	"fmt"
	"math/big"
	"time"
)

// SubscriptionPeriodUnit identifies the billing-period unit.
type SubscriptionPeriodUnit string

const (
	SubscriptionPeriodDay   SubscriptionPeriodUnit = "day"
	SubscriptionPeriodWeek  SubscriptionPeriodUnit = "week"
	SubscriptionPeriodMonth SubscriptionPeriodUnit = "month"
)

// SubscriptionRequest is the shared subscription intent request body.
type SubscriptionRequest struct {
	Amount              string                 `json:"amount"`
	Currency            string                 `json:"currency"`
	PeriodUnit          SubscriptionPeriodUnit `json:"periodUnit"`
	PeriodCount         string                 `json:"periodCount"`
	Recipient           string                 `json:"recipient,omitempty"`
	SubscriptionExpires string                 `json:"subscriptionExpires,omitempty"`
	Description         string                 `json:"description,omitempty"`
	ExternalID          string                 `json:"externalId,omitempty"`
	MethodDetails       any                    `json:"methodDetails,omitempty"`
}

// Validate checks the shared subscription request shape.
func (r SubscriptionRequest) Validate() error {
	if _, err := parsePositiveDecimalString(r.Amount, "amount"); err != nil {
		return err
	}
	if r.Currency == "" {
		return fmt.Errorf("currency is required")
	}
	if _, err := r.ParsePeriodCount(); err != nil {
		return err
	}
	switch r.PeriodUnit {
	case SubscriptionPeriodDay, SubscriptionPeriodWeek, SubscriptionPeriodMonth:
	default:
		return fmt.Errorf("unsupported periodUnit: %s", r.PeriodUnit)
	}
	if r.SubscriptionExpires != "" {
		if _, err := r.ParseSubscriptionExpires(); err != nil {
			return err
		}
	}
	return nil
}

// ParseAmount parses the fixed billing-period amount.
func (r SubscriptionRequest) ParseAmount() (uint64, error) {
	return parsePositiveDecimalString(r.Amount, "amount")
}

// ParsePeriodCount parses the billing period count.
func (r SubscriptionRequest) ParsePeriodCount() (uint64, error) {
	return parsePositiveDecimalString(r.PeriodCount, "periodCount")
}

// ParseSubscriptionExpires parses subscriptionExpires when present.
func (r SubscriptionRequest) ParseSubscriptionExpires() (time.Time, error) {
	if r.SubscriptionExpires == "" {
		return time.Time{}, nil
	}
	value, err := time.Parse(time.RFC3339, r.SubscriptionExpires)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid subscriptionExpires: %w", err)
	}
	return value, nil
}

// SubscriptionReceipt is the shared receipt shape after activation or renewal.
type SubscriptionReceipt struct {
	Method         string `json:"method"`
	Reference      string `json:"reference"`
	Status         string `json:"status"`
	SubscriptionID string `json:"subscriptionId"`
	Timestamp      string `json:"timestamp"`
	ExternalID     string `json:"externalId,omitempty"`
}

// SubscriptionState tracks durable server accounting for one subscription.
type SubscriptionState struct {
	SubscriptionID string
	Anchor         time.Time
	PeriodUnit     SubscriptionPeriodUnit
	PeriodCount    uint64
	LastPaidPeriod int64
	CanceledAt     *time.Time
	Revoked        bool
}

// CurrentPeriod returns the period index for now.
func (s SubscriptionState) CurrentPeriod(now time.Time) (int64, error) {
	if s.Anchor.IsZero() {
		return 0, fmt.Errorf("subscription anchor is required")
	}
	if now.Before(s.Anchor) {
		return 0, nil
	}
	switch s.PeriodUnit {
	case SubscriptionPeriodDay:
		return int64(now.Sub(s.Anchor) / (24 * time.Hour * time.Duration(s.PeriodCount))), nil
	case SubscriptionPeriodWeek:
		return int64(now.Sub(s.Anchor) / (7 * 24 * time.Hour * time.Duration(s.PeriodCount))), nil
	case SubscriptionPeriodMonth:
		return 0, fmt.Errorf("calendar-month subscription accounting requires method-specific handling")
	default:
		return 0, fmt.Errorf("unsupported periodUnit: %s", s.PeriodUnit)
	}
}

// CanRenew returns whether a renewal may be charged for now's billing period.
func (s SubscriptionState) CanRenew(now time.Time) (bool, int64, error) {
	if s.Revoked {
		return false, 0, nil
	}
	if s.CanceledAt != nil && !now.Before(*s.CanceledAt) {
		return false, 0, nil
	}
	period, err := s.CurrentPeriod(now)
	if err != nil {
		return false, 0, err
	}
	return period > s.LastPaidPeriod, period, nil
}

// RecordRenewal marks now's billing period as paid.
func (s *SubscriptionState) RecordRenewal(now time.Time) (int64, error) {
	ok, period, err := s.CanRenew(now)
	if err != nil {
		return 0, err
	}
	if !ok {
		return period, fmt.Errorf("subscription period %d cannot renew", period)
	}
	s.LastPaidPeriod = period
	return period, nil
}

func parsePositiveDecimalString(input string, field string) (uint64, error) {
	if input == "" {
		return 0, fmt.Errorf("%s is required", field)
	}
	value := new(big.Int)
	if _, ok := value.SetString(input, 10); !ok || value.Sign() <= 0 || !value.IsUint64() {
		return 0, fmt.Errorf("invalid %s: %s", field, input)
	}
	if input != value.String() {
		return 0, fmt.Errorf("invalid %s: %s", field, input)
	}
	return value.Uint64(), nil
}
