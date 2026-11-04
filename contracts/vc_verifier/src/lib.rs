//! Verifiable Credential (VC) Verifier Contract
//!
//! Two credential paths are modelled here:
//!
//! 1. **Issuer-attested credentials** ([`VCVerifier::issue_credential`]) — an
//!    admin-registered issuer records an attested attribute for a subject with
//!    an explicit expiry. These support revocation and are what the Compliance
//!    Engine evaluates.
//! 2. **Ring-signature attribute proofs** ([`VCVerifier::verify_credential`]) —
//!    intended to prove membership in an attribute ring without revealing the
//!    member. **This path is currently disabled and fails closed.**
//!
//! # Why ring proofs fail closed
//!
//! BLS12-381 host functions do not exist in `soroban-sdk` 21 (the version this
//! workspace pins); they were introduced in Protocol 22 (CAP-0059). More
//! importantly, no ring-signature construction was ever specified for this
//! project, so there is nothing to verify against. The previous implementation
//! returned `true` for *any* byte string of the right length, which silently
//! turned every downstream compliance check into a rubber stamp.
//!
//! `verify_credential` therefore always returns `false` and mutates no state.
//! Do not re-enable it without a specified scheme, test vectors, and an
//! independent review.
//!
//! # Storage
//! - `ADMIN`             → Address (instance)
//! - `ISSUERS`           → Vec<Address> (instance)
//! - `RING:<attribute>`  → AttributeRing (persistent)
//! - `CRED:<subject>:<attribute>` → Credential (persistent)

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, Symbol, Vec};

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
///
/// Retained for API compatibility only: see [`VCVerifier::verify_credential`].
#[contracttype]
#[derive(Clone)]
pub struct RingSignature {
    /// Initial challenge scalar (32 bytes)
    pub challenge: BytesN<32>,
    /// Response values — one per ring member (32 bytes each)
    pub responses: Vec<BytesN<32>>,
}

