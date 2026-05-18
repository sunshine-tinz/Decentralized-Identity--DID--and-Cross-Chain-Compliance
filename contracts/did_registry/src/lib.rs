//! DID Registry Contract
//!
//! Stores and manages W3C-compliant Decentralized Identifiers (DIDs) on Stellar.
//!
//! # Architecture
//! Each DID document is anchored on-chain as a hash; the full document lives
//! off-chain (IPFS / anchor server) to keep storage costs low.
//!
//! # Storage keys
//! - `DID:<address>`  → DIDDocument (persistent)
//! - `CTRL:<did>`     → controller address (persistent)
//!
//! # TODO for contributors
//! - [ ] Add DID rotation / key recovery logic
//! - [ ] Emit events on register / update / deactivate
//! - [ ] Support multiple verification methods per DID
//! - [ ] Add service endpoint registry

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, String, Symbol};

// ── Storage key prefixes ──────────────────────────────────────────────────────

const DID_PREFIX: &str = "DID";

// ── Data types ────────────────────────────────────────────────────────────────

/// Minimal on-chain representation of a DID document.
/// The full W3C DID document is stored off-chain; only its content hash is kept here.
#[contracttype]
#[derive(Clone)]
pub struct DIDDocument {
    /// did:stellar:<address> formatted identifier
    pub id: String,
    /// SHA-256 hash of the full off-chain DID document (IPFS CID or similar)
    pub document_hash: Bytes,
    /// Ledger sequence at which this DID was last updated
    pub updated_at: u32,
    /// Whether this DID has been deactivated
    pub active: bool,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct DIDRegistry;

#[contractimpl]
impl DIDRegistry {
    /// Register a new DID anchored to `controller`.
    ///
    /// # Arguments
    /// * `controller`    - Stellar address that controls this DID
    /// * `document_hash` - Content hash of the off-chain DID document
    ///
    /// # Errors
    /// Panics if a DID already exists for this controller.
    pub fn register(env: Env, controller: Address, document_hash: Bytes) -> String {
        controller.require_auth();

        let key = Self::did_key(&env, &controller);
        if env.storage().persistent().has(&key) {
            panic!("DID already registered for this address");
        }

        // TODO: derive did:stellar:<network>:<address> properly
        let did_id = String::from_str(&env, "did:stellar:placeholder");

        let doc = DIDDocument {
            id: did_id.clone(),
            document_hash,
            updated_at: env.ledger().sequence(),
            active: true,
        };

        env.storage().persistent().set(&key, &doc);

        // TODO: emit a Register event

        did_id
    }

    /// Update the document hash for an existing DID.
    pub fn update(env: Env, controller: Address, new_document_hash: Bytes) {
        controller.require_auth();

        let key = Self::did_key(&env, &controller);
        let mut doc: DIDDocument = env
            .storage()
            .persistent()
            .get(&key)
            .expect("DID not found");

        assert!(doc.active, "DID is deactivated");

        doc.document_hash = new_document_hash;
        doc.updated_at = env.ledger().sequence();
        env.storage().persistent().set(&key, &doc);

        // TODO: emit an Update event
    }

    /// Deactivate a DID (irreversible in this version).
    pub fn deactivate(env: Env, controller: Address) {
        controller.require_auth();

        let key = Self::did_key(&env, &controller);
        let mut doc: DIDDocument = env
            .storage()
            .persistent()
            .get(&key)
            .expect("DID not found");

        doc.active = false;
        doc.updated_at = env.ledger().sequence();
        env.storage().persistent().set(&key, &doc);

        // TODO: emit a Deactivate event
    }

    /// Resolve a DID document by controller address.
    pub fn resolve(env: Env, controller: Address) -> DIDDocument {
        let key = Self::did_key(&env, &controller);
        env.storage()
            .persistent()
            .get(&key)
            .expect("DID not found")
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn did_key(env: &Env, controller: &Address) -> (Symbol, Address) {
        (Symbol::new(env, DID_PREFIX), controller.clone())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_register_and_resolve() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, DIDRegistry);
        let client = DIDRegistryClient::new(&env, &contract_id);

        let controller = Address::generate(&env);
        let hash = Bytes::from_slice(&env, &[0u8; 32]);

        client.register(&controller, &hash);
        let doc = client.resolve(&controller);

        assert!(doc.active);
        assert_eq!(doc.document_hash, hash);
    }

    #[test]
    #[should_panic(expected = "DID already registered")]
    fn test_duplicate_register_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, DIDRegistry);
        let client = DIDRegistryClient::new(&env, &contract_id);

        let controller = Address::generate(&env);
        let hash = Bytes::from_slice(&env, &[0u8; 32]);

        client.register(&controller, &hash);
        client.register(&controller, &hash); // should panic
    }
}
