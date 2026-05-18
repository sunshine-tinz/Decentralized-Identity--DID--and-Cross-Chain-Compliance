//! Verifiable Credential (VC) Verifier Contract
//!
//! Verifies W3C Verifiable Credentials issued by trusted issuers and records
//! credential status on-chain using BLS12-381 ring signatures for selective
//! disclosure (inspired by the jamesbachini.com Stellar KYC reference).
//!
//! # Flow
//! 1. Admin registers trusted issuers (their BLS public keys).
//! 2. Issuer creates an attribute ring on-chain (e.g. "kyc_passed", "accredited").
//! 3. User proves membership in a ring via a ring signature — no identity revealed.
//! 4. Contract verifies the ring signature and records a proof event.
//!
//! # TODO for contributors
//! - [ ] Implement full BLS12-381 ring signature verification (currently stubbed)
//! - [ ] Add credential revocation list (CRL) support
//! - [ ] Support JWT-VC and JSON-LD VC formats
//! - [ ] Add expiry / TTL to issued credentials
//! - [ ] Integrate with DID Registry contract for issuer DID resolution

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, Symbol, Vec,
};

// ── Data types ────────────────────────────────────────────────────────────────

/// A ring of BLS public keys for a single attribute.
/// Any member can prove membership without revealing which key they hold.
#[contracttype]
#[derive(Clone)]
pub struct AttributeRing {
    /// Human-readable attribute name, e.g. "kyc_passed"
    pub attribute: Symbol,
    /// BLS12-381 public keys (96 bytes each) of ring members
    pub public_keys: Vec<BytesN<96>>,
}

/// Compact ring signature (challenge + one response per ring member).
#[contracttype]
#[derive(Clone)]
pub struct RingSignature {
    /// Initial challenge scalar (32 bytes)
    pub challenge: BytesN<32>,
    /// Response values — one per ring member (32 bytes each)
    pub responses: Vec<BytesN<32>>,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

const ADMIN_KEY: &str = "ADMIN";
const ISSUERS_KEY: &str = "ISSUERS";
const RING_PREFIX: &str = "RING";
const PROOF_COUNT_KEY: &str = "PROOFS";

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct VCVerifier;

#[contractimpl]
impl VCVerifier {
    /// One-time initialisation — sets the admin address.
    pub fn initialize(env: Env, admin: Address) {
        let key = Symbol::new(&env, ADMIN_KEY);
        if env.storage().instance().has(&key) {
            panic!("already initialized");
        }
        env.storage().instance().set(&key, &admin);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, ISSUERS_KEY), &Vec::<BytesN<96>>::new(&env));
        env.storage()
            .instance()
            .set(&Symbol::new(&env, PROOF_COUNT_KEY), &0u64);
    }

    /// Admin registers a trusted issuer by their BLS public key.
    pub fn add_issuer(env: Env, issuer_pubkey: BytesN<96>) {
        Self::require_admin(&env);

        let key = Symbol::new(&env, ISSUERS_KEY);
        let mut issuers: Vec<BytesN<96>> = env.storage().instance().get(&key).unwrap();
        if !issuers.contains(&issuer_pubkey) {
            issuers.push_back(issuer_pubkey);
            env.storage().instance().set(&key, &issuers);
        }
    }

    /// Issuer creates or replaces the ring for a given attribute.
    pub fn set_attribute_ring(env: Env, issuer: Address, attribute: Symbol, ring: Vec<BytesN<96>>) {
        issuer.require_auth();
        // TODO: verify `issuer` is in the registered issuers list

        let ring_key = (Symbol::new(&env, RING_PREFIX), attribute.clone());
        let attr_ring = AttributeRing {
            attribute,
            public_keys: ring,
        };
        env.storage().persistent().set(&ring_key, &attr_ring);
    }

    /// Verify a ring signature for `attribute` and record the proof.
    ///
    /// Returns `true` on success. The caller's identity is never stored.
    ///
    /// # TODO
    /// Replace the stub below with real BLS12-381 ring signature verification
    /// using `env.crypto().bls12_381_*` host functions.
    pub fn verify_credential(
        env: Env,
        attribute: Symbol,
        message: Bytes,
        signature: RingSignature,
    ) -> bool {
        let ring_key = (Symbol::new(&env, RING_PREFIX), attribute.clone());
        let attr_ring: AttributeRing = env
            .storage()
            .persistent()
            .get(&ring_key)
            .expect("attribute ring not found");

        // ── STUB: replace with real ring-sig verification ─────────────────────
        // Real implementation should:
        //   1. Reconstruct the challenge chain using BLS12-381 group operations
        //   2. Verify the chain closes: final_challenge == signature.challenge
        //   3. Return false (not panic) on invalid signatures
        let valid = Self::verify_ring_stub(&env, &attr_ring, &message, &signature);
        // ─────────────────────────────────────────────────────────────────────

        if valid {
            let count_key = Symbol::new(&env, PROOF_COUNT_KEY);
            let count: u64 = env.storage().instance().get(&count_key).unwrap_or(0);
            env.storage().instance().set(&count_key, &(count + 1));
            // TODO: emit a CredentialVerified event
        }

        valid
    }

    /// Returns the total number of successful proofs (privacy-safe aggregate).
    pub fn proof_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, PROOF_COUNT_KEY))
            .unwrap_or(0)
    }

    /// Returns the ring for a given attribute (for client-side signature generation).
    pub fn get_ring(env: Env, attribute: Symbol) -> AttributeRing {
        let ring_key = (Symbol::new(&env, RING_PREFIX), attribute);
        env.storage()
            .persistent()
            .get(&ring_key)
            .expect("attribute ring not found")
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(env, ADMIN_KEY))
            .expect("not initialized");
        admin.require_auth();
    }

    /// Stub verifier — always returns true for non-empty signatures.
    /// Replace with real BLS12-381 ring signature math.
    fn verify_ring_stub(_env: &Env, ring: &AttributeRing, _msg: &Bytes, sig: &RingSignature) -> bool {
        !ring.public_keys.is_empty() && sig.responses.len() == ring.public_keys.len()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env};

    fn dummy_pubkey(env: &Env, seed: u8) -> BytesN<96> {
        BytesN::from_array(env, &[seed; 96])
    }

    fn dummy_sig(env: &Env, ring_len: u32) -> RingSignature {
        let mut responses = Vec::new(env);
        for _ in 0..ring_len {
            responses.push_back(BytesN::from_array(env, &[2u8; 32]));
        }
        RingSignature {
            challenge: BytesN::from_array(env, &[1u8; 32]),
            responses,
        }
    }

    #[test]
    fn test_verify_credential_stub() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VCVerifier);
        let client = VCVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let issuer = Address::generate(&env);
        let attr = Symbol::new(&env, "kyc_passed");
        let ring = vec![&env, dummy_pubkey(&env, 1), dummy_pubkey(&env, 2)];
        client.set_attribute_ring(&issuer, &attr, &ring);

        let msg = Bytes::from_slice(&env, b"challenge-abc");
        let sig = dummy_sig(&env, 2);

        let result = client.verify_credential(&attr, &msg, &sig);
        assert!(result);
        assert_eq!(client.proof_count(), 1);
    }
}