/// An issuer-attested credential for a single attribute.
#[contracttype]
#[derive(Clone)]
pub struct Credential {
    pub subject: Address,
    pub attribute: Symbol,
    /// Issuer that attested the credential
    pub issuer: Address,
    /// Ledger sequence at which the credential was issued
    pub issued_at: u32,
    /// Ledger sequence after which the credential is no longer valid
    pub expires_at: u32,
    pub revoked: bool,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

const ADMIN_KEY: &str = "ADMIN";
const ISSUERS_KEY: &str = "ISSUERS";
const RING_PREFIX: &str = "RING";
const CRED_PREFIX: &str = "CRED";

/// Maximum number of members in an attribute ring. Bounds verification cost and
/// limits the storage/gas impact of an attacker-supplied ring.
const MAX_RING_SIZE: u32 = 16;

/// Minimum remaining TTL before a persistent entry is extended.
const TTL_THRESHOLD: u32 = 4_096;
/// TTL (in ledgers) that persistent entries are extended to on write.
const TTL_EXTEND_TO: u32 = 17_280;
/// Instance-storage TTL policy for the admin/issuer registry.
const INSTANCE_TTL_THRESHOLD: u32 = 4_096;
const INSTANCE_TTL_EXTEND_TO: u32 = 17_280;

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct VCVerifier;

#[contractimpl]
impl VCVerifier {
    /// One-time initialisation — sets the admin address.
    ///
    /// # Panics
    /// * if the contract is already initialised.
    ///
    /// # Deployment note
    /// Initialisation is not atomic with deployment. Submit the deploy and this
    /// call in the same transaction (or verify the admin immediately after) so
    /// that the initialiser cannot be front-run.
    pub fn initialize(env: Env, admin: Address) {
        let key = Symbol::new(&env, ADMIN_KEY);
        if env.storage().instance().has(&key) {
            panic!("already initialized");
        }
        env.storage().instance().set(&key, &admin);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, ISSUERS_KEY), &Vec::<Address>::new(&env));
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);

        env.events()
            .publish((Symbol::new(&env, "vc"), Symbol::new(&env, "init")), admin);
    }

    /// Admin registers a trusted issuer.
    ///
    /// # Panics
    /// * if `admin` is not the stored admin.
    pub fn add_issuer(env: Env, admin: Address, issuer: Address) {
        Self::require_admin(&env, &admin);

        let key = Symbol::new(&env, ISSUERS_KEY);
        let mut issuers: Vec<Address> = env.storage().instance().get(&key).unwrap();
        if !issuers.contains(&issuer) {
            issuers.push_back(issuer.clone());
            env.storage().instance().set(&key, &issuers);
            env.storage()
                .instance()
                .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);

            env.events().publish(
                (Symbol::new(&env, "vc"), Symbol::new(&env, "issuer_added")),
                issuer,
            );
        }
    }

    /// Admin de-registers an issuer.
    ///
    /// Credentials attested by a de-registered issuer stop validating, which is
    /// how a compromised issuer key is contained.
    ///
    /// # Panics
    /// * if the caller is not the admin, or `issuer` is not registered.
    pub fn remove_issuer(env: Env, admin: Address, issuer: Address) {
        Self::require_admin(&env, &admin);

        let key = Symbol::new(&env, ISSUERS_KEY);
        let mut issuers: Vec<Address> = env.storage().instance().get(&key).unwrap();

        let index = issuers
            .first_index_of(issuer.clone())
            .expect("issuer not registered");
        issuers.remove(index);
        env.storage().instance().set(&key, &issuers);

        env.events().publish(
            (Symbol::new(&env, "vc"), Symbol::new(&env, "issuer_removed")),
            issuer,
        );
    }

    /// Admin transfers the admin role.
    ///
    /// # Panics
    /// * if the caller is not the current admin.
    pub fn transfer_admin(env: Env, admin: Address, new_admin: Address) {
        Self::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, ADMIN_KEY), &new_admin);

        env.events().publish(
            (Symbol::new(&env, "vc"), Symbol::new(&env, "admin_changed")),
            new_admin,
        );
    }

    /// Returns the current admin address.
    pub fn get_admin(env: Env) -> Address {
        Self::admin(&env)
    }

    /// Returns the registered issuers.
    pub fn get_issuers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, ISSUERS_KEY))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Issuer creates or replaces the ring for a given attribute.
    ///
    /// # Panics
    /// * if `issuer` is not registered, or the ring is empty, oversized, or
    ///   contains duplicate keys.
    pub fn set_attribute_ring(env: Env, issuer: Address, attribute: Symbol, ring: Vec<BytesN<96>>) {
        issuer.require_auth();
        assert!(
            Self::is_registered_issuer(&env, &issuer),
            "issuer is not registered"
        );

        assert!(!ring.is_empty(), "ring must not be empty");
        assert!(ring.len() <= MAX_RING_SIZE, "ring exceeds MAX_RING_SIZE");

        // Reject duplicates: repeated members shrink the anonymity set and enable
        // rogue-key style attacks in any future BLS construction.
        for i in 0..ring.len() {
            let key = ring.get(i).unwrap();
            for j in (i + 1)..ring.len() {
                assert!(key != ring.get(j).unwrap(), "duplicate ring member");
            }
        }

        let ring_key = (Symbol::new(&env, RING_PREFIX), attribute.clone());
        let attr_ring = AttributeRing {
            attribute: attribute.clone(),
            public_keys: ring,
        };
        env.storage().persistent().set(&ring_key, &attr_ring);
        env.storage()
            .persistent()
            .extend_ttl(&ring_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        env.events().publish(
            (Symbol::new(&env, "vc"), Symbol::new(&env, "ring_set")),
            (issuer, attribute),
        );
    }

    /// Verify a ring signature for `attribute`.
    ///
    /// **Always returns `false` in this version.** See the module documentation:
    /// there is no BLS12-381 support in the pinned SDK and no specified ring
    /// signature construction. The function fails closed and mutates no state.
    /// This replaced an implementation that returned `true` for any byte string
    /// whose length matched the ring size.
    pub fn verify_credential(
        env: Env,
        attribute: Symbol,
        message: Bytes,
        signature: RingSignature,
    ) -> bool {
        let ring_key = (Symbol::new(&env, RING_PREFIX), attribute);
        let ring: AttributeRing = match env.storage().persistent().get(&ring_key) {
            Some(r) => r,
            // Unknown ring is an input error, not a panic: callers must be able
            // to branch on the result without trapping.
            None => return false,
        };

        // Shape checks are kept so that malformed input is rejected without
        // reaching the (unavailable) cryptographic path.
        if message.is_empty() || ring.public_keys.is_empty() {
            return false;
        }
        if signature.responses.len() != ring.public_keys.len() {
            return false;
        }

        false
    }

    /// Capability probe for clients: ring-signature verification is unavailable.
    pub fn ring_verification_available(_env: Env) -> bool {
        false
    }

    /// Returns the ring for a given attribute (for client-side signature generation).
    ///
    /// # Panics
    /// * if no ring is registered for `attribute`.
    pub fn get_ring(env: Env, attribute: Symbol) -> AttributeRing {
        let ring_key = (Symbol::new(&env, RING_PREFIX), attribute);
        env.storage()
            .persistent()
            .get(&ring_key)
            .expect("attribute ring not found")
    }

    /// Issuer records an attested attribute for `subject`.
    ///
    /// # Panics
    /// * if `issuer` is not registered
    /// * if `expires_at` is not in the future
    pub fn issue_credential(
        env: Env,
        issuer: Address,
        subject: Address,
        attribute: Symbol,
        expires_at: u32,
    ) -> Credential {
        issuer.require_auth();
        assert!(
            Self::is_registered_issuer(&env, &issuer),
            "issuer is not registered"
        );

        let now = env.ledger().sequence();
        assert!(expires_at > now, "expires_at must be in the future");

        let credential = Credential {
            subject: subject.clone(),
            attribute: attribute.clone(),
            issuer: issuer.clone(),
            issued_at: now,
            expires_at,
            revoked: false,
        };

        let key = Self::cred_key(&env, &subject, &attribute);
        env.storage().persistent().set(&key, &credential);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        env.events().publish(
            (
                Symbol::new(&env, "vc"),
                Symbol::new(&env, "credential_issued"),
            ),
            (subject, attribute, issuer, expires_at),
        );

        credential
    }

    /// Issuer (or the admin) revokes a credential.
    ///
    /// # Panics
    /// * if the caller is neither a registered issuer nor the admin
    /// * if the credential does not exist or is already revoked
    pub fn revoke_credential(env: Env, caller: Address, subject: Address, attribute: Symbol) {
        caller.require_auth();
        assert!(
            Self::is_registered_issuer(&env, &caller) || caller == Self::admin(&env),
            "caller may not revoke credentials"
        );

        let key = Self::cred_key(&env, &subject, &attribute);
        let mut credential: Credential = env
            .storage()
            .persistent()
            .get(&key)
            .expect("credential not found");

        assert!(!credential.revoked, "credential already revoked");

        credential.revoked = true;
        env.storage().persistent().set(&key, &credential);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        env.events().publish(
            (
                Symbol::new(&env, "vc"),
                Symbol::new(&env, "credential_revoked"),
            ),
            (subject, attribute, caller),
        );
    }

    /// Returns the credential for `subject`/`attribute`, if one exists.
    pub fn get_credential(env: Env, subject: Address, attribute: Symbol) -> Option<Credential> {
        env.storage()
            .persistent()
            .get(&Self::cred_key(&env, &subject, &attribute))
    }

    /// Whether `subject` holds a currently valid credential for `attribute`.
    ///
    /// A credential is valid when it exists, is not revoked, has not expired, and
    /// was issued by an issuer that is still registered.
    pub fn is_credential_valid(env: Env, subject: Address, attribute: Symbol) -> bool {
        let credential: Credential = match env
            .storage()
            .persistent()
            .get(&Self::cred_key(&env, &subject, &attribute))
        {
            Some(c) => c,
            None => return false,
        };

        if credential.revoked {
            return false;
        }
        if env.ledger().sequence() >= credential.expires_at {
            return false;
        }
        // De-registering an issuer invalidates everything it attested.
        Self::is_registered_issuer(&env, &credential.issuer)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&Symbol::new(env, ADMIN_KEY))
            .expect("not initialized")
    }

    fn require_admin(env: &Env, caller: &Address) {
        let stored = Self::admin(env);
        assert!(stored == *caller, "caller is not the admin");
        stored.require_auth();
    }

    fn is_registered_issuer(env: &Env, issuer: &Address) -> bool {
        let issuers: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(env, ISSUERS_KEY))
            .unwrap_or_else(|| Vec::new(env));
        issuers.contains(issuer)
    }

    fn cred_key(env: &Env, subject: &Address, attribute: &Symbol) -> (Symbol, Address, Symbol) {
        (
            Symbol::new(env, CRED_PREFIX),
            subject.clone(),
            attribute.clone(),
        )
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger, LedgerInfo};
    use soroban_sdk::{vec, Env};

    fn set_ledger(env: &Env, sequence: u32) {
        env.ledger().set(LedgerInfo {
            protocol_version: 21,
            sequence_number: sequence,
            timestamp: 0,
            network_id: [0u8; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 16,
            max_entry_ttl: 6_312_000,
        });
    }

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

    /// Deploys and initialises the contract. Returns `(client, admin, issuer)`.
    fn setup<'a>(env: &'a Env) -> (VCVerifierClient<'a>, Address, Address) {
        set_ledger(env, 100);
        env.mock_all_auths();

        let contract_id = env.register_contract(None, VCVerifier);
        let client = VCVerifierClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let issuer = Address::generate(env);
        client.initialize(&admin);
        client.add_issuer(&admin, &issuer);

        (client, admin, issuer)
    }

    fn attr(env: &Env) -> Symbol {
        Symbol::new(env, "kyc_passed")
    }

    #[test]
    fn test_initialize_and_issuer_registry() {
        let env = Env::default();
        let (client, admin, issuer) = setup(&env);
        assert_eq!(client.get_admin(), admin);
        assert!(client.get_issuers().contains(&issuer));
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_rejected() {
        let env = Env::default();
        let (client, _admin, _issuer) = setup(&env);
        client.initialize(&Address::generate(&env));
    }

    #[test]
    #[should_panic(expected = "caller is not the admin")]
    fn test_non_admin_cannot_add_issuer() {
        let env = Env::default();
        let (client, _admin, _issuer) = setup(&env);
        let attacker = Address::generate(&env);
        client.add_issuer(&attacker, &attacker);
    }

    #[test]
    #[should_panic(expected = "issuer is not registered")]
    fn test_unregistered_issuer_cannot_set_ring() {
        let env = Env::default();
        let (client, _admin, _issuer) = setup(&env);
        let attacker = Address::generate(&env);
        // Regression for AUDIT.md C-4: previously any address could overwrite
        // any attribute ring, allowing self-issued credentials.
        client.set_attribute_ring(&attacker, &attr(&env), &vec![&env, dummy_pubkey(&env, 1)]);
    }

    #[test]
    fn test_registered_issuer_can_set_ring() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        client.set_attribute_ring(
            &issuer,
            &attr(&env),
            &vec![&env, dummy_pubkey(&env, 1), dummy_pubkey(&env, 2)],
        );
        assert_eq!(client.get_ring(&attr(&env)).public_keys.len(), 2);
    }

    #[test]
    #[should_panic(expected = "ring must not be empty")]
    fn test_empty_ring_rejected() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        client.set_attribute_ring(&issuer, &attr(&env), &Vec::new(&env));
    }

    #[test]
    #[should_panic(expected = "duplicate ring member")]
    fn test_duplicate_ring_member_rejected() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        client.set_attribute_ring(
            &issuer,
            &attr(&env),
            &vec![&env, dummy_pubkey(&env, 1), dummy_pubkey(&env, 1)],
        );
    }

    #[test]
    fn test_forged_ring_signature_is_rejected() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        client.set_attribute_ring(
            &issuer,
            &attr(&env),
            &vec![&env, dummy_pubkey(&env, 1), dummy_pubkey(&env, 2)],
        );

        // Regression for AUDIT.md C-2: this exact input used to return true.
        let message = Bytes::from_slice(&env, b"challenge-abc");
        let sig = dummy_sig(&env, 2);
        assert!(!client.verify_credential(&attr(&env), &message, &sig));
        assert!(!client.ring_verification_available());
    }

    #[test]
    fn test_verify_unknown_ring_returns_false_without_panic() {
        let env = Env::default();
        let (client, _admin, _issuer) = setup(&env);
        let unknown = Symbol::new(&env, "over_18");
        let message = Bytes::from_slice(&env, b"challenge");
        let sig = dummy_sig(&env, 1);
        // Regression for AUDIT.md H-3: used to panic with "attribute ring not found".
        assert!(!client.verify_credential(&unknown, &message, &sig));
    }

    #[test]
    fn test_verify_rejects_shape_mismatch_and_empty_message() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        client.set_attribute_ring(
            &issuer,
            &attr(&env),
            &vec![&env, dummy_pubkey(&env, 1), dummy_pubkey(&env, 2)],
        );

        let message = Bytes::from_slice(&env, b"challenge");
        assert!(!client.verify_credential(&attr(&env), &message, &dummy_sig(&env, 3)));
        assert!(!client.verify_credential(&attr(&env), &Bytes::new(&env), &dummy_sig(&env, 2)));
    }

    #[test]
    fn test_issue_credential_is_valid_until_expiry() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        let subject = Address::generate(&env);

        client.issue_credential(&issuer, &subject, &attr(&env), &1_000);
        assert!(client.is_credential_valid(&subject, &attr(&env)));

        set_ledger(&env, 999);
        assert!(client.is_credential_valid(&subject, &attr(&env)));

        set_ledger(&env, 1_000);
        assert!(
            !client.is_credential_valid(&subject, &attr(&env)),
            "credential must expire at expires_at"
        );
    }

    #[test]
    #[should_panic(expected = "expires_at must be in the future")]
    fn test_issue_credential_in_the_past_rejected() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        let subject = Address::generate(&env);
        client.issue_credential(&issuer, &subject, &attr(&env), &50);
    }

    #[test]
    #[should_panic(expected = "issuer is not registered")]
    fn test_unregistered_cannot_issue() {
        let env = Env::default();
        let (client, _admin, _issuer) = setup(&env);
        let attacker = Address::generate(&env);
        let subject = Address::generate(&env);
        client.issue_credential(&attacker, &subject, &attr(&env), &1_000);
    }

    #[test]
    fn test_revoked_credential_is_invalid() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        let subject = Address::generate(&env);

        client.issue_credential(&issuer, &subject, &attr(&env), &1_000);
        assert!(client.is_credential_valid(&subject, &attr(&env)));

        client.revoke_credential(&issuer, &subject, &attr(&env));
        assert!(!client.is_credential_valid(&subject, &attr(&env)));
    }

    #[test]
    #[should_panic(expected = "credential already revoked")]
    fn test_double_revoke_rejected() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        let subject = Address::generate(&env);
        client.issue_credential(&issuer, &subject, &attr(&env), &1_000);
        client.revoke_credential(&issuer, &subject, &attr(&env));
        client.revoke_credential(&issuer, &subject, &attr(&env));
    }

    #[test]
    #[should_panic(expected = "caller may not revoke credentials")]
    fn test_unauthorized_revoke_rejected() {
        let env = Env::default();
        let (client, _admin, issuer) = setup(&env);
        let subject = Address::generate(&env);
        client.issue_credential(&issuer, &subject, &attr(&env), &1_000);
        let attacker = Address::generate(&env);
        client.revoke_credential(&attacker, &subject, &attr(&env));
    }

    #[test]
    fn test_admin_can_revoke() {
        let env = Env::default();
        let (client, admin, issuer) = setup(&env);
        let subject = Address::generate(&env);
        client.issue_credential(&issuer, &subject, &attr(&env), &1_000);

        client.revoke_credential(&admin, &subject, &attr(&env));
        assert!(!client.is_credential_valid(&subject, &attr(&env)));
    }

    #[test]
    fn test_removing_issuer_invalidates_their_credentials() {
        let env = Env::default();
        let (client, admin, issuer) = setup(&env);
        let subject = Address::generate(&env);
        client.issue_credential(&issuer, &subject, &attr(&env), &1_000);
        assert!(client.is_credential_valid(&subject, &attr(&env)));

        client.remove_issuer(&admin, &issuer);

        assert!(!client.is_credential_valid(&subject, &attr(&env)));
        assert!(!client.get_issuers().contains(&issuer));
    }

    #[test]
    fn test_unknown_credential_is_invalid() {
        let env = Env::default();
        let (client, _admin, _issuer) = setup(&env);
        let subject = Address::generate(&env);
        assert!(!client.is_credential_valid(&subject, &attr(&env)));
        assert!(client.get_credential(&subject, &attr(&env)).is_none());
    }

    #[test]
    fn test_transfer_admin() {
        let env = Env::default();
        let (client, admin, _issuer) = setup(&env);
        let new_admin = Address::generate(&env);
        client.transfer_admin(&admin, &new_admin);
        assert_eq!(client.get_admin(), new_admin);
    }
}
