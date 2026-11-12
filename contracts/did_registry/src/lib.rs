//! DID Registry Contract
//!
//! Stores and manages Decentralized Identifiers (DIDs) on Stellar with
//! persistent identifier continuity across controller key rotation and
//! guardian-authorized recovery.
//!
//! # Storage keys
//! - `("DID", controller: Address)` -> `did_id: String` (persistent lookup)
//! - `("DID_ID", did_id: String)` -> `DIDDocument` (persistent canonical record)

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, String, Symbol, Vec};

// ── Constants ─────────────────────────────────────────────────────────────────

const DID_CTRL_PREFIX: &str = "DID";
const DID_ID_PREFIX: &str = "DID_ID";

/// Minimum remaining TTL before a persistent entry is extended (~7.5 days at 5 s/ledger).
const TTL_THRESHOLD: u32 = 129_600;
/// TTL (in ledgers) that entries are extended to on write (~30 days at 5 s/ledger).
const TTL_EXTEND_TO: u32 = 518_400;

const MAX_HASH_LEN: u32 = 128;
const MAX_SERVICES: u32 = 8;

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServiceEndpoint {
    pub id: String,
    pub service_type: String,
    pub endpoint: String,
}

/// On-chain DID anchor supporting key rotation, recovery, and service endpoints.
#[contracttype]
#[derive(Clone)]
pub struct DIDDocument {
    /// Immutable `did:stellar:<initial-anchor>` identifier preserved across rotations
    pub id: String,
    /// Current controlling Stellar address
    pub controller: Address,
    /// Optional recovery guardian address authorized to rotate a lost controller
    pub recovery: Option<Address>,
    /// Content hash (e.g. SHA-256) of the full off-chain W3C DID document
    pub document_hash: Bytes,
    /// Optional anchored service endpoints
    pub services: Vec<ServiceEndpoint>,
    /// Monotonic document version counter
    pub version: u32,
    /// Ledger sequence at which this DID was last updated
    pub updated_at: u32,
    /// Whether this DID is active (false after irreversible deactivation)
    pub active: bool,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct DIDRegistry;

#[contractimpl]
impl DIDRegistry {
    /// Register a new DID anchored to `controller`.
    pub fn register(env: Env, controller: Address, document_hash: Bytes) -> String {
        controller.require_auth();
        Self::validate_hash(&document_hash);

        let ctrl_key = Self::ctrl_key(&env, &controller);
        if env.storage().persistent().has(&ctrl_key) {
            panic!("DID already registered for this address");
        }

        let did_id = Self::did_id(&env, &controller);
        let id_key = Self::id_key(&env, &did_id);
        if env.storage().persistent().has(&id_key) {
            panic!("DID identifier already exists");
        }

        let doc = DIDDocument {
            id: did_id.clone(),
            controller: controller.clone(),
            recovery: None,
            document_hash,
            services: Vec::new(&env),
            version: 1,
            updated_at: env.ledger().sequence(),
            active: true,
        };

        env.storage().persistent().set(&id_key, &doc);
        Self::bump_id(&env, &id_key);

        env.storage().persistent().set(&ctrl_key, &did_id);
        Self::bump_ctrl(&env, &ctrl_key);

        env.events().publish(
            (Symbol::new(&env, "did"), Symbol::new(&env, "register")),
            (controller, did_id.clone()),
        );

        did_id
    }

    /// Update the document hash using the current controller address.
    pub fn update(env: Env, controller: Address, new_document_hash: Bytes) {
        controller.require_auth();
        Self::validate_hash(&new_document_hash);

        let did_id = Self::lookup_id_for_controller(&env, &controller);
        Self::update_inner(&env, &did_id, &controller, new_document_hash);
    }

    /// Update the document hash by immutable DID identifier (works across rotations).
    pub fn update_by_id(env: Env, did_id: String, new_document_hash: Bytes) {
        Self::validate_hash(&new_document_hash);
        let doc = Self::load_doc(&env, &did_id);
        doc.controller.require_auth();
        Self::update_inner(&env, &did_id, &doc.controller, new_document_hash);
    }

