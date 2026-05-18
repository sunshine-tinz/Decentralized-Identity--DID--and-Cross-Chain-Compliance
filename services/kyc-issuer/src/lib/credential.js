/**
 * Credential builder
 *
 * Constructs BLS ring credentials for each approved attribute.
 *
 * TODO for contributors:
 *  - Replace stub key generation with real BLS12-381 keypair generation
 *  - Generate decoy keys deterministically from a seed for reproducibility
 *  - Sign the credential envelope with the issuer's Stellar keypair
 *  - Add W3C VC Data Model wrapper around the credential
 */

"use strict";

const RING_SIZE = 5; // 1 real user + 4 decoys

/**
 * Build a credential object for an approved KYC request.
 *
 * @param {object} kycReq - The approved KYC request
 * @param {string} issuerPrivkey - Issuer's BLS private key (hex)
 * @returns {object} Credential with per-attribute keys and rings
 */
async function buildCredential(kycReq, issuerPrivkey) {
  const attributeKeys = {};
  const attributeRings = {};

  for (const attribute of kycReq.attributes) {
    // TODO: replace with real BLS12-381 key generation
    const userKeypair = generateStubKeypair(attribute);
    const ring = buildRing(userKeypair.publicKey);

    attributeKeys[attribute] = userKeypair.privateKey;
    attributeRings[attribute] = ring;
  }

  return {
    issuerPubkey: kycReq.issuerPubkey,
    userId: kycReq.userId,
    attributeKeys,   // user stores these locally; never persisted server-side
    attributeRings,
    issuedAt: Date.now(),
  };
}

/**
 * Stub: generate a deterministic fake BLS keypair.
 * Replace with `noble-bls12-381` or equivalent.
 */
function generateStubKeypair(seed) {
  const privKey = Buffer.alloc(32).fill(seed.charCodeAt(0)).toString("hex");
  const pubKey = Buffer.alloc(96).fill(seed.charCodeAt(0) + 1).toString("hex");
  return { privateKey: privKey, publicKey: pubKey };
}

/**
 * Build a ring of RING_SIZE members: 1 real user + (RING_SIZE-1) decoys.
 */
function buildRing(userPubkey) {
  const ring = [userPubkey];
  for (let i = 1; i < RING_SIZE; i++) {
    // TODO: generate cryptographically random decoy keys
    ring.push(Buffer.alloc(96).fill(i).toString("hex"));
  }
  return ring;
}

module.exports = { buildCredential };
