export interface AppConfig {
  rpcUrl: string;
  networkPassphrase: string;
  didRegistryId: string;
  vcVerifierId: string;
  complianceEngineId: string;
  kycIssuerUrl: string;
}

const env = (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env) || {};

export const DEFAULT_CONFIG: AppConfig = {
  rpcUrl: env.VITE_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
  networkPassphrase: env.VITE_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015",
  didRegistryId: env.VITE_DID_REGISTRY_ID || "CBPKUCAYGAFRKXKHRLLG7KZXCHQAGYRQLIGKPXOGLCZGZTMV5JN3SBBX",
  vcVerifierId: env.VITE_VC_VERIFIER_ID || "CABOISTOEOYKQY46U2TU57DXOGLTQRTUB5THLS2ICMYXMDF2SA7L3UPJ",
  complianceEngineId: env.VITE_COMPLIANCE_ENGINE_ID || "CAZSHQLBCHWVCALAN4SNI3MB2IVD4UNS6PCZ763LK47N6IU3YCOP73TA",
  kycIssuerUrl: env.VITE_KYC_ISSUER_URL || "http://localhost:3001",
};

export function getConfig(): AppConfig {
  const stored = localStorage.getItem("stellar_did_app_config");
  if (stored) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    } catch {
      // ignore
    }
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(updates: Partial<AppConfig>) {
  const current = getConfig();
  const next = { ...current, ...updates };
  localStorage.setItem("stellar_did_app_config", JSON.stringify(next));
  return next;
}
