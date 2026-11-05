// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title AttestationReceiver
/// @notice Destination for compliance attestations relayed from Stellar.
///
/// The Stellar-side bridge (`services/cross-chain-bridge`) signs an EIP-191
/// message over:
///
///   keccak256(abi.encode(
///     address(this), subject, policy, compliant, ledger, nonce, chainId))
///
/// `subject` is a Stellar strkey carried as a string (no Stellar address is a
/// valid EVM address). `nonce` is `keccak256(utf8(stellarEventId))`. Binding the
/// receiver address and chain id prevents a signature issued for one deployment
/// or network from being replayed on another; the nonce prevents replay on this
/// deployment.
///
/// The contract is deliberately policy-free: it records that an allowlisted
/// relayer asserted a compliance result, and leaves interpretation to the
/// integrating protocol. It does not verify Stellar ledger finality, because
/// that would require an oracle; it rejects ledgers older than the last one seen
/// for the same `(subject, policy)` pair so an old result cannot overwrite a new
/// one.
contract AttestationReceiver is Ownable {
    /// @notice Chain this instance accepts attestations for.
    uint256 public immutable expectedChainId;

    /// @notice Addresses permitted to submit attestations.
    mapping(address relayer => bool allowed) public isRelayer;

    /// @notice Nonces already relayed; a nonce can be consumed once.
    mapping(bytes32 nonce => bool consumed) public consumedNonce;

    /// @notice Highest Stellar ledger relayed for each subject/policy pair.
    mapping(bytes32 subjectPolicy => uint256 ledger) public lastLedger;

    /// @notice Maximum accepted length of the Stellar subject string.
    uint256 public constant MAX_SUBJECT_BYTES = 128;
    /// @notice Maximum accepted length of the policy symbol.
    uint256 public constant MAX_POLICY_BYTES = 64;

    event RelayerSet(address indexed relayer, bool allowed);

    event AttestationReceived(
        address indexed relayer,
        string subject,
        string policy,
        bool compliant,
        uint256 ledger,
        bytes32 nonce
    );

    error InvalidInput();
    error NotRelayer();
    error WrongChainId(uint256 expected, uint256 actual);
    error NonceAlreadyConsumed(bytes32 nonce);
    error StaleAttestation(uint256 provided, uint256 previous);
    error InvalidSignature();

    /// @param initialOwner Owner allowed to manage relayers.
    /// @param expectedChainId_ Chain id this deployment accepts. Pass
    ///        `block.chainid` in the deploy script; any other value makes every
    ///        attestation revert with `WrongChainId`.
    constructor(address initialOwner, uint256 expectedChainId_) Ownable(initialOwner) {
        if (expectedChainId_ == 0) revert InvalidInput();
        expectedChainId = expectedChainId_;
    }

    /// @notice Allow or revoke a relayer.
    function setRelayer(address relayer, bool allowed) external onlyOwner {
        if (relayer == address(0)) revert InvalidInput();
        isRelayer[relayer] = allowed;
        emit RelayerSet(relayer, allowed);
    }

    /// @notice Submit a relayed compliance attestation.
    /// @param subject Stellar strkey of the attested subject.
    /// @param policy Policy symbol evaluated on Stellar.
    /// @param compliant Result asserted by the relayer.
    /// @param ledger Stellar ledger the attestation was observed at.
    /// @param nonce Unique value derived from the Stellar event id.
    /// @param signature EIP-191 signature by an allowlisted relayer.
    function receiveAttestation(
        string calldata subject,
        string calldata policy,
        bool compliant,
        uint256 ledger,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (block.chainid != expectedChainId) {
            revert WrongChainId(expectedChainId, block.chainid);
        }

        _revertIfInvalidInput(subject, policy);
        if (consumedNonce[nonce]) revert NonceAlreadyConsumed(nonce);

        bytes32 pair = keccak256(abi.encode(subject, policy));
        uint256 previous = lastLedger[pair];
        if (ledger < previous) revert StaleAttestation(ledger, previous);

        address signer = _recoverRelayer(subject, policy, compliant, ledger, nonce, signature);

        consumedNonce[nonce] = true;
        lastLedger[pair] = ledger;

        emit AttestationReceived(signer, subject, policy, compliant, ledger, nonce);
    }

    function _revertIfInvalidInput(string calldata subject, string calldata policy) private pure {
        uint256 subjectLength = bytes(subject).length;
        uint256 policyLength = bytes(policy).length;
        if (subjectLength == 0 || subjectLength > MAX_SUBJECT_BYTES) revert InvalidInput();
        if (policyLength == 0 || policyLength > MAX_POLICY_BYTES) revert InvalidInput();
    }

    /// @dev Recover the signer and require it to be an allowlisted relayer.
    /// `abi.encode` (not `encodePacked`) so adjacent dynamic strings cannot be
    /// re-split into a different subject/policy pair with the same bytes.
    function _recoverRelayer(
        string calldata subject,
        string calldata policy,
        bool compliant,
        uint256 ledger,
        bytes32 nonce,
        bytes calldata signature
    ) private view returns (address) {
        bytes32 digest = keccak256(
            abi.encode(address(this), subject, policy, compliant, ledger, nonce, expectedChainId)
        );
        (address signer, ECDSA.RecoverError err, ) =
            ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(digest), signature);
        if (err != ECDSA.RecoverError.NoError || signer == address(0)) revert InvalidSignature();
        if (!isRelayer[signer]) revert NotRelayer();
        return signer;
    }
}
