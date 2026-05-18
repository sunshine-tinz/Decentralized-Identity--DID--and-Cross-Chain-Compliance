//! Compliance Engine Contract
//!
//! Enforces configurable KYC/AML policy rules on-chain.
//! Inspired by Chainlink ACE's modular compliance framework, adapted for Stellar.
//!
//! # Concepts
//! - **Policy**: a named set of required attributes (e.g. "defi_pool" requires
//!   ["kyc_passed", "not_sanctioned"]).
//! - **Compliance status**: per-address boolean derived from VC Verifier proofs.
//! - **Cross-chain export**: a signed compliance attestation that can be relayed
//!   to EVM chains via the cross-chain bridge service.
//!
//! # TODO for contributors
//! - [ ] Call VCVerifier contract cross-contract to check live proof status
//! - [ ] Add AML transaction monitoring hooks (off-chain oracle integration)
//! - [ ] Implement sanctions list oracle (Chainalysis / TRM Labs adapter)
//! - [ ] Add time-bounded compliance windows (re-KYC after N ledgers)
//! - [ ] Emit cross-chain attestation events for the bridge service to relay

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, Map, Symbol, Vec,
};

// ── Data types ────────────────────────────────────────────────────────────────

/// A compliance policy: a named list of required credential attributes.
#[contracttype]
#[derive(Clone)]
pub struct Policy {
    pub name: Symbol,
    /// Attribute symbols that must all be proven (e.g. "kyc_passed")
    pub required_attributes: Vec<Symbol>,
}

/// Compliance status for a single address under a specific policy.
#[contracttype]
#[derive(Clone)]
pub struct ComplianceStatus {
    pub address: Address,
    pub policy: Symbol,
    pub compliant: bool,
    /// Ledger sequence when this status was last evaluated
    pub evaluated_at: u32,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

const ADMIN_KEY: &str = "ADMIN";
const POLICY_PREFIX: &str = "POL";
const STATUS_PREFIX: &str = "STAT";

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct ComplianceEngine;

#[contractimpl]
impl ComplianceEngine {
    /// One-time initialisation.
    pub fn initialize(env: Env, admin: Address) {
        let key = Symbol::new(&env, ADMIN_KEY);
        if env.storage().instance().has(&key) {
            panic!("already initialized");
        }
        env.storage().instance().set(&key, &admin);
    }

    /// Admin creates or updates a compliance policy.
    ///
    /// # Example
    /// ```
    /// engine.set_policy("defi_pool", vec!["kyc_passed", "not_sanctioned"])
    /// ```
    pub fn set_policy(env: Env, name: Symbol, required_attributes: Vec<Symbol>) {
        Self::require_admin(&env);
        let key = (Symbol::new(&env, POLICY_PREFIX), name.clone());
        env.storage().persistent().set(
            &key,
            &Policy {
                name,
                required_attributes,
            },
        );
    }

    /// Record that `subject` is compliant under `policy`.
    ///
    /// In production this should be called by the VCVerifier contract
    /// (cross-contract call) after a successful ring-signature proof,
    /// not by an EOA directly.
    ///
    /// # TODO
    /// Replace manual call with cross-contract invocation from VCVerifier.
    pub fn set_compliance_status(
        env: Env,
        caller: Address,
        subject: Address,
        policy: Symbol,
        compliant: bool,
    ) {
        caller.require_auth();
        // TODO: verify caller is the VCVerifier contract address

        let key = (
            Symbol::new(&env, STATUS_PREFIX),
            subject.clone(),
            policy.clone(),
        );
        env.storage().persistent().set(
            &key,
            &ComplianceStatus {
                address: subject,
                policy,
                compliant,
                evaluated_at: env.ledger().sequence(),
            },
        );
    }

    /// Check whether `subject` is compliant under `policy`.
    /// Returns `false` if no status has been recorded.
    pub fn is_compliant(env: Env, subject: Address, policy: Symbol) -> bool {
        let key = (
            Symbol::new(&env, STATUS_PREFIX),
            subject,
            policy,
        );
        env.storage()
            .persistent()
            .get::<_, ComplianceStatus>(&key)
            .map(|s| s.compliant)
            .unwrap_or(false)
    }

    /// Returns the policy definition.
    pub fn get_policy(env: Env, name: Symbol) -> Policy {
        let key = (Symbol::new(&env, POLICY_PREFIX), name);
        env.storage()
            .persistent()
            .get(&key)
            .expect("policy not found")
    }

    /// Produce a cross-chain attestation payload for the bridge service.
    ///
    /// The bridge service signs this payload and relays it to the target EVM chain.
    ///
    /// # TODO
    /// - Sign with a Stellar keypair so the EVM verifier can authenticate it
    /// - Add destination chain ID and target contract address
    pub fn export_attestation(env: Env, subject: Address, policy: Symbol) -> Map<Symbol, bool> {
        let compliant = Self::is_compliant(env.clone(), subject, policy.clone());
        let mut result = Map::new(&env);
        result.set(policy, compliant);
        result
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
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env};

    #[test]
    fn test_policy_and_compliance() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ComplianceEngine);
        let client = ComplianceEngineClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let policy_name = Symbol::new(&env, "defi_pool");
        let attrs = vec![
            &env,
            Symbol::new(&env, "kyc_passed"),
            Symbol::new(&env, "not_sanctioned"),
        ];
        client.set_policy(&policy_name, &attrs);

        let subject = Address::generate(&env);
        assert!(!client.is_compliant(&subject, &policy_name));

        client.set_compliance_status(&admin, &subject, &policy_name, &true);
        assert!(client.is_compliant(&subject, &policy_name));
    }
}
