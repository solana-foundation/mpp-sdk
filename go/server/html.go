package server

import (
	_ "embed"
	"encoding/json"
	"fmt"
	gohtml "html"
	"net/http"
	"strings"

	mpp "github.com/solana-foundation/mpp-sdk/go"
	"github.com/solana-foundation/mpp-sdk/go/protocol/intents"
)

//go:embed html/payment-ui.gen.js
var paymentUIJS string

//go:embed html/service-worker.gen.js
var serviceWorkerJS string

const (
	dataElementID      = "__MPP_DATA__"
	serviceWorkerParam = "__mpp_worker"
)

// HTMLEnabled reports whether HTML payment links are enabled.
func (m *Mpp) HTMLEnabled() bool {
	return m.html
}

// RPCURL returns the resolved Solana RPC endpoint URL.
func (m *Mpp) RPCURL() string {
	return m.rpcURL
}

// ChallengeToHTML renders a self-contained HTML payment page for the given challenge.
// The page embeds the challenge data and inlined payment UI JavaScript so that
// a browser can complete the Solana payment flow without any external requests.
func (m *Mpp) ChallengeToHTML(challenge mpp.PaymentChallenge) (string, error) {
	challengeJSON, err := json.Marshal(challenge)
	if err != nil {
		return "", fmt.Errorf("marshal challenge: %w", err)
	}

	// Decode the request field to extract the network for test-mode detection.
	var request intents.ChargeRequest
	if err := challenge.Request.Decode(&request); err != nil {
		return "", fmt.Errorf("decode challenge request: %w", err)
	}

	network := m.network
	testMode := network == "devnet" || network == "localnet"

	embeddedData := map[string]any{
		"challenge": json.RawMessage(challengeJSON),
		"network":   network,
		"rpcUrl":    m.rpcURL,
		"testMode":  testMode,
	}
	embeddedDataJSON, err := json.Marshal(embeddedData)
	if err != nil {
		return "", fmt.Errorf("marshal embedded data: %w", err)
	}

	escapedChallengeJSON := gohtml.EscapeString(string(challengeJSON))

	descriptionLine := ""
	if request.Description != "" {
		descriptionLine = fmt.Sprintf(`<p style="color:#4a5568;text-align:center">%s</p>`, gohtml.EscapeString(request.Description))
	}

	var b strings.Builder
	b.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payment Required</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; background: #f7fafc; color: #1a202c; }
pre { background: #edf2f7; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; max-width: 600px; margin: 20px auto; }
</style>
</head>
<body>
`)
	b.WriteString(descriptionLine)
	b.WriteString(`
<details style="max-width:600px;margin:0 auto 20px">
<summary style="cursor:pointer;color:#718096;font-size:14px">Challenge details</summary>
<pre>`)
	b.WriteString(escapedChallengeJSON)
	b.WriteString(`</pre>
</details>
<div id="root"></div>
<script type="application/json" id="`)
	b.WriteString(dataElementID)
	b.WriteString(`">`)
	// JSON inside <script type="application/json"> is not parsed as HTML.
	// Go's json.Marshal already escapes <, >, & in string values, so
	// </script> injection is not possible.
	b.Write(embeddedDataJSON)
	b.WriteString(`</script>
<script>`)
	b.WriteString(paymentUIJS)
	b.WriteString(`</script>
</body>
</html>`)

	return b.String(), nil
}

// ServiceWorkerJS returns the embedded service worker JavaScript content.
func ServiceWorkerJS() string {
	return serviceWorkerJS
}

// AcceptsHTML reports whether the request's Accept header includes "text/html".
func AcceptsHTML(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}

// IsServiceWorkerRequest reports whether the request URL contains the
// service worker query parameter (__mpp_worker).
func IsServiceWorkerRequest(r *http.Request) bool {
	return r.URL.Query().Has(serviceWorkerParam)
}
