package server

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func newHTMLTestMpp(t *testing.T) *Mpp {
	t.Helper()
	handler, err := New(Config{
		Recipient: "CXhrFZJLKqjzmP3sjYLcF4dTeXWKCy9e2SXXZ2Yo6MPY",
		SecretKey: "test-secret-key-that-is-long-enough-for-hmac-sha256-operations",
		Network:   "devnet",
		HTML:      true,
	})
	if err != nil {
		t.Fatalf("new mpp failed: %v", err)
	}
	return handler
}

func TestAcceptsHTML(t *testing.T) {
	tests := []struct {
		name   string
		accept string
		want   bool
	}{
		{"text/html", "text/html", true},
		{"text/html with charset", "text/html; charset=utf-8", true},
		{"mixed with html first", "text/html, application/json", true},
		{"mixed with json first", "application/json, text/html", true},
		{"application/json only", "application/json", false},
		{"empty", "", false},
		{"wildcard", "*/*", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &http.Request{Header: http.Header{}}
			if tt.accept != "" {
				r.Header.Set("Accept", tt.accept)
			}
			if got := AcceptsHTML(r); got != tt.want {
				t.Fatalf("AcceptsHTML(%q) = %v, want %v", tt.accept, got, tt.want)
			}
		})
	}
}

func TestIsServiceWorkerRequest(t *testing.T) {
	tests := []struct {
		name    string
		rawURL  string
		want    bool
	}{
		{"with param", "http://example.com/?__mpp_worker", true},
		{"with param and value", "http://example.com/?__mpp_worker=1", true},
		{"without param", "http://example.com/", false},
		{"other param only", "http://example.com/?foo=bar", false},
		{"mixed params", "http://example.com/?foo=bar&__mpp_worker", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			u, err := url.Parse(tt.rawURL)
			if err != nil {
				t.Fatalf("parse url: %v", err)
			}
			r := &http.Request{URL: u}
			if got := IsServiceWorkerRequest(r); got != tt.want {
				t.Fatalf("IsServiceWorkerRequest(%q) = %v, want %v", tt.rawURL, got, tt.want)
			}
		})
	}
}

func TestServiceWorkerJS(t *testing.T) {
	js := ServiceWorkerJS()
	if js == "" {
		t.Fatal("ServiceWorkerJS() returned empty string")
	}
}

func TestChallengeToHTML(t *testing.T) {
	handler := newHTMLTestMpp(t)
	challenge, err := handler.ChargeWithOptions(context.Background(), "1.00", ChargeOptions{
		Description: "Test payment",
	})
	if err != nil {
		t.Fatalf("charge failed: %v", err)
	}

	html, err := handler.ChallengeToHTML(challenge)
	if err != nil {
		t.Fatalf("ChallengeToHTML failed: %v", err)
	}

	checks := []struct {
		name   string
		substr string
	}{
		{"doctype", "<!DOCTYPE html>"},
		{"data element", `id="__MPP_DATA__"`},
		{"root div", `id="root"`},
		{"challenge ID", challenge.ID},
		{"payment UI script", "<script>"},
	}
	for _, c := range checks {
		t.Run(c.name, func(t *testing.T) {
			if !strings.Contains(html, c.substr) {
				t.Fatalf("expected HTML to contain %q", c.substr)
			}
		})
	}

	// The challenge JSON in the <pre> block must be HTML-escaped so that
	// any markup inside field values cannot break out of the display area.
	// The description "Test payment" is safe, but the escaped challenge JSON
	// section should not contain unescaped angle brackets from field values.
	preStart := strings.Index(html, "<pre>")
	preEnd := strings.Index(html, "</pre>")
	if preStart < 0 || preEnd < 0 {
		t.Fatal("expected <pre> block in HTML")
	}
	preContent := html[preStart+5 : preEnd]
	// The pre content is the HTML-escaped challenge JSON; it should not
	// contain raw < or > (they should all be escaped as &lt; / &gt;).
	if strings.ContainsAny(preContent, "<>") {
		t.Fatal("expected challenge JSON in <pre> to be fully HTML-escaped")
	}
}

func TestHTMLEnabled(t *testing.T) {
	enabled := newHTMLTestMpp(t)
	if !enabled.HTMLEnabled() {
		t.Fatal("expected HTMLEnabled() = true when Config.HTML is true")
	}

	disabled, err := New(Config{
		Recipient: "CXhrFZJLKqjzmP3sjYLcF4dTeXWKCy9e2SXXZ2Yo6MPY",
		SecretKey: "test-secret-key-that-is-long-enough-for-hmac-sha256-operations",
		Network:   "devnet",
		HTML:      false,
	})
	if err != nil {
		t.Fatalf("new mpp failed: %v", err)
	}
	if disabled.HTMLEnabled() {
		t.Fatal("expected HTMLEnabled() = false when Config.HTML is false")
	}
}

func TestChallengeToHTMLTestMode(t *testing.T) {
	handler := newHTMLTestMpp(t)
	challenge, err := handler.Charge(context.Background(), "1.00")
	if err != nil {
		t.Fatalf("charge failed: %v", err)
	}

	html, err := handler.ChallengeToHTML(challenge)
	if err != nil {
		t.Fatalf("ChallengeToHTML failed: %v", err)
	}

	if !strings.Contains(html, `"testMode":true`) {
		t.Fatal("expected embedded JSON to contain \"testMode\":true for devnet")
	}
}

func TestChallengeToHTMLEscapesDescription(t *testing.T) {
	handler := newHTMLTestMpp(t)
	challenge, err := handler.ChargeWithOptions(context.Background(), "1.00", ChargeOptions{
		Description: `<script>alert(1)</script>`,
	})
	if err != nil {
		t.Fatalf("charge failed: %v", err)
	}

	html, err := handler.ChallengeToHTML(challenge)
	if err != nil {
		t.Fatalf("ChallengeToHTML failed: %v", err)
	}

	if strings.Contains(html, `<script>alert(1)</script>`) {
		t.Fatal("expected description to be HTML-escaped, but found raw <script> tag")
	}
	if !strings.Contains(html, `&lt;script&gt;alert(1)&lt;/script&gt;`) {
		t.Fatal("expected HTML-escaped description in output")
	}
}
