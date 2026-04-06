import type { EmbeddedData } from './config';

/** Base64url-encode a string (no padding). */
function base64UrlEncode(data: string): string {
  return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url-decode a string. */
export function base64UrlDecode(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded);
}

/** Decode the base64url-encoded `request` field from a challenge. */
export function decodeRequest(request: string): {
  amount: string;
  currency: string;
  recipient: string;
  description?: string;
  externalId?: string;
  methodDetails?: {
    network?: string;
    decimals?: number;
    feePayer?: boolean;
    feePayerKey?: string;
    recentBlockhash?: string;
    tokenProgram?: string;
    splits?: Array<{ recipient: string; amount: string; memo?: string }>;
  };
} {
  return JSON.parse(base64UrlDecode(request));
}

/**
 * Build the full credential JSON and base64url-encode it for the Authorization header.
 *
 * The credential echoes back the original challenge and includes the signed
 * transaction as a pull-mode payload.
 */
export function buildCredential(
  challenge: EmbeddedData['challenge'],
  transactionBase64: string,
  source?: string,
): string {
  const credential = {
    challenge: {
      id: challenge.id,
      realm: challenge.realm,
      method: challenge.method,
      intent: challenge.intent,
      request: challenge.request,
      ...(challenge.expires && { expires: challenge.expires }),
      ...(challenge.description && { description: challenge.description }),
      ...(challenge.digest && { digest: challenge.digest }),
      ...(challenge.opaque && { opaque: challenge.opaque }),
    },
    ...(source && { source }),
    payload: {
      type: 'transaction' as const,
      transaction: transactionBase64,
    },
  };

  return base64UrlEncode(JSON.stringify(credential));
}
