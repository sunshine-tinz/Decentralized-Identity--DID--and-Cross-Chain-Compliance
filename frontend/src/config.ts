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
  didRegistryId: env.VITE_DID_REGISTRY_ID || "CAYT4IOLYKTQWBPYOY7ECIL2EGJMPCNYSGYDUQEQBQU475SU3SKVAXPG",
  vcVerifierId: env.VITE_VC_VERIFIER_ID || "CDDVO64VECGNVZOKCGTBAEKVB27HE5P4JGZZTMMI5FZIY4SHWF5UM662",
  complianceEngineId: env.VITE_COMPLIANCE_ENGINE_ID || "CAZAZ3Y7HYVVP2DXWQM5QPJWVCBGO7SUDMVMPZQGNRURYWCYES74PUZW",
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
