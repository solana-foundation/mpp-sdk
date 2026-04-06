import React, { useCallback, useState } from 'react';
import {
  AppProvider,
  useWallet,
  useWalletConnectors,
  useConnectWallet,
  useTransactionSigner,
  useCluster,
} from '@solana/connector/react';
import { getDefaultConfig } from '@solana/connector/headless';
import type { EmbeddedData } from './config';
import { buildCredential, decodeRequest } from './credential';
import { submitViaServiceWorker } from './service-worker-client';
import { buildTransaction, buildTestTransaction } from './transaction';

// Map known mint addresses to human-readable symbols
const KNOWN_CURRENCY_NAMES: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo': 'PYUSD',
};

function displayCurrency(currency: string): string {
  if (currency.toLowerCase() === 'sol') return 'SOL';
  return KNOWN_CURRENCY_NAMES[currency] ?? `${currency.slice(0, 4)}...${currency.slice(-4)}`;
}

// ── Styles ──

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: '420px',
    margin: '60px auto',
    padding: '32px',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    backgroundColor: '#ffffff',
    color: '#1a202c',
  } as React.CSSProperties,
  title: {
    fontSize: '20px',
    fontWeight: 600,
    marginBottom: '8px',
  } as React.CSSProperties,
  subtitle: {
    fontSize: '14px',
    color: '#718096',
    marginBottom: '24px',
  } as React.CSSProperties,
  amount: {
    fontSize: '36px',
    fontWeight: 700,
    textAlign: 'center' as const,
    marginBottom: '24px',
  } as React.CSSProperties,
  description: {
    fontSize: '14px',
    color: '#4a5568',
    textAlign: 'center' as const,
    marginBottom: '24px',
  } as React.CSSProperties,
  button: {
    width: '100%',
    padding: '14px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
    backgroundColor: '#9945FF',
    color: '#ffffff',
    transition: 'opacity 0.15s',
  } as React.CSSProperties,
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  } as React.CSSProperties,
  walletList: {
    listStyle: 'none',
    padding: 0,
    margin: '0 0 16px 0',
  } as React.CSSProperties,
  walletItem: {
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
    marginBottom: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '15px',
    transition: 'background-color 0.15s',
  } as React.CSSProperties,
  walletIcon: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
  } as React.CSSProperties,
  error: {
    color: '#e53e3e',
    fontSize: '14px',
    marginTop: '12px',
    textAlign: 'center' as const,
  } as React.CSSProperties,
  status: {
    fontSize: '14px',
    color: '#718096',
    textAlign: 'center' as const,
    marginTop: '12px',
  } as React.CSSProperties,
} as const;

// ── Payment Flow Component ──

function PaymentFlow({ data }: { data: EmbeddedData }) {
  const { isConnected } = useWallet();
  const connectors = useWalletConnectors();
  const { connect, isConnecting } = useConnectWallet();
  const transactionSigner = useTransactionSigner();
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');

  const request = decodeRequest(data.challenge.request);
  const decimals = request.methodDetails?.decimals ?? (request.currency.toLowerCase() === 'sol' ? 9 : 6);
  const rawAmount = Number(request.amount) / 10 ** decimals;
  const displayAmount = rawAmount % 1 === 0 ? rawAmount.toString() : rawAmount.toFixed(Math.min(decimals, 2));

  const handlePay = useCallback(async () => {
    if (!transactionSigner) return;
    setError('');

    try {
      setStatus('Building transaction...');

      const txBytes = await buildTransaction(request, data, transactionSigner);

      setStatus('Submitting payment...');
      const txBase64 = btoa(String.fromCharCode(...txBytes));
      const source = transactionSigner.address
        ? `did:pkh:solana:${data.network === 'mainnet-beta' ? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' : '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'}:${transactionSigner.address}`
        : undefined;
      const credential = buildCredential(data.challenge, txBase64, source);
      await submitViaServiceWorker(credential);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
      setStatus('');
    }
  }, [transactionSigner, request, data]);

  return (
    <div style={styles.container}>
      <div style={styles.title}>{request.description ?? 'Payment Required'}</div>
      <div style={styles.subtitle}>{data.challenge.realm}</div>

      <div style={styles.amount}>
        {displayAmount} {displayCurrency(request.currency)}
      </div>

      {!isConnected ? (
        <>
          <ul style={styles.walletList}>
            {connectors.map((connector) => (
              <li
                key={connector.id}
                style={{
                  ...styles.walletItem,
                  ...(isConnecting ? { opacity: 0.6, pointerEvents: 'none' as const } : {}),
                }}
                onClick={() => connect(connector.id)}
              >
                {connector.icon && (
                  <img src={connector.icon} alt="" style={styles.walletIcon} />
                )}
                {connector.name}
              </li>
            ))}
          </ul>
          {connectors.length === 0 && (
            <div style={styles.status}>No Solana wallets detected. Install a wallet to continue.</div>
          )}
        </>
      ) : (
        <button
          style={{
            ...styles.button,
            ...(status ? styles.buttonDisabled : {}),
          }}
          disabled={!!status}
          onClick={handlePay}
        >
          {status || 'Pay with Solana'}
        </button>
      )}

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

// ── Test Mode Component ──

function TestModeFlow({ data }: { data: EmbeddedData }) {
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');

  const request = decodeRequest(data.challenge.request);
  const decimals = request.methodDetails?.decimals ?? (request.currency.toLowerCase() === 'sol' ? 9 : 6);
  const rawAmount = Number(request.amount) / 10 ** decimals;
  const displayAmount = rawAmount % 1 === 0 ? rawAmount.toString() : rawAmount.toFixed(Math.min(decimals, 2));

  const handlePay = useCallback(async () => {
    setError('');
    try {
      setStatus('Generating test keypair...');
      const txBytes = await buildTestTransaction(request, data);

      setStatus('Submitting payment...');
      const txBase64 = btoa(String.fromCharCode(...txBytes));
      const credential = buildCredential(data.challenge, txBase64);
      await submitViaServiceWorker(credential);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
      setStatus('');
    }
  }, [request, data]);

  return (
    <div style={styles.container}>
      <div style={styles.title}>{request.description ?? 'Payment Required'}</div>
      <div style={styles.subtitle}>{data.challenge.realm} (test mode)</div>

      <div style={styles.amount}>
        {displayAmount} {displayCurrency(request.currency)}
      </div>

      <button
        style={{
          ...styles.button,
          ...(status ? styles.buttonDisabled : {}),
          backgroundColor: '#14F195',
          color: '#1a202c',
        }}
        disabled={!!status}
        onClick={handlePay}
      >
        {status || 'Pay (Test Mode)'}
      </button>

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

// ── Root Component ──

const connectorConfig = getDefaultConfig({
  appName: 'MPP Payment',
  autoConnect: true,
});

export function PaymentPage({ data }: { data: EmbeddedData }) {
  if (data.testMode) {
    return <TestModeFlow data={data} />;
  }

  return (
    <AppProvider connectorConfig={connectorConfig}>
      <PaymentFlow data={data} />
    </AppProvider>
  );
}