    /// Set service endpoints on an active DID document.
    pub fn set_services(env: Env, did_id: String, services: Vec<ServiceEndpoint>) {
        assert!(services.len() <= MAX_SERVICES, "too many service endpoints");
        for i in 0..services.len() {
            let svc = services.get(i).unwrap();
            assert!(!svc.id.is_empty(), "service id must not be empty");
            assert!(
                !svc.service_type.is_empty(),
                "service type must not be empty"
            );
            assert!(
                !svc.endpoint.is_empty(),
                "service endpoint must not be empty"
            );
        }

        let id_key = Self::id_key(&env, &did_id);
        let mut doc = Self::load_doc(&env, &did_id);
        assert!(doc.active, "DID is deactivated");
        doc.controller.require_auth();

        doc.services = services;
        doc.version += 1;
        doc.updated_at = env.ledger().sequence();

        env.storage().persistent().set(&id_key, &doc);
        Self::bump_id(&env, &id_key);

        env.events().publish(
            (
                Symbol::new(&env, "did"),
                Symbol::new(&env, "services_updated"),
            ),
            (did_id, doc.version),
        );
    }

    /// Rotate the controlling address while preserving the immutable DID identifier.
    ///
    /// Both the current controller and `new_controller` must authorize the rotation.
    pub fn rotate_controller(env: Env, did_id: String, new_controller: Address) {
        let id_key = Self::id_key(&env, &did_id);
        let mut doc = Self::load_doc(&env, &did_id);
        assert!(doc.active, "DID is deactivated");
        assert!(
            new_controller != doc.controller,
            "new controller must differ from current controller"
        );

        doc.controller.require_auth();
        new_controller.require_auth();

        let new_ctrl_key = Self::ctrl_key(&env, &new_controller);
        assert!(
            !env.storage().persistent().has(&new_ctrl_key),
            "new controller already controls a DID"
        );

        let old_ctrl = doc.controller.clone();
        let old_ctrl_key = Self::ctrl_key(&env, &old_ctrl);
        env.storage().persistent().remove(&old_ctrl_key);

        doc.controller = new_controller.clone();
        doc.version += 1;
        doc.updated_at = env.ledger().sequence();

        env.storage().persistent().set(&id_key, &doc);
        Self::bump_id(&env, &id_key);

        env.storage().persistent().set(&new_ctrl_key, &did_id);
        Self::bump_ctrl(&env, &new_ctrl_key);

        env.events().publish(
            (Symbol::new(&env, "did"), Symbol::new(&env, "rotate")),
            (did_id, old_ctrl, new_controller),
        );
    }

    /// Configure or clear the recovery guardian address for an active DID.
    pub fn set_recovery(env: Env, did_id: String, recovery: Option<Address>) {
        let id_key = Self::id_key(&env, &did_id);
        let mut doc = Self::load_doc(&env, &did_id);
        assert!(doc.active, "DID is deactivated");
        doc.controller.require_auth();

        if let Some(ref addr) = recovery {
            assert!(
                *addr != doc.controller,
                "recovery must differ from controller"
            );
        }

        doc.recovery = recovery.clone();
        doc.version += 1;
        doc.updated_at = env.ledger().sequence();

        env.storage().persistent().set(&id_key, &doc);
        Self::bump_id(&env, &id_key);

        env.events().publish(
            (Symbol::new(&env, "did"), Symbol::new(&env, "recovery_set")),
            (did_id, recovery),
        );
    }

