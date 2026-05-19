package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"

	solana "github.com/gagliardetto/solana-go"

	mpp "github.com/solana-foundation/mpp-sdk/go"
	"github.com/solana-foundation/mpp-sdk/go/protocol/intents"
	"github.com/solana-foundation/mpp-sdk/go/server"
)

const (
	defaultResourcePath     = "/protected"
	defaultSecretKey        = "mpp-interop-secret-key"
	defaultSettlementHeader = "x-fixture-settlement"
	tokenDecimals           = 6
)

type readyMessage struct {
	Type           string   `json:"type"`
	Implementation string   `json:"implementation"`
	Role           string   `json:"role"`
	Port           int      `json:"port"`
	Capabilities   []string `json:"capabilities,omitempty"`
}

type interopServer struct {
	mpp              *server.Mpp
	resourcePath     string
	secretKey        string
	settlementHeader string
}

func main() {
	handler, err := newInteropServer()
	if err != nil {
		log.Fatalf("configure go interop server: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("bind go interop server: %v", err)
	}

	port := listener.Addr().(*net.TCPAddr).Port
	if err := json.NewEncoder(os.Stdout).Encode(readyMessage{
		Type:           "ready",
		Implementation: "go",
		Role:           "server",
		Port:           port,
		Capabilities:   []string{"charge"},
	}); err != nil {
		log.Fatalf("write ready message: %v", err)
	}

	if err := http.Serve(listener, handler.routes()); err != nil && err != http.ErrServerClosed {
		log.Fatalf("serve go interop server: %v", err)
	}
}

func newInteropServer() (*interopServer, error) {
	rpcURL := requiredEnv("MPP_INTEROP_RPC_URL")
	mint := requiredEnv("MPP_INTEROP_MINT")
	payTo := requiredEnv("MPP_INTEROP_PAY_TO")
	feePayer, err := readPrivateKeyEnv("MPP_INTEROP_FEE_PAYER_SECRET_KEY")
	if err != nil {
		return nil, err
	}

	network := envOrDefault("MPP_INTEROP_NETWORK", "localnet")
	secretKey := envOrDefault("MPP_INTEROP_SECRET_KEY", defaultSecretKey)
	m, err := server.New(server.Config{
		Recipient:      payTo,
		Currency:       mint,
		Decimals:       tokenDecimals,
		Network:        network,
		RPCURL:         rpcURL,
		SecretKey:      secretKey,
		Realm:          "MPP Interop",
		FeePayerSigner: feePayer,
		HTML:           false,
	})
	if err != nil {
		return nil, err
	}

	return &interopServer{
		mpp:              m,
		resourcePath:     defaultResourcePath,
		secretKey:        secretKey,
		settlementHeader: defaultSettlementHeader,
	}, nil
}

func (s *interopServer) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc(s.resourcePath, s.protected)
	return mux
}

func (s *interopServer) protected(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}

	if auth := r.Header.Get(mpp.AuthorizationHeader); strings.HasPrefix(auth, "Payment ") {
		credential, err := mpp.ParseAuthorization(auth)
		if err == nil {
			expected, expectedErr := s.expectedRequest()
			if expectedErr != nil {
				log.Printf("go interop expected request failed: %v", expectedErr)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": expectedErr.Error()})
				return
			}
			receipt, verifyErr := s.mpp.VerifyCredentialWithExpected(
				r.Context(),
				credential,
				expected,
			)
			if verifyErr == nil {
				receiptHeader, formatErr := mpp.FormatReceipt(receipt)
				if formatErr == nil {
					w.Header().Set(mpp.PaymentReceiptHeader, receiptHeader)
					w.Header().Set(s.settlementHeader, receipt.Reference)
					writeJSON(w, http.StatusOK, map[string]any{
						"ok":         true,
						"paid":       true,
						"settlement": map[string]any{"success": true, "transaction": receipt.Reference},
					})
					return
				}
				err = formatErr
			} else {
				err = verifyErr
			}
		}
		log.Printf("go interop credential rejected: %v", err)
	}

	challenge, err := s.issueChallenge(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	header, err := mpp.FormatWWWAuthenticate(challenge)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set(mpp.WWWAuthenticateHeader, header)
	writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": "payment_required"})
}

func (s *interopServer) issueChallenge(ctx context.Context) (mpp.PaymentChallenge, error) {
	challenge, err := s.mpp.ChargeWithOptions(ctx, envOrDefault("MPP_INTEROP_PRICE", "0.001"), server.ChargeOptions{
		Description: "Surfpool-backed protected content",
		FeePayer:    true,
	})
	if err != nil {
		return mpp.PaymentChallenge{}, err
	}

	requestValue, err := challenge.Request.DecodeValue()
	if err != nil {
		return mpp.PaymentChallenge{}, err
	}
	request, err := mpp.NewBase64URLJSONValue(requestValue)
	if err != nil {
		return mpp.PaymentChallenge{}, err
	}

	// Match mppx clients, which canonicalize request JSON before echoing it in
	// credentials. Without this, semantically identical request bodies can hash
	// to different challenge IDs across languages.
	challenge.Request = request
	challenge.ID = mpp.ComputeChallengeID(
		s.secretKey,
		challenge.Realm,
		string(challenge.Method),
		string(challenge.Intent),
		challenge.Request.Raw(),
		challenge.Expires,
		challenge.Digest,
		"",
	)
	return challenge, nil
}

func (s *interopServer) expectedRequest() (intents.ChargeRequest, error) {
	challenge, err := s.issueChallenge(context.Background())
	if err != nil {
		return intents.ChargeRequest{}, err
	}
	var request intents.ChargeRequest
	if err := challenge.Request.Decode(&request); err != nil {
		return intents.ChargeRequest{}, err
	}
	return request, nil
}

func readPrivateKeyEnv(name string) (solana.PrivateKey, error) {
	raw := requiredEnv(name)
	var values []int
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil, fmt.Errorf("parse %s: %w", name, err)
	}
	if len(values) != 64 {
		return nil, fmt.Errorf("%s must contain 64 private key bytes, got %d", name, len(values))
	}
	key := make([]byte, len(values))
	for i, value := range values {
		if value < 0 || value > 255 {
			return nil, fmt.Errorf("%s byte %d is outside uint8 range", name, i)
		}
		key[i] = byte(value)
	}
	return solana.PrivateKey(key), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write json response: %v", err)
	}
}

func requiredEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("%s is required", key)
	}
	return value
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
