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
//!
//! # Known limitations (tracked in AUDIT.md)
//! - The DID identifier is derived from the controller address, so the identifier
//!   changes if control is moved. Key rotation / recovery is *not* implemented
//!   because a correct implementation requires an identifier independent of the
//!   controlling key. Do not add a naive "rotate" that silently changes the DID.
//! - Only a single verification method per DID is supported.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, String, Symbol};

// ── Constants ─────────────────────────────────────────────────────────────────

const DID_PREFIX: &str = "DID";

/// Minimum remaining TTL before a persistent entry is extended (~7.5 days at 5 s/ledger).
const TTL_THRESHOLD: u32 = 129_600;
/// TTL (in ledgers) that entries are extended to on write.
///
/// ~30 days at 5 s/ledger. `resolve` goes through `simulateTransaction`, which does
/// not persist a TTL bump, so a short window would archive DIDs that are actively
/// resolved but never updated (ACCEPTANCE-AUDIT.md H-5). An archived entry fails to
/// resolve until it is restored. Keep this in step with `vc_verifier`.
const TTL_EXTEND_TO: u32 = 518_400;

/// Upper bound on the anchored document hash: accepts a 32-byte SHA-256 digest
/// or a longer content identifier (e.g. IPFS CID bytes), but rejects empty input.
const MAX_HASH_LEN: u32 = 128;

// ── Data types ────────────────────────────────────────────────────────────────

/// Minimal on-chain representation of a DID document.
/// The full W3C DID document is stored off-chain; only its content hash is kept here.
#[contracttype]
#[derive(Clone)]
pub struct DIDDocument {
    /// `did:stellar:<address>` formatted identifier
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
    /// * `document_hash` - Non-empty content hash of the off-chain DID document
    ///                     (at most [`MAX_HASH_LEN`] bytes)
    ///
    /// # Panics
    /// * if `controller` has not authorised this call
    /// * if `document_hash` is empty or longer than [`MAX_HASH_LEN`]
    /// * if a DID already exists for this controller
    pub fn register(env: Env, controller: Address, document_hash: Bytes) -> String {
        controller.require_auth();
        Self::validate_hash(&document_hash);

        let key = Self::did_key(&env, &controller);
        if env.storage().persistent().has(&key) {
            panic!("DID already registered for this address");
        }

        let did_id = Self::did_id(&env, &controller);

        let doc = DIDDocument {
            id: did_id.clone(),
            document_hash,
            updated_at: env.ledger().sequence(),
            active: true,
        };

        env.storage().persistent().set(&key, &doc);
        Self::bump(&env, &key);

        env.events().publish(
            (Symbol::new(&env, "did"), Symbol::new(&env, "register")),
            (controller.clone(), did_id.clone()),
        );

        did_id
    }

    /// Update the document hash for an existing DID.
    ///
    /// # Panics
    /// * if the caller is not the controller, the DID does not exist, or it is deactivated.
    pub fn update(env: Env, controller: Address, new_document_hash: Bytes) {
        controller.require_auth();
        Self::validate_hash(&new_document_hash);

        let key = Self::did_key(&env, &controller);
        let mut doc: DIDDocument = env.storage().persistent().get(&key).expect("DID not found");

        assert!(doc.active, "DID is deactivated");

        doc.document_hash = new_document_hash;
        doc.updated_at = env.ledger().sequence();
        env.storage().persistent().set(&key, &doc);
        Self::bump(&env, &key);

        env.events().publish(
            (Symbol::new(&env, "did"), Symbol::new(&env, "update")),
            (controller, doc.updated_at),
        );
    }

    /// Deactivate a DID (irreversible in this version).
    ///
    /// # Panics
    /// * if the caller is not the controller, the DID does not exist, or it is
    ///   already deactivated.
    pub fn deactivate(env: Env, controller: Address) {
        controller.require_auth();

        let key = Self::did_key(&env, &controller);
        let mut doc: DIDDocument = env.storage().persistent().get(&key).expect("DID not found");

        assert!(doc.active, "DID already deactivated");

        doc.active = false;
        doc.updated_at = env.ledger().sequence();
        env.storage().persistent().set(&key, &doc);
        Self::bump(&env, &key);

        env.events().publish(
            (Symbol::new(&env, "did"), Symbol::new(&env, "deactivate")),
            (controller, doc.updated_at),
        );
    }