    /// Recover a DID to `new_controller` using the configured recovery guardian.
    ///
    /// Preserves the DID identifier even if the previous controller key was lost.
    pub fn recover(env: Env, did_id: String, new_controller: Address) {
        let id_key = Self::id_key(&env, &did_id);
        let mut doc = Self::load_doc(&env, &did_id);
        assert!(doc.active, "DID is deactivated");

        let recovery = doc
            .recovery
            .clone()
            .expect("no recovery address configured");
        assert!(
            new_controller != doc.controller,
            "new controller must differ from current controller"
        );

        recovery.require_auth();
        new_controller.require_auth();

        let new_ctrl_key = Self::ctrl_key(&env, &new_controller);
        assert!(
            !env.storage().persistent().has(&new_ctrl_key),
            "new controller already controls a DID"
        );

        let old_ctrl = doc.controller.clone();
        let old_ctrl_key = Self::ctrl_key(&env, &old_ctrl);
        env.storage().persistent().remove(&old_ctrl_key);

        doc.controller = new_controller.clone();
        doc.version += 1;
        doc.updated_at = env.ledger().sequence();

        env.storage().persistent().set(&id_key, &doc);
        Self::bump_id(&env, &id_key);

        env.storage().persistent().set(&new_ctrl_key, &did_id);
        Self::bump_ctrl(&env, &new_ctrl_key);

        env.events().publish(
            (Symbol::new(&env, "did"), Symbol::new(&env, "recover")),
            (did_id, recovery, new_controller),
        );
    }

    /// Deactivate a DID by current controller address (irreversible).
    pub fn deactivate(env: Env, controller: Address) {
        controller.require_auth();
        let did_id = Self::lookup_id_for_controller(&env, &controller);
        Self::deactivate_inner(&env, &did_id);
    }

    /// Deactivate a DID by immutable DID identifier (irreversible).
    pub fn deactivate_by_id(env: Env, did_id: String) {
        let doc = Self::load_doc(&env, &did_id);
        doc.controller.require_auth();
        Self::deactivate_inner(&env, &did_id);
    }

    /// Resolve a DID document by current controller address.
    pub fn resolve(env: Env, controller: Address) -> DIDDocument {
        let ctrl_key = Self::ctrl_key(&env, &controller);
        let did_id: String = env
            .storage()
            .persistent()
            .get(&ctrl_key)
            .expect("DID not found");
        Self::bump_ctrl(&env, &ctrl_key);
        Self::resolve_by_id(env, did_id)
    }

    /// Resolve a DID document by its immutable `did:stellar:...` identifier.
    pub fn resolve_by_id(env: Env, did_id: String) -> DIDDocument {
        let id_key = Self::id_key(&env, &did_id);
        let doc = env
            .storage()
            .persistent()
            .get(&id_key)
            .expect("DID not found");
        Self::bump_id(&env, &id_key);
        doc
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn update_inner(env: &Env, did_id: &String, actor: &Address, new_document_hash: Bytes) {
        let id_key = Self::id_key(env, did_id);
        let mut doc = Self::load_doc(env, did_id);
        assert!(doc.active, "DID is deactivated");

        doc.document_hash = new_document_hash;
        doc.version += 1;
        doc.updated_at = env.ledger().sequence();
        env.storage().persistent().set(&id_key, &doc);
        Self::bump_id(env, &id_key);

        env.events().publish(
            (Symbol::new(env, "did"), Symbol::new(env, "update")),
            (actor.clone(), doc.updated_at),
        );
    }

    fn deactivate_inner(env: &Env, did_id: &String) {
        let id_key = Self::id_key(env, did_id);
        let mut doc = Self::load_doc(env, did_id);
        assert!(doc.active, "DID already deactivated");

        let controller = doc.controller.clone();
        doc.active = false;
        doc.recovery = None;
        doc.version += 1;
        doc.updated_at = env.ledger().sequence();
        env.storage().persistent().set(&id_key, &doc);
        Self::bump_id(env, &id_key);

        env.events().publish(
            (Symbol::new(env, "did"), Symbol::new(env, "deactivate")),
            (controller, doc.updated_at),
        );
    }

    fn ctrl_key(env: &Env, controller: &Address) -> (Symbol, Address) {
        (Symbol::new(env, DID_CTRL_PREFIX), controller.clone())
    }

    fn id_key(env: &Env, did_id: &String) -> (Symbol, String) {
        (Symbol::new(env, DID_ID_PREFIX), did_id.clone())
    }

    fn lookup_id_for_controller(env: &Env, controller: &Address) -> String {
        let ctrl_key = Self::ctrl_key(env, controller);
        env.storage()
            .persistent()
            .get(&ctrl_key)
            .expect("DID not found")
    }

    fn load_doc(env: &Env, did_id: &String) -> DIDDocument {
        let id_key = Self::id_key(env, did_id);
        env.storage()
            .persistent()
            .get(&id_key)
            .expect("DID not found")
    }

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

    fn bump_ctrl(env: &Env, key: &(Symbol, Address)) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn bump_id(env: &Env, key: &(Symbol, String)) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::{vec, Env, IntoVal};

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
        let doc_by_id = client.resolve_by_id(&did);

        assert!(doc.active);
        assert_eq!(doc.controller, controller);
        assert_eq!(doc.document_hash, h);
        assert_eq!(doc.id, did);
        assert_eq!(doc.version, 1);
        assert_eq!(doc_by_id.id, did);
    }

