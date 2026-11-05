/**
 * ComplianceClient — interact with the Compliance Engine Soroban contract.
 *
 * Compliance is evaluated live on-chain against the VC Verifier's credentials;
 * there is no stored status a caller could assert.
 */

import { Address, xdr } from "@stellar/stellar-sdk";
import { Attestation, CompliancePolicy, StellarDIDConfig } from "../types";
import {
  buildPreparedTransaction,
  simulateRead,
  symbolArg,
} from "../lib/soroban";

export class ComplianceClient {
  private config: StellarDIDConfig;

  constructor(config: StellarDIDConfig) {
    this.config = config;
  }

  /**
   * Admin sets the verifier contract address.
   */
  async setVerifier(admin: string, verifierAddress: string): Promise<string> {
    return buildPreparedTransaction(
      this.config,
      this.config.complianceEngineId,
      "set_verifier",
      [Address.fromString(admin).toScVal(), Address.fromString(verifierAddress).toScVal()]
    );
  }

  /**
   * Read the configured verifier contract address.
   */
  async getVerifier(): Promise<string | null> {
    const raw = (await simulateRead(
      this.config,
      this.config.complianceEngineId,
      "get_verifier",
      []
    )) as string | null | undefined;
    return raw ?? null;
  }

  /**
   * Admin sets or updates a compliance policy.
   */
  async setPolicy(
    admin: string,
    name: string,
    requiredAttributes: string[]
  ): Promise<string> {
    return buildPreparedTransaction(
      this.config,
      this.config.complianceEngineId,
      "set_policy",
      [
        Address.fromString(admin).toScVal(),
        symbolArg(name),
        xdr.ScVal.scvVec(requiredAttributes.map((attr) => symbolArg(attr))),
      ]
    );
  }

  /**
   * Check whether `address` is compliant under `policy`.
   *
   * Returns false for unknown policies, an unset verifier, or any missing,
   * expired, revoked, or de-registered-issuer credential.
   */
  async isCompliant(address: string, policy: string): Promise<boolean> {
    const compliant = await simulateRead(
      this.config,
      this.config.complianceEngineId,
      "is_compliant",
      [Address.fromString(address).toScVal(), symbolArg(policy)]
    );
    return Boolean(compliant);
  }

  /**
   * Read a policy definition.
   */
  async getPolicy(policy: string): Promise<CompliancePolicy> {
    const raw = (await simulateRead(
      this.config,
      this.config.complianceEngineId,
      "get_policy",
      [symbolArg(policy)]
    )) as { name: string; required_attributes: string[]; version: number };

    return {
      name: raw.name,
      requiredAttributes: raw.required_attributes ?? [],
      version: Number(raw.version),
    };
  }

  /**
   * Produce a read-only compliance attestation snapshot.
   *
   * The payload is unsigned. Do not treat it as proof on its own: a relayer must
   * sign it and the destination must verify that signature.
   */
  async exportAttestation(address: string, policy: string): Promise<Attestation> {
    const raw = (await simulateRead(
      this.config,
      this.config.complianceEngineId,
      "export_attestation",
      [Address.fromString(address).toScVal(), symbolArg(policy)]
    )) as {
      subject: string;
      policy: string;
      compliant: boolean;
      evaluated_at: number;
      policy_version: number;
      verifier: string;
    };

    return {
      subject: raw.subject,
      policy: raw.policy,
      compliant: Boolean(raw.compliant),
      evaluatedAt: Number(raw.evaluated_at),
      policyVersion: Number(raw.policy_version),
      verifier: raw.verifier,
    };
  }
}