    /// Resolve a DID document by controller address.
    ///
    /// # Panics
    /// * if no DID is registered for `controller`.
    pub fn resolve(env: Env, controller: Address) -> DIDDocument {
        let key = Self::did_key(&env, &controller);
        let doc = env.storage().persistent().get(&key).expect("DID not found");
        // Keep long-lived identity records from being archived while in active use.
        Self::bump(&env, &key);
        doc
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn did_key(env: &Env, controller: &Address) -> (Symbol, Address) {
        (Symbol::new(env, DID_PREFIX), controller.clone())
    }

    /// Derive `did:stellar:<strkey-of-controller>`.
    ///
    /// `String` in the pinned SDK has no concatenation helper, so the identifier
    /// is assembled in a fixed buffer (12-byte prefix + a strkey of at most 56 bytes).
    fn did_id(env: &Env, controller: &Address) -> String {
        const PREFIX: &[u8] = b"did:stellar:";
        const MAX_ID_LEN: usize = 128;

        let addr = controller.to_string();
        let addr_len = addr.len() as usize;
        let total = PREFIX.len() + addr_len;
        assert!(total <= MAX_ID_LEN, "derived DID id too long");

        let mut buf = [0u8; MAX_ID_LEN];
        buf[..PREFIX.len()].copy_from_slice(PREFIX);
        addr.copy_into_slice(&mut buf[PREFIX.len()..total]);

        String::from_bytes(env, &buf[..total])
    }

    fn validate_hash(hash: &Bytes) {
        assert!(!hash.is_empty(), "document_hash must not be empty");
        assert!(hash.len() <= MAX_HASH_LEN, "document_hash too long");
    }

    fn bump(env: &Env, key: &(Symbol, Address)) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn setup(env: &Env) -> (DIDRegistryClient<'_>, Address) {
        env.mock_all_auths();
        let contract_id = env.register_contract(None, DIDRegistry);
        let client = DIDRegistryClient::new(env, &contract_id);
        let controller = Address::generate(env);
        (client, controller)
    }

    fn hash(env: &Env) -> Bytes {
        Bytes::from_slice(env, &[7u8; 32])
    }

    #[test]
    fn test_register_and_resolve() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        let h = hash(&env);

        let did = client.register(&controller, &h);
        let doc = client.resolve(&controller);

        assert!(doc.active);
        assert_eq!(doc.document_hash, h);
        assert_eq!(doc.id, did);
        assert_eq!(doc.updated_at, env.ledger().sequence());
    }

    #[test]
    fn test_did_id_is_derived_from_controller() {
        let env = Env::default();
        let (client, controller_a) = setup(&env);
        let controller_b = Address::generate(&env);

        let did_a = client.register(&controller_a, &hash(&env));
        let did_b = client.register(&controller_b, &hash(&env));

        // Regression for AUDIT.md H-1: both DIDs used to be "did:stellar:placeholder".
        assert_ne!(did_a, did_b, "distinct controllers must get distinct DIDs");
    }

    #[test]
    fn test_resolved_did_contains_controller_strkey() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        let did = client.register(&controller, &hash(&env));

        let expected = controller.to_string();
        assert_eq!(did.len(), 12 + expected.len());
        assert_ne!(did, String::from_str(&env, "did:stellar:placeholder"));
    }

    #[test]
    #[should_panic(expected = "DID already registered")]
    fn test_duplicate_register_fails() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        let h = hash(&env);

        client.register(&controller, &h);
        client.register(&controller, &h);
    }

    #[test]
    #[should_panic(expected = "document_hash must not be empty")]
    fn test_empty_hash_rejected() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        client.register(&controller, &Bytes::new(&env));
    }

    #[test]
    #[should_panic(expected = "document_hash too long")]
    fn test_oversized_hash_rejected() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        client.register(&controller, &Bytes::from_slice(&env, &[0u8; 129]));
    }

    #[test]
    fn test_update_changes_hash() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        client.register(&controller, &hash(&env));

        let new_hash = Bytes::from_slice(&env, &[9u8; 32]);
        client.update(&controller, &new_hash);

        assert_eq!(client.resolve(&controller).document_hash, new_hash);
    }

    #[test]
    fn test_deactivate_marks_inactive() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        client.register(&controller, &hash(&env));

        client.deactivate(&controller);
        assert!(!client.resolve(&controller).active);

        // Re-registration must not revive a deactivated DID.
        let second = client.try_register(&controller, &hash(&env));
        assert!(second.is_err(), "deactivated DID must not be re-registered");
    }

    #[test]
    #[should_panic(expected = "DID is deactivated")]
    fn test_update_after_deactivate_fails() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        client.register(&controller, &hash(&env));
        client.deactivate(&controller);
        client.update(&controller, &hash(&env));
    }

    #[test]
    #[should_panic(expected = "DID already deactivated")]
    fn test_double_deactivate_fails() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        client.register(&controller, &hash(&env));
        client.deactivate(&controller);
        client.deactivate(&controller);
    }

    /// Regression for ACCEPTANCE-AUDIT.md H-5: a DID that is registered and then
    /// only read must not archive after the old ~24 h window.
    #[test]
    fn test_register_extends_storage_ttl() {
        use soroban_sdk::testutils::storage::Persistent;

        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, DIDRegistry);
        let client = DIDRegistryClient::new(&env, &contract_id);
        let controller = Address::generate(&env);
        client.register(&controller, &hash(&env));

        let key = (Symbol::new(&env, DID_PREFIX), controller);
        let remaining = env.as_contract(&contract_id, || env.storage().persistent().get_ttl(&key));
        assert!(
            remaining > 17_280,
            "DID TTL must outlive the old 24h window, got {remaining}"
        );
    }
}
