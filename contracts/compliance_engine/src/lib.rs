//! Compliance Engine Contract
//!
//! Evaluates KYC/AML policy rules on-chain against credentials held by the
//! VC Verifier contract.
//!
//! # Concepts
//! - **Policy**: a named, versioned set of required credential attributes
//!   (e.g. "defi_pool" requires `["kyc_passed", "not_sanctioned"]`).
//! - **Compliance**: computed live. A subject is compliant when *every* required
//!   attribute resolves to a currently valid credential in the verifier.
//! - **Cross-chain export**: a read-only attestation snapshot
//!   ([`ComplianceEngine::export_attestation`]) that a relayer can quote. It is
//!   **not** signed on-chain — see AUDIT.md.
//!
//! # Design notes
//! There is deliberately no mutable "compliance status" table. The previous
//! version let any address write `compliant = true` for any subject under any
//! policy, which was a total authorization bypass (AUDIT.md C-5). Compliance is
//! derived from credentials, so it cannot be asserted into existence.
//!
//! Unknown policies, unset verifier, and missing credentials all evaluate to
//! `false` (fail closed).

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, vec, Address, Env, IntoVal, Symbol, Vec};

// ── Data types ────────────────────────────────────────────────────────────────

/// A compliance policy: a named list of required credential attributes.
#[contracttype]
#[derive(Clone)]
pub struct Policy {
    pub name: Symbol,
    /// Attribute symbols that must all resolve to valid credentials
    pub required_attributes: Vec<Symbol>,
    /// Incremented on every update, so consumers can detect stale evaluations
    pub version: u32,
}

/// A point-in-time, read-only compliance attestation.
#[contracttype]
#[derive(Clone)]
pub struct Attestation {
    pub subject: Address,
    pub policy: Symbol,
    pub compliant: bool,
    /// Ledger sequence at which this attestation was produced
    pub evaluated_at: u32,
    /// Version of the policy that was evaluated
    pub policy_version: u32,
    /// Verifier contract the credentials were read from
    pub verifier: Address,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

const ADMIN_KEY: &str = "ADMIN";
const VERIFIER_KEY: &str = "VERIFIER";
const POLICY_PREFIX: &str = "POL";

/// Minimum remaining TTL before a persistent entry is extended (~7.5 days at 5 s/ledger).
const TTL_THRESHOLD: u32 = 129_600;
/// TTL (in ledgers) that policy entries are extended to on write.
///
/// ~30 days at 5 s/ledger, matching `did_registry` and `vc_verifier`. Policies are
/// long-lived configuration: a 24 h window silently archived them and made
/// `is_compliant` return `false` for a policy that still existed economically.
const TTL_EXTEND_TO: u32 = 518_400;
const INSTANCE_TTL_THRESHOLD: u32 = 129_600;
const INSTANCE_TTL_EXTEND_TO: u32 = 518_400;

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct ComplianceEngine;

#[contractimpl]
impl ComplianceEngine {
    /// One-time initialisation.
    ///
    /// # Panics
    /// * if the contract is already initialised.
    pub fn initialize(env: Env, admin: Address) {
        let key = Symbol::new(&env, ADMIN_KEY);
        if env.storage().instance().has(&key) {
            panic!("already initialized");
        }
        env.storage().instance().set(&key, &admin);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);

        env.events().publish(
            (Symbol::new(&env, "compliance"), Symbol::new(&env, "init")),
            admin,
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
    }

    /// Returns the current admin.
    pub fn get_admin(env: Env) -> Address {
        Self::admin(&env)
    }

