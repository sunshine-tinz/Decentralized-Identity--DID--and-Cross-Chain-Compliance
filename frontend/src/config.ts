export interface AppConfig {
  rpcUrl: string;
  networkPassphrase: string;
  didRegistryId: string;
  vcVerifierId: string;
  complianceEngineId: string;
  kycIssuerUrl: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  didRegistryId: "CDIDREGISTRYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  vcVerifierId: "CVCVERIFIERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  complianceEngineId: "CCOMPLIANCEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  kycIssuerUrl: "http://localhost:3000",
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
