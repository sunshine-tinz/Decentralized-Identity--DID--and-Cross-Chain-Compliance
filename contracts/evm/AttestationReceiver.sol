// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AttestationReceiver
 * @notice Receives, verifies, and stores cross-chain compliance attestations relayed from Stellar.
 *
 * Verifies EIP-191 personal signatures from authorized relayers, binds attestations to the
 * chainId to prevent cross-chain replays, and tracks unique nonces to prevent replay attacks.
 */
contract AttestationReceiver {
    address public owner;
    mapping(address => bool) public authorizedRelayers;
    mapping(bytes32 => bool) public consumedNonce;

    struct AttestationRecord {
        bool compliant;
        uint256 timestamp;
        uint256 ledger;
    }

    // subject => policy => AttestationRecord
    mapping(address => mapping(string => AttestationRecord)) public attestations;

    event RelayerUpdated(address indexed relayer, bool authorized);
    event AttestationReceived(
        address indexed subject,
        string indexed policy,
        bool compliant,
        bytes32 nonce,
        address relayer
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error UnauthorizedCaller();
    error UnauthorizedRelayer(address relayer);
    error NonceAlreadyConsumed(bytes32 nonce);
    error InvalidSignature();
    error InvalidSubject();
    error EmptyPolicy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert UnauthorizedCaller();
        _;
    }

    constructor(address _initialRelayer) {
        owner = msg.sender;
        if (_initialRelayer != address(0)) {
            authorizedRelayers[_initialRelayer] = true;
            emit RelayerUpdated(_initialRelayer, true);
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidSubject();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        if (relayer == address(0)) revert InvalidSubject();
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    function isCompliant(address subject, string calldata policy) external view returns (bool) {
        return attestations[subject][policy].compliant;
    }

    /**
     * @notice Receive and verify a compliance attestation.
     * @param subject The EVM address of the subject.
     * @param policy The compliance policy name.
     * @param compliant Whether the subject is compliant.
     * @param nonce The unique nonce derived from Stellar event ID.
     * @param signature The EIP-191 signature signed by an authorized relayer.
     */
    function receiveAttestation(
        address subject,
        string calldata policy,
        bool compliant,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (subject == address(0)) revert InvalidSubject();
        if (bytes(policy).length == 0) revert EmptyPolicy();
        if (consumedNonce[nonce]) revert NonceAlreadyConsumed(nonce);

        bytes32 digest = keccak256(
            abi.encodePacked(subject, policy, compliant, nonce, block.chainid, address(this))
        );
        address signer = recoverSigner(digest, signature);

        if (!authorizedRelayers[signer]) {
            revert UnauthorizedRelayer(signer);
        }

        consumedNonce[nonce] = true;
        attestations[subject][policy] = AttestationRecord({
            compliant: compliant,
            timestamp: block.timestamp,
            ledger: 0
        });

        emit AttestationReceived(subject, policy, compliant, nonce, signer);
    }

    /**
     * @notice Recover signer from an EIP-191 formatted message hash.
     */
    function recoverSigner(bytes32 messageHash, bytes memory signature) public pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(ethSignedMessageHash, v, r, s);
    }
}
