/** ID of the <script type="application/json"> element containing challenge data. */
export const DATA_ELEMENT_ID = '__MPP_DATA__';

/** Query parameter that triggers serving the service worker JS. */
export const SERVICE_WORKER_PARAM = '__mpp_worker';

/** Data embedded in the HTML page by the server. */
export interface EmbeddedData {
  challenge: {
    id: string;
    realm: string;
    method: string;
    intent: string;
    request: string;
    expires?: string;
    description?: string;
    digest?: string;
    opaque?: string;
  };
  /** Solana network from methodDetails (mainnet-beta, devnet, localnet). */
  network: string;
  /** RPC URL to use for transaction submission. */
  rpcUrl?: string;
  /** Whether test mode is active (auto-detected from network). */
  testMode: boolean;
}
