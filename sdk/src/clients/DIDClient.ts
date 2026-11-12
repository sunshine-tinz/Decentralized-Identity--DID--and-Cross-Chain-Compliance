/**
 * DIDClient — interact with the DID Registry Soroban contract.
 */

import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { DIDDocument, ServiceEndpoint, StellarDIDConfig } from "../types";
import {
  buildPreparedTransaction,
  bytesArg,
  simulateRead,
  toHex,
} from "../lib/soroban";

interface RawServiceEndpoint {
  id: string;
  service_type: string;
  endpoint: string;
}

interface RawDIDDocument {
  id: string;
  controller?: string;
  recovery?: string | null;
  document_hash: unknown;
  services?: RawServiceEndpoint[];
  version?: number;
  updated_at: number;
  active: boolean;
}

function mapRawDid(raw: RawDIDDocument): DIDDocument {
  return {
    id: raw.id,
    controller: raw.controller,
    recovery: raw.recovery ?? null,
    documentHash: toHex(raw.document_hash),
    services: (raw.services ?? []).map((s) => ({
      id: s.id,
      serviceType: s.service_type,
      endpoint: s.endpoint,
    })),
    version: raw.version !== undefined ? Number(raw.version) : undefined,
    updatedAt: Number(raw.updated_at),
    active: Boolean(raw.active),
  };
}

export class DIDClient {
  private config: StellarDIDConfig;

  constructor(config: StellarDIDConfig) {
    this.config = config;
  }

  async register(controllerAddress: string, documentHash: string): Promise<string> {
    return buildPreparedTransaction(this.config, this.config.didRegistryId, "register", [
      Address.fromString(controllerAddress).toScVal(),
      bytesArg(documentHash, "documentHash"),
    ]);
  }

  async update(controllerAddress: string, newDocumentHash: string): Promise<string> {
    return buildPreparedTransaction(this.config, this.config.didRegistryId, "update", [
      Address.fromString(controllerAddress).toScVal(),
      bytesArg(newDocumentHash, "newDocumentHash"),
    ]);
  }

  async updateById(didId: string, newDocumentHash: string): Promise<string> {
    return buildPreparedTransaction(this.config, this.config.didRegistryId, "update_by_id", [
      nativeToScVal(didId, { type: "string" }),
      bytesArg(newDocumentHash, "newDocumentHash"),
    ]);
  }

  async rotateController(didId: string, newControllerAddress: string): Promise<string> {
    return buildPreparedTransaction(
      this.config,
      this.config.didRegistryId,
      "rotate_controller",
      [
        nativeToScVal(didId, { type: "string" }),
        Address.fromString(newControllerAddress).toScVal(),
      ]
    );
  }

  async setRecovery(didId: string, recoveryAddress: string | null): Promise<string> {
    const recoveryVal = recoveryAddress
      ? Address.fromString(recoveryAddress).toScVal()
      : xdr.ScVal.scvVoid();
    return buildPreparedTransaction(this.config, this.config.didRegistryId, "set_recovery", [
      nativeToScVal(didId, { type: "string" }),
      recoveryVal,
    ]);
  }

  async recover(didId: string, newControllerAddress: string): Promise<string> {
    return buildPreparedTransaction(this.config, this.config.didRegistryId, "recover", [
      nativeToScVal(didId, { type: "string" }),
      Address.fromString(newControllerAddress).toScVal(),
    ]);
  }

  async setServices(didId: string, services: ServiceEndpoint[]): Promise<string> {
    const servicesScVal = xdr.ScVal.scvVec(
      services.map((svc) =>
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: nativeToScVal("endpoint", { type: "symbol" }),
            val: nativeToScVal(svc.endpoint, { type: "string" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("id", { type: "symbol" }),
            val: nativeToScVal(svc.id, { type: "string" }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal("service_type", { type: "symbol" }),
            val: nativeToScVal(svc.serviceType, { type: "string" }),
          }),
        ])
      )
    );
    return buildPreparedTransaction(this.config, this.config.didRegistryId, "set_services", [
      nativeToScVal(didId, { type: "string" }),
      servicesScVal,
    ]);
  }

  async deactivate(controllerAddress: string): Promise<string> {
    return buildPreparedTransaction(
      this.config,
      this.config.didRegistryId,
      "deactivate",
      [Address.fromString(controllerAddress).toScVal()]
    );
  }

  async resolve(controllerAddress: string): Promise<DIDDocument> {
    const raw = (await simulateRead(this.config, this.config.didRegistryId, "resolve", [
      Address.fromString(controllerAddress).toScVal(),
    ])) as RawDIDDocument;

    return mapRawDid(raw);
  }

  async resolveById(didId: string): Promise<DIDDocument> {
    const raw = (await simulateRead(this.config, this.config.didRegistryId, "resolve_by_id", [
      nativeToScVal(didId, { type: "string" }),
    ])) as RawDIDDocument;

    return mapRawDid(raw);
  }
}