    #[test]
    fn test_did_id_is_derived_from_controller() {
        let env = Env::default();
        let (client, controller_a) = setup(&env);
        let controller_b = Address::generate(&env);

        let did_a = client.register(&controller_a, &hash(&env));
        let did_b = client.register(&controller_b, &hash(&env));

        assert_ne!(did_a, did_b, "distinct controllers must get distinct DIDs");
    }

    #[test]
    fn test_resolved_did_contains_controller_strkey() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        let did = client.register(&controller, &hash(&env));

        let expected = controller.to_string();
        assert_eq!(did.len(), 12 + expected.len());
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
    fn test_update_changes_hash_and_version() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        let did = client.register(&controller, &hash(&env));

        let new_hash = Bytes::from_slice(&env, &[9u8; 32]);
        client.update(&controller, &new_hash);

        let doc = client.resolve_by_id(&did);
        assert_eq!(doc.document_hash, new_hash);
        assert_eq!(doc.version, 2);
    }

    #[test]
    fn test_key_rotation_preserves_did_identifier_and_transfers_control() {
        let env = Env::default();
        let (client, old_ctrl) = setup(&env);
        let new_ctrl = Address::generate(&env);
        let did = client.register(&old_ctrl, &hash(&env));

        client.rotate_controller(&did, &new_ctrl);

        let doc = client.resolve_by_id(&did);
        assert_eq!(
            doc.id, did,
            "DID identifier must remain stable across rotation"
        );
        assert_eq!(doc.controller, new_ctrl);
        assert_eq!(doc.version, 2);

        // Resolving by new controller returns same DID; old controller no longer resolves.
        assert_eq!(client.resolve(&new_ctrl).id, did);
        assert!(client.try_resolve(&old_ctrl).is_err());

        // New controller can update by id
        let updated = Bytes::from_slice(&env, &[5u8; 32]);
        client.update_by_id(&did, &updated);
        assert_eq!(client.resolve_by_id(&did).document_hash, updated);
    }

    #[test]
    fn test_recovery_rotates_controller_while_preserving_did() {
        let env = Env::default();
        let (client, ctrl) = setup(&env);
        let guardian = Address::generate(&env);
        let recovered_ctrl = Address::generate(&env);
        let did = client.register(&ctrl, &hash(&env));

        client.set_recovery(&did, &Some(guardian.clone()));
        client.recover(&did, &recovered_ctrl);

        let doc = client.resolve_by_id(&did);
        assert_eq!(doc.id, did);
        assert_eq!(doc.controller, recovered_ctrl);
        assert_eq!(doc.recovery, Some(guardian));
    }

