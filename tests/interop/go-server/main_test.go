package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	solana "github.com/gagliardetto/solana-go"
)

func TestReadPrivateKeyEnvParsesJSONByteArray(t *testing.T) {
	privateKey, err := solana.NewRandomPrivateKey()
	if err != nil {
		t.Fatalf("new private key: %v", err)
	}
	values := make([]int, len(privateKey))
	for i, value := range []byte(privateKey) {
		values[i] = int(value)
	}
	raw, err := json.Marshal(values)
	if err != nil {
		t.Fatalf("marshal private key: %v", err)
	}
	t.Setenv("MPP_INTEROP_FEE_PAYER_SECRET_KEY", string(raw))

	got, err := readPrivateKeyEnv("MPP_INTEROP_FEE_PAYER_SECRET_KEY")
	if err != nil {
		t.Fatalf("read private key: %v", err)
	}
	if got.PublicKey() != privateKey.PublicKey() {
		t.Fatalf("expected public key %s, got %s", privateKey.PublicKey(), got.PublicKey())
	}
}

func TestReadPrivateKeyEnvRejectsInvalidLength(t *testing.T) {
	t.Setenv("MPP_INTEROP_FEE_PAYER_SECRET_KEY", "[1,2,3]")

	_, err := readPrivateKeyEnv("MPP_INTEROP_FEE_PAYER_SECRET_KEY")
	if err == nil {
		t.Fatal("expected invalid private key length to fail")
	}
}

func TestReadInteropEnvironmentAppliesDefaults(t *testing.T) {
	privateKey, err := solana.NewRandomPrivateKey()
	if err != nil {
		t.Fatalf("new private key: %v", err)
	}
	values := make([]int, len(privateKey))
	for i, value := range []byte(privateKey) {
		values[i] = int(value)
	}
	raw, err := json.Marshal(values)
	if err != nil {
		t.Fatalf("marshal private key: %v", err)
	}
	t.Setenv("MPP_INTEROP_RPC_URL", "http://127.0.0.1:8899")
	t.Setenv("MPP_INTEROP_MINT", "mint")
	t.Setenv("MPP_INTEROP_PAY_TO", "pay-to")
	t.Setenv("MPP_INTEROP_FEE_PAYER_SECRET_KEY", string(raw))

	env, err := readInteropEnvironment()
	if err != nil {
		t.Fatalf("read interop env: %v", err)
	}
	if env.Network != defaultNetwork {
		t.Fatalf("expected default network %q, got %q", defaultNetwork, env.Network)
	}
	if env.SecretKey != defaultSecretKey {
		t.Fatalf("expected default secret key")
	}
	if env.Price != defaultPrice {
		t.Fatalf("expected default price %q, got %q", defaultPrice, env.Price)
	}
}

func TestWriteJSONSetsStatusAndContentType(t *testing.T) {
	recorder := httptest.NewRecorder()

	writeJSON(recorder, http.StatusAccepted, map[string]bool{"ok": true})

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", recorder.Code)
	}
	if recorder.Header().Get(contentTypeHeader) != applicationJSONContent {
		t.Fatalf("expected JSON content type")
	}
	if recorder.Body.String() != "{\"ok\":true}\n" {
		t.Fatalf("unexpected body %q", recorder.Body.String())
	}
}
