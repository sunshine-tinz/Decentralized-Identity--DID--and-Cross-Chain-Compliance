// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AttestationReceiver
 * @notice Receives, verifies, and stores cross-chain compliance attestations relayed from Stellar.
 *
 * Security properties:
 * - Uses EIP-712 typed-data signatures bound to block.chainid and address(this).
 * - Enforces EIP-2 low-s signature malleability protection and explicit custom errors.
 * - Rejects expired attestations and enforces single-use nonces.
 * - Enforces strictly monotonic Stellar ledger ordering per (subject, policy) so older
 *   attestations can never overwrite newer compliance or revocation states.
 * - Supports safe relayer rotation and two-step ownership transfer.
 */
contract AttestationReceiver {
    address public owner;
    address public pendingOwner;
    mapping(address => bool) public authorizedRelayers;
    mapping(bytes32 => bool) public consumedNonce;

    struct AttestationRecord {
        bool compliant;
        uint256 timestamp;
        uint64 stellarLedger;
        uint64 expiresAt;
        bool revoked;
    }

    // subject => policy => AttestationRecord
    mapping(address => mapping(string => AttestationRecord)) public attestations;

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant NAME_HASH = keccak256("StellarComplianceBridge");
    bytes32 public constant VERSION_HASH = keccak256("1");
    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256(
            "Attestation(address subject,string policy,bool compliant,uint64 stellarLedger,uint64 expiresAt,bytes32 nonce)"
        );

    uint256 internal constant SECP256K1N_HALF =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    event RelayerUpdated(address indexed relayer, bool authorized);
    event RelayerRotated(address indexed oldRelayer, address indexed newRelayer);
    event AttestationReceived(
        address indexed subject,
        string indexed policy,
        bool compliant,
        uint64 stellarLedger,
        uint64 expiresAt,
        bytes32 nonce,
        address indexed relayer
    );
    event AttestationRevoked(
        address indexed subject,
        string indexed policy,
        uint64 stellarLedger,
        address indexed actor
    );
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error UnauthorizedCaller();
    error UnauthorizedRelayer(address relayer);
    error NonceAlreadyConsumed(bytes32 nonce);
    error InvalidSignature();
    error InvalidSubject();
    error InvalidRelayer();
    error EmptyPolicy();
    error InvalidLedger();
    error AttestationExpired(uint64 expiresAt, uint256 currentTimestamp);
    error StaleAttestation(uint64 providedLedger, uint64 latestLedger);

    modifier onlyOwner() {
        if (msg.sender != owner) revert UnauthorizedCaller();
        _;
    }

    modifier onlyOwnerOrRelayer() {
        if (msg.sender != owner && !authorizedRelayers[msg.sender]) {
            revert UnauthorizedCaller();
        }
        _;
    }

    constructor(address _initialRelayer) {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        if (_initialRelayer != address(0)) {
            authorizedRelayers[_initialRelayer] = true;
            emit RelayerUpdated(_initialRelayer, true);
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidSubject();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert UnauthorizedCaller();
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        if (relayer == address(0)) revert InvalidRelayer();
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    function rotateRelayer(address oldRelayer, address newRelayer) external onlyOwner {
        if (oldRelayer == address(0) || newRelayer == address(0) || oldRelayer == newRelayer) {
            revert InvalidRelayer();
        }
        if (!authorizedRelayers[oldRelayer]) revert UnauthorizedRelayer(oldRelayer);

        authorizedRelayers[oldRelayer] = false;
        authorizedRelayers[newRelayer] = true;
        emit RelayerUpdated(oldRelayer, false);
        emit RelayerUpdated(newRelayer, true);
        emit RelayerRotated(oldRelayer, newRelayer);
    }

    function domainSeparator() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
            );
    }

    function hashAttestation(
        address subject,
        string calldata policy,
        bool compliant,
        uint64 stellarLedger,
        uint64 expiresAt,
        bytes32 nonce
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ATTESTATION_TYPEHASH,
                subject,
                keccak256(bytes(policy)),
                compliant,
                stellarLedger,
                expiresAt,
                nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function isCompliant(address subject, string calldata policy) external view returns (bool) {
        AttestationRecord storage record = attestations[subject][policy];
        if (!record.compliant || record.revoked) return false;
        if (record.expiresAt <= block.timestamp) return false;
        return true;
    }

    /**
     * @notice Receive, verify, and store a cross-chain compliance attestation.
     */
    function receiveAttestation(
        address subject,
        string calldata policy,
        bool compliant,
        uint64 stellarLedger,
        uint64 expiresAt,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (subject == address(0)) revert InvalidSubject();
        if (bytes(policy).length == 0) revert EmptyPolicy();
        if (stellarLedger == 0) revert InvalidLedger();
        if (expiresAt <= block.timestamp) revert AttestationExpired(expiresAt, block.timestamp);
        if (consumedNonce[nonce]) revert NonceAlreadyConsumed(nonce);

        AttestationRecord storage existing = attestations[subject][policy];
        if (stellarLedger <= existing.stellarLedger) {
            revert StaleAttestation(stellarLedger, existing.stellarLedger);
        }

        bytes32 digest = hashAttestation(subject, policy, compliant, stellarLedger, expiresAt, nonce);
        address signer = recoverSigner(digest, signature);

        if (!authorizedRelayers[signer]) {
            revert UnauthorizedRelayer(signer);
        }

        consumedNonce[nonce] = true;
        attestations[subject][policy] = AttestationRecord({
            compliant: compliant,
            timestamp: block.timestamp,
            stellarLedger: stellarLedger,
            expiresAt: expiresAt,
            revoked: !compliant
        });

        emit AttestationReceived(subject, policy, compliant, stellarLedger, expiresAt, nonce, signer);
        if (!compliant) {
            emit AttestationRevoked(subject, policy, stellarLedger, signer);
        }
    }

    /**
     * @notice Explicitly revoke an attestation record with monotonic ledger ordering.
     */
    function revokeAttestation(
        address subject,
        string calldata policy,
        uint64 stellarLedger
    ) external onlyOwnerOrRelayer {
        if (subject == address(0)) revert InvalidSubject();
        if (bytes(policy).length == 0) revert EmptyPolicy();

        AttestationRecord storage existing = attestations[subject][policy];
        uint64 effectiveLedger = stellarLedger;
        if (effectiveLedger == 0) {
            effectiveLedger = existing.stellarLedger + 1;
        } else if (effectiveLedger <= existing.stellarLedger) {
            revert StaleAttestation(effectiveLedger, existing.stellarLedger);
        }

        attestations[subject][policy] = AttestationRecord({
            compliant: false,
            timestamp: block.timestamp,
            stellarLedger: effectiveLedger,
            expiresAt: existing.expiresAt,
            revoked: true
        });

        emit AttestationRevoked(subject, policy, effectiveLedger, msg.sender);
    }

    /**
     * @notice Recover signer from an EIP-712 digest with strict EIP-2 low-s enforcement.
     */
    function recoverSigner(bytes32 digest, bytes memory signature) public pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();
        if (uint256(s) > SECP256K1N_HALF) revert InvalidSignature();

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }
}