    #[test]
    fn test_set_services_anchors_endpoints() {
        let env = Env::default();
        let (client, ctrl) = setup(&env);
        let did = client.register(&ctrl, &hash(&env));

        let endpoint = ServiceEndpoint {
            id: String::from_str(&env, "#kyc-agent"),
            service_type: String::from_str(&env, "KYCVerificationService"),
            endpoint: String::from_str(&env, "https://kyc.example.org"),
        };
        client.set_services(&did, &vec![&env, endpoint.clone()]);
        assert_eq!(client.resolve_by_id(&did).services.len(), 1);
    }

    #[test]
    fn test_deactivate_marks_inactive_and_blocks_recovery_and_rotation() {
        let env = Env::default();
        let (client, controller) = setup(&env);
        let guardian = Address::generate(&env);
        let did = client.register(&controller, &hash(&env));
        client.set_recovery(&did, &Some(guardian));

        client.deactivate(&controller);
        let doc = client.resolve_by_id(&did);
        assert!(!doc.active);
        assert!(doc.recovery.is_none());

        assert!(client.try_register(&controller, &hash(&env)).is_err());
        assert!(client
            .try_rotate_controller(&did, &Address::generate(&env))
            .is_err());
        assert!(client.try_recover(&did, &Address::generate(&env)).is_err());
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

    #[test]
    fn test_register_extends_storage_ttl() {
        use soroban_sdk::testutils::storage::Persistent;

        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, DIDRegistry);
        let client = DIDRegistryClient::new(&env, &contract_id);
        let controller = Address::generate(&env);
        let did = client.register(&controller, &hash(&env));

        let id_key = (Symbol::new(&env, DID_ID_PREFIX), did);
        let remaining =
            env.as_contract(&contract_id, || env.storage().persistent().get_ttl(&id_key));
        assert!(
            remaining > 17_280,
            "DID TTL must outlive the old 24h window, got {remaining}"
        );
    }

    /// Phase 6 negative authorization tests without `mock_all_auths`.
    #[test]
    fn test_unauthorized_signers_rejected_without_mock_all_auths() {
        let env = Env::default();
        let contract_id = env.register_contract(None, DIDRegistry);
        let client = DIDRegistryClient::new(&env, &contract_id);

        let controller = Address::generate(&env);
        let attacker = Address::generate(&env);
        let new_ctrl = Address::generate(&env);
        let h = hash(&env);

        // Register without auth -> must fail
        assert!(client.try_register(&controller, &h).is_err());

        // Register with proper controller auth
        env.mock_auths(&[MockAuth {
            address: &controller,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "register",
                args: (controller.clone(), h.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let did = client.register(&controller, &h);

        // Attacker tries to update_by_id using attacker's own auth -> must fail (requires controller)
        let bad_hash = Bytes::from_slice(&env, &[3u8; 32]);
        env.mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "update_by_id",
                args: (did.clone(), bad_hash.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_update_by_id(&did, &bad_hash).is_err());

        // Rotation missing new_controller auth -> must fail
        env.mock_auths(&[MockAuth {
            address: &controller,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "rotate_controller",
                args: (did.clone(), new_ctrl.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_rotate_controller(&did, &new_ctrl).is_err());

        // Rotation with BOTH controller and new_controller auths -> succeeds
        env.mock_auths(&[
            MockAuth {
                address: &controller,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "rotate_controller",
                    args: (did.clone(), new_ctrl.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            },
            MockAuth {
                address: &new_ctrl,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "rotate_controller",
                    args: (did.clone(), new_ctrl.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            },
        ]);
        client.rotate_controller(&did, &new_ctrl);
        assert_eq!(client.resolve_by_id(&did).controller, new_ctrl);

        // Old controller can no longer deactivate after rotation
        env.mock_auths(&[MockAuth {
            address: &controller,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "deactivate_by_id",
                args: (did.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(client.try_deactivate_by_id(&did).is_err());
    }
}
