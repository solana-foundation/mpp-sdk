export type AuthorizationMode = 'regular_budget' | 'regular_unbounded' | 'swig_session';

export interface SessionVoucher {
    chainId: string;
    channelId: string;
    channelProgram: string;
    cumulativeAmount: string;
    expiresAt?: string;
    meter: string;
    payer: string;
    recipient: string;
    sequence: number;
    serverNonce: string;
    units: string;
}

export interface SignedSessionVoucher {
    signature: string;
    signatureType: 'ed25519' | 'swig-session';
    signer: string;
    voucher: SessionVoucher;
}

export interface ChannelState {
    asset: { decimals: number; kind: 'sol' | 'spl'; mint?: string };
    authority: {
        delegatedSessionKey?: string;
        swigRoleId?: number;
        wallet: string;
    };
    authorizationMode: AuthorizationMode;
    channelId: string;
    createdAt: string;
    escrowedAmount: string;
    expiresAtUnix: number | null;
    lastAuthorizedAmount: string;
    lastSequence: number;
    openSlot: number;
    payer: string;
    recipient: string;
    serverNonce: string;
    settledAmount: string;
    status: 'closed' | 'closing' | 'expired' | 'open';
}

export type SessionCredentialPayload =
    | {
          action: 'close';
          channelId: string;
          closeTx?: string;
          voucher: SignedSessionVoucher;
      }
    | {
          action: 'open';
          authorizationMode: AuthorizationMode;
          capabilities?: {
              allowedActions?: string[];
              maxCumulativeAmount?: string;
          };
          channelId: string;
          depositAmount: string;
          expiresAt?: string;
          openTx: string;
          payer: string;
          voucher: SignedSessionVoucher;
      }
    | {
          action: 'topup';
          additionalAmount: string;
          channelId: string;
          topupTx: string;
      }
    | {
          action: 'update';
          channelId: string;
          voucher: SignedSessionVoucher;
      };

export interface VoucherVerifier {
    verify(voucher: SignedSessionVoucher, channel: ChannelState): Promise<boolean>;
}

export interface SessionAuthorizer {
    authorizeClose(input: AuthorizeCloseInput): Promise<AuthorizedClose>;
    authorizeOpen(input: AuthorizeOpenInput): Promise<AuthorizedOpen>;
    authorizeTopup(input: AuthorizeTopupInput): Promise<AuthorizedTopup>;
    authorizeUpdate(input: AuthorizeUpdateInput): Promise<AuthorizedUpdate>;
    getCapabilities(): AuthorizerCapabilities;
    getMode(): AuthorizationMode;
}

export interface AuthorizeOpenInput {
    asset: { decimals: number; kind: 'sol' | 'spl'; mint?: string };
    channelId: string;
    channelProgram: string;
    depositAmount: string;
    network: string;
    pricing?: { amountPerUnit: string; meter: string; unit: string };
    recipient: string;
    serverNonce: string;
}

export interface AuthorizedOpen {
    capabilities: AuthorizerCapabilities;
    expiresAt?: string;
    openTx: string;
    voucher: SignedSessionVoucher;
}

export interface AuthorizeUpdateInput {
    channelId: string;
    channelProgram: string;
    cumulativeAmount: string;
    meter: string;
    network: string;
    recipient: string;
    sequence: number;
    serverNonce: string;
    units: string;
}

export interface AuthorizedUpdate {
    voucher: SignedSessionVoucher;
}

export interface AuthorizeTopupInput {
    additionalAmount: string;
    channelId: string;
    channelProgram: string;
    network: string;
}

export interface AuthorizedTopup {
    topupTx: string;
}

export interface AuthorizeCloseInput {
    channelId: string;
    channelProgram: string;
    finalCumulativeAmount: string;
    network: string;
    recipient: string;
    sequence: number;
    serverNonce: string;
}

export interface AuthorizedClose {
    closeTx?: string;
    voucher: SignedSessionVoucher;
}

export interface AuthorizerCapabilities {
    allowedActions?: Array<'close' | 'open' | 'topup' | 'update'>;
    allowedPrograms?: string[];
    expiresAt?: string;
    maxCumulativeAmount?: string;
    maxDepositAmount?: string;
    mode: AuthorizationMode;
    requiresInteractiveApproval: {
        close: boolean;
        open: boolean;
        topup: boolean;
        update: boolean;
    };
}

export type SessionPolicyProfile =
    | {
          autoTopup?: {
              amount: string;
              enabled: boolean;
              triggerBelow: string;
          };
          depositLimit?: string;
          profile: 'swig-time-bound';
          spendLimit?: string;
          ttlSeconds: number;
      }
    | {
          maxCumulativeAmount: string;
          maxDepositAmount?: string;
          profile: 'wallet-budget';
          requireApprovalOnTopup?: boolean;
          validUntil?: string;
      }
    | {
          profile: 'wallet-manual';
          requireApprovalOnEveryUpdate: boolean;
      };