    /// Admin sets (or replaces) the VC Verifier contract that credentials are
    /// read from.
    ///
    /// # Panics
    /// * if the caller is not the admin.
    pub fn set_verifier(env: Env, admin: Address, verifier: Address) {
        Self::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, VERIFIER_KEY), &verifier);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);

        env.events().publish(
            (
                Symbol::new(&env, "compliance"),
                Symbol::new(&env, "verifier"),
            ),
            verifier,
        );
    }

    /// Returns the configured verifier, if any.
    pub fn get_verifier(env: Env) -> Option<Address> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, VERIFIER_KEY))
    }

    /// Admin creates or updates a compliance policy.
    ///
    /// # Panics
    /// * if the caller is not the admin
    /// * if `required_attributes` is empty or contains duplicates
    pub fn set_policy(
        env: Env,
        admin: Address,
        name: Symbol,
        required_attributes: Vec<Symbol>,
    ) -> Policy {
        Self::require_admin(&env, &admin);

        assert!(
            !required_attributes.is_empty(),
            "policy must require at least one attribute"
        );
        for i in 0..required_attributes.len() {
            let a = required_attributes.get(i).unwrap();
            for j in (i + 1)..required_attributes.len() {
                assert!(
                    a != required_attributes.get(j).unwrap(),
                    "duplicate required attribute"
                );
            }
        }

        let key = (Symbol::new(&env, POLICY_PREFIX), name.clone());
        let version = match env.storage().persistent().get::<_, Policy>(&key) {
            Some(existing) => existing.version + 1,
            None => 1,
        };

        let policy = Policy {
            name: name.clone(),
            required_attributes,
            version,
        };
        env.storage().persistent().set(&key, &policy);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        env.events().publish(
            (
                Symbol::new(&env, "compliance"),
                Symbol::new(&env, "policy_set"),
            ),
            (name, version),
        );

        policy
    }

    /// Returns the policy definition.
    ///
    /// # Panics
    /// * if the policy does not exist.
    pub fn get_policy(env: Env, name: Symbol) -> Policy {
        let key = (Symbol::new(&env, POLICY_PREFIX), name);
        env.storage()
            .persistent()
            .get(&key)
            .expect("policy not found")
    }

    /// Check whether `subject` is compliant under `policy`.
    ///
    /// Evaluated live against the configured verifier. Returns `false` — never
    /// panics — when the policy is unknown, no verifier is configured, or any
    /// required credential is missing, expired, revoked, or from a de-registered
    /// issuer.
    ///
    /// The verifier call uses `try_invoke_contract`, so a verifier address that is
    /// not a contract (or a verifier that traps) also evaluates to `false` rather
    /// than aborting. This matters because `is_compliant` is the entry point third
    /// parties integrate against: a misconfigured verifier must degrade to
    /// "not compliant", not to a failed transaction.
    pub fn is_compliant(env: Env, subject: Address, policy: Symbol) -> bool {
        let policy_key = (Symbol::new(&env, POLICY_PREFIX), policy);
        let policy: Policy = match env.storage().persistent().get(&policy_key) {
            Some(p) => p,
            None => return false,
        };

        let verifier: Address = match env
            .storage()
            .instance()
            .get(&Symbol::new(&env, VERIFIER_KEY))
        {
            Some(v) => v,
            None => return false,
        };

        for i in 0..policy.required_attributes.len() {
            let attribute = policy.required_attributes.get(i).unwrap();
            if !Self::credential_is_valid(&env, &verifier, &subject, &attribute) {
                return false;
            }
        }

        true
    }

    /// Produce a read-only compliance attestation snapshot for a subject.
    ///
    /// The payload is not signed: a relayer must not treat it as proof of
    /// anything on its own. Consumers should re-evaluate on-chain or verify a
    /// relayer signature against an allowlist.
    ///
    /// # Panics
    /// * if the policy does not exist, or no verifier is configured.
    pub fn export_attestation(env: Env, subject: Address, policy: Symbol) -> Attestation {
        let policy_key = (Symbol::new(&env, POLICY_PREFIX), policy.clone());
        let stored: Policy = env
            .storage()
            .persistent()
            .get(&policy_key)
            .expect("policy not found");

        let verifier: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, VERIFIER_KEY))
            .expect("verifier not configured");

        let compliant = Self::is_compliant(env.clone(), subject.clone(), policy.clone());

        env.events().publish(
            (
                Symbol::new(&env, "compliance"),
                Symbol::new(&env, "attestation"),
            ),
            (subject.clone(), policy.clone(), compliant),
        );

        Attestation {
            subject,
            policy,
            compliant,
            evaluated_at: env.ledger().sequence(),
            policy_version: stored.version,
            verifier,
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn credential_is_valid(
        env: &Env,
        verifier: &Address,
        subject: &Address,
        attribute: &Symbol,
    ) -> bool {
        let args = vec![
            env,
            subject.clone().into_val(env),
            attribute.clone().into_val(env),
        ];
        match env.try_invoke_contract::<bool, soroban_sdk::Error>(
            verifier,
            &Symbol::new(env, "is_credential_valid"),
            args,
        ) {
            Ok(Ok(valid)) => valid,
            // Not-a-contract, host error, or a trap inside the verifier. Fail closed:
            // the old `invoke_contract` call aborted the whole `is_compliant` call
            // (ACCEPTANCE-AUDIT.md M-1).
            _ => false,
        }
    }

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
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger, LedgerInfo};
    use soroban_sdk::{Env, Symbol};
    use vc_verifier::{VCVerifier, VCVerifierClient};

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

    fn kyc(env: &Env) -> Symbol {
        Symbol::new(env, "kyc_passed")
    }

    /// Regression for ACCEPTANCE-AUDIT.md M-1: a verifier address that is not a
    /// contract used to trap out of `is_compliant`, despite the documented promise
    /// that it never panics.
    #[test]
    fn test_unreachable_verifier_fails_closed() {
        let env = Env::default();
        let f = setup(&env);
        let not_a_contract = Address::generate(&env);
        f.client.set_verifier(&f.admin, &not_a_contract);

        assert!(!f.client.is_compliant(&f.subject, &f.policy));

        let attestation = f.client.export_attestation(&f.subject, &f.policy);
        assert!(!attestation.compliant);
        assert_eq!(attestation.verifier, not_a_contract);
    }

    fn sanctions(env: &Env) -> Symbol {
        Symbol::new(env, "not_sanctioned")
    }

    struct Fixture<'a> {
        client: ComplianceEngineClient<'a>,
        verifier: VCVerifierClient<'a>,
        admin: Address,
        issuer: Address,
        subject: Address,
        policy: Symbol,
    }

    fn setup<'a>(env: &'a Env) -> Fixture<'a> {
        set_ledger(env, 100);
        env.mock_all_auths();

        let verifier_id = env.register_contract(None, VCVerifier);
        let verifier = VCVerifierClient::new(env, &verifier_id);

        let engine_id = env.register_contract(None, ComplianceEngine);
        let client = ComplianceEngineClient::new(env, &engine_id);

        let admin = Address::generate(env);
        let issuer = Address::generate(env);
        let subject = Address::generate(env);
        let policy = Symbol::new(env, "defi_pool");

        verifier.initialize(&admin);
        verifier.add_issuer(&admin, &issuer);
        client.initialize(&admin);
        client.set_verifier(&admin, &verifier_id);
        client.set_policy(&admin, &policy, &vec![env, kyc(env), sanctions(env)]);

        Fixture {
            client,
            verifier,
            admin,
            issuer,
            subject,
            policy,
        }
    }

    #[test]
    fn test_policy_requires_all_attributes() {
        let env = Env::default();
        let f = setup(&env);

        // No credentials at all.
        assert!(!f.client.is_compliant(&f.subject, &f.policy));

        // One of two required attributes.
        f.verifier
            .issue_credential(&f.issuer, &f.subject, &kyc(&env), &1_000);
        assert!(
            !f.client.is_compliant(&f.subject, &f.policy),
            "partial credentials must not satisfy the policy"
        );

        // Both required attributes.
        f.verifier
            .issue_credential(&f.issuer, &f.subject, &sanctions(&env), &1_000);
        assert!(f.client.is_compliant(&f.subject, &f.policy));
    }

    /// Regression for ACCEPTANCE-AUDIT.md H-5: a policy entry used to be extended
    /// only to 17,280 ledgers (~24 h), so long-lived configuration could archive.
    #[test]
    fn test_set_policy_extends_storage_ttl() {
        use soroban_sdk::testutils::storage::Persistent;

        let env = Env::default();
        set_ledger(&env, 100);
        env.mock_all_auths();

        let engine_id = env.register_contract(None, ComplianceEngine);
        let client = ComplianceEngineClient::new(&env, &engine_id);
        let admin = Address::generate(&env);
        let policy = Symbol::new(&env, "defi_pool");
        client.initialize(&admin);
        client.set_policy(&admin, &policy, &vec![&env, kyc(&env)]);

        let key = (Symbol::new(&env, POLICY_PREFIX), policy);
        let remaining = env.as_contract(&engine_id, || env.storage().persistent().get_ttl(&key));
        assert!(
            remaining > 17_280,
            "policy TTL must outlive the old 24h window, got {remaining}"
        );
    }

    #[test]
    fn test_unknown_policy_is_not_compliant() {
        let env = Env::default();
        let f = setup(&env);
        f.verifier
            .issue_credential(&f.issuer, &f.subject, &kyc(&env), &1_000);
        assert!(!f
            .client
            .is_compliant(&f.subject, &Symbol::new(&env, "nonexistent")));
    }

    #[test]
    fn test_unset_verifier_fails_closed() {
        let env = Env::default();
        set_ledger(&env, 100);
        env.mock_all_auths();
        let engine_id = env.register_contract(None, ComplianceEngine);
        let client = ComplianceEngineClient::new(&env, &engine_id);
        let admin = Address::generate(&env);
        let subject = Address::generate(&env);
        let policy = Symbol::new(&env, "defi_pool");

        client.initialize(&admin);
        client.set_policy(&admin, &policy, &vec![&env, kyc(&env)]);

        assert!(!client.is_compliant(&subject, &policy));
        assert!(client.get_verifier().is_none());
    }

    #[test]
    fn test_policy_update_changes_evaluation() {
        let env = Env::default();
        let f = setup(&env);
        f.verifier
            .issue_credential(&f.issuer, &f.subject, &kyc(&env), &1_000);
        f.verifier
            .issue_credential(&f.issuer, &f.subject, &sanctions(&env), &1_000);
        assert!(f.client.is_compliant(&f.subject, &f.policy));
        assert_eq!(f.client.get_policy(&f.policy).version, 1);

        // Tighten the policy: a third attribute is now required.
        let extra = Symbol::new(&env, "accredited_investor");
        f.client.set_policy(
            &f.admin,
            &f.policy,
            &vec![&env, kyc(&env), sanctions(&env), extra.clone()],
        );

        assert_eq!(f.client.get_policy(&f.policy).version, 2);
        assert!(
            !f.client.is_compliant(&f.subject, &f.policy),
            "policy update must take effect immediately"
        );

        f.verifier
            .issue_credential(&f.issuer, &f.subject, &extra, &1_000);
        assert!(f.client.is_compliant(&f.subject, &f.policy));
    }

    #[test]
    fn test_revocation_and_expiry_flip_compliance() {
        let env = Env::default();
        let f = setup(&env);
        f.verifier
            .issue_credential(&f.issuer, &f.subject, &kyc(&env), &1_000);
        f.verifier
            .issue_credential(&f.issuer, &f.subject, &sanctions(&env), &1_000);
        assert!(f.client.is_compliant(&f.subject, &f.policy));

        f.verifier
            .revoke_credential(&f.issuer, &f.subject, &kyc(&env));
        assert!(!f.client.is_compliant(&f.subject, &f.policy));

        // A revocation is terminal (ACCEPTANCE-AUDIT.md H-1): the revoked slot can
        // never be re-issued, so expiry is exercised on a second subject instead.
        let other = Address::generate(&env);
        f.verifier
            .issue_credential(&f.issuer, &other, &kyc(&env), &1_000);
        f.verifier
            .issue_credential(&f.issuer, &other, &sanctions(&env), &1_000);
        assert!(f.client.is_compliant(&other, &f.policy));

        set_ledger(&env, 1_000);
        assert!(!f.client.is_compliant(&other, &f.policy));
    }

    #[test]
    fn test_export_attestation_reports_live_state() {
        let env = Env::default();
        let f = setup(&env);
        let before = f.client.export_attestation(&f.subject, &f.policy);
        assert!(!before.compliant);
        assert_eq!(before.policy_version, 1);
        assert_eq!(before.evaluated_at, env.ledger().sequence());

        f.verifier
            .issue_credential(&f.issuer, &f.subject, &kyc(&env), &1_000);
        f.verifier
            .issue_credential(&f.issuer, &f.subject, &sanctions(&env), &1_000);

        let after = f.client.export_attestation(&f.subject, &f.policy);
        assert!(after.compliant);
        assert_eq!(after.subject, f.subject);
        assert_eq!(after.policy, f.policy);
    }

    #[test]
    #[should_panic(expected = "caller is not the admin")]
    fn test_non_admin_cannot_set_policy() {
        let env = Env::default();
        let f = setup(&env);
        let attacker = Address::generate(&env);
        f.client.set_policy(
            &attacker,
            &Symbol::new(&env, "attacker"),
            &vec![&env, kyc(&env)],
        );
    }

    #[test]
    #[should_panic(expected = "policy must require at least one attribute")]
    fn test_empty_policy_rejected() {
        let env = Env::default();
        let f = setup(&env);
        f.client
            .set_policy(&f.admin, &Symbol::new(&env, "empty"), &Vec::new(&env));
    }

    #[test]
    #[should_panic(expected = "duplicate required attribute")]
    fn test_duplicate_policy_attribute_rejected() {
        let env = Env::default();
        let f = setup(&env);
        f.client.set_policy(
            &f.admin,
            &Symbol::new(&env, "dupes"),
            &vec![&env, kyc(&env), kyc(&env)],
        );
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_rejected() {
        let env = Env::default();
        let f = setup(&env);
        f.client.initialize(&Address::generate(&env));
    }

    #[test]
    fn test_subject_cannot_self_certify() {
        // Regression for AUDIT.md C-5: `set_compliance_status` let any address
        // mark any subject compliant. The setter no longer exists; compliance is
        // derived from credentials only.
        let env = Env::default();
        let f = setup(&env);
        assert!(!f.client.is_compliant(&f.subject, &f.policy));

        // There is no function on the client that can assert compliance, so the
        // strongest available check is that an uncredentialed subject stays
        // non-compliant across policy re-evaluation.
        f.client
            .set_policy(&f.admin, &f.policy, &vec![&env, kyc(&env)]);
        assert!(!f.client.is_compliant(&f.subject, &f.policy));
    }
}
