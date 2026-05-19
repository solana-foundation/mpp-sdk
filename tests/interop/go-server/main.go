package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	solana "github.com/gagliardetto/solana-go"
	"github.com/solana-foundation/mpp-sdk/go/server"
)

const (
	defaultSecretKey       = "mpp-interop-secret-key"
	defaultProtectedPath   = "/protected"
	defaultFixtureHeader   = "x-fixture-settlement"
	defaultNetwork         = "localnet"
	defaultPrice           = "0.001"
	defaultPaymentRealm    = "MPP Interop"
	defaultTokenDecimals   = uint8(6)
	defaultShutdownTimeout = 5 * time.Second
	implementationName     = "go"
	readyMessageType       = "ready"
	readyMessageRole       = "server"
	healthPath             = "/health"
	contentTypeHeader      = "content-type"
	applicationJSONContent = "application/json"
)

type interopEnvironment struct {
	RPCURL             string
	Network            string
	Mint               string
	PayTo              string
	SecretKey          string
	Price              string
	FeePayerPrivateKey solana.PrivateKey
}

type readyMessage struct {
	Type           string   `json:"type"`
	Implementation string   `json:"implementation"`
	Role           string   `json:"role"`
	Port           int      `json:"port"`
	Capabilities   []string `json:"capabilities,omitempty"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "FAIL: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	env, err := readInteropEnvironment()
	if err != nil {
		return err
	}

	mppServer, err := server.New(server.Config{
		Recipient:      env.PayTo,
		Currency:       env.Mint,
		Decimals:       defaultTokenDecimals,
		Network:        env.Network,
		RPCURL:         env.RPCURL,
		SecretKey:      env.SecretKey,
		Realm:          defaultPaymentRealm,
		FeePayerSigner: env.FeePayerPrivateKey,
	})
	if err != nil {
		return err
	}

	mux := http.NewServeMux()
	mux.HandleFunc(healthPath, func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.Handle(defaultProtectedPath, server.PaymentMiddleware(mppServer, func(_ *http.Request) (string, server.ChargeOptions, error) {
		return env.Price, server.ChargeOptions{
			Description: "Surfpool-backed protected content",
			FeePayer:    true,
		}, nil
	})(http.HandlerFunc(protectedHandler)))

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}

	httpServer := &http.Server{Handler: mux}
	errs := make(chan error, 1)
	go func() {
		if serveErr := httpServer.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed {
			errs <- serveErr
		}
	}()

	tcpAddr, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return fmt.Errorf("unexpected listener address %s", listener.Addr())
	}
	if err := json.NewEncoder(os.Stdout).Encode(readyMessage{
		Type:           readyMessageType,
		Implementation: implementationName,
		Role:           readyMessageRole,
		Port:           tcpAddr.Port,
		Capabilities:   []string{"charge"},
	}); err != nil {
		return err
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-errs:
		return err
	case <-signals:
		ctx, cancel := context.WithTimeout(context.Background(), defaultShutdownTimeout)
		defer cancel()
		return httpServer.Shutdown(ctx)
	}
}

func protectedHandler(w http.ResponseWriter, r *http.Request) {
	receipt, ok := server.ReceiptFromContext(r.Context())
	if ok && receipt.Reference != "" {
		w.Header().Set(defaultFixtureHeader, receipt.Reference)
	}
	writeJSON(w, http.StatusOK, map[string]bool{
		"ok":   true,
		"paid": true,
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set(contentTypeHeader, applicationJSONContent)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func readInteropEnvironment() (interopEnvironment, error) {
	feePayer, err := readPrivateKeyEnv("MPP_INTEROP_FEE_PAYER_SECRET_KEY")
	if err != nil {
		return interopEnvironment{}, err
	}
	rpcURL, err := readRequiredEnv("MPP_INTEROP_RPC_URL")
	if err != nil {
		return interopEnvironment{}, err
	}
	mint, err := readRequiredEnv("MPP_INTEROP_MINT")
	if err != nil {
		return interopEnvironment{}, err
	}
	payTo, err := readRequiredEnv("MPP_INTEROP_PAY_TO")
	if err != nil {
		return interopEnvironment{}, err
	}
	return interopEnvironment{
		RPCURL:             rpcURL,
		Network:            envOrDefault("MPP_INTEROP_NETWORK", defaultNetwork),
		Mint:               mint,
		PayTo:              payTo,
		SecretKey:          envOrDefault("MPP_INTEROP_SECRET_KEY", defaultSecretKey),
		Price:              envOrDefault("MPP_INTEROP_PRICE", defaultPrice),
		FeePayerPrivateKey: feePayer,
	}, nil
}

func readRequiredEnv(name string) (string, error) {
	value := os.Getenv(name)
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func envOrDefault(name string, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func readPrivateKeyEnv(name string) (solana.PrivateKey, error) {
	raw := os.Getenv(name)
	if raw == "" {
		return nil, fmt.Errorf("%s is required", name)
	}
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
