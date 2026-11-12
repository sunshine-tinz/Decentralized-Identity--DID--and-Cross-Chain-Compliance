// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../AttestationReceiver.sol";

interface Vm {
    function addr(uint256 privateKey) external pure returns (address);
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address msgSender) external;
    function warp(uint256 newTimestamp) external;
    function chainId(uint256 newChainId) external;
    function expectRevert(bytes4 revertSelector) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert() external;
}

contract AttestationReceiverTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant OWNER_PK = 0x1111;
    uint256 internal constant RELAYER_PK = 0x2222;
    uint256 internal constant RELAYER2_PK = 0x3333;
    uint256 internal constant ATTACKER_PK = 0x4444;

    uint256 internal constant SECP256K1N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    AttestationReceiver internal receiver;
    address internal owner;
    address internal relayer;
    address internal relayer2;
    address internal attacker;
    address internal subject = address(0xBEEF);

    function setUp() public {
        owner = vm.addr(OWNER_PK);
        relayer = vm.addr(RELAYER_PK);
        relayer2 = vm.addr(RELAYER2_PK);
        attacker = vm.addr(ATTACKER_PK);

        vm.warp(1_700_000_000);
        vm.prank(owner);
        receiver = new AttestationReceiver(relayer);
    }

    function _signAttestation(
        AttestationReceiver target,
        uint256 pk,
        address subj,
        string memory policy,
        bool compliant,
        uint64 ledger,
        uint64 expiresAt,
        bytes32 nonce
    ) internal view returns (bytes memory) {
        bytes32 digest = target.hashAttestation(subj, policy, compliant, ledger, expiresAt, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function testValidAttestationUpdatesCompliance() public {
        bytes32 nonce = keccak256("stellar-event-1");
        uint64 expiry = uint64(block.timestamp + 3600);
        bytes memory sig = _signAttestation(receiver, RELAYER_PK, subject, "defi_pool", true, 100, expiry, nonce);

        receiver.receiveAttestation(subject, "defi_pool", true, 100, expiry, nonce, sig);

        require(receiver.isCompliant(subject, "defi_pool"), "expected subject compliant");
        require(receiver.consumedNonce(nonce), "expected nonce consumed");
    }

    function testRejectsUnauthorizedRelayer() public {
        bytes32 nonce = keccak256("stellar-event-2");
        uint64 expiry = uint64(block.timestamp + 3600);
        bytes memory sig = _signAttestation(receiver, ATTACKER_PK, subject, "defi_pool", true, 100, expiry, nonce);

        vm.expectRevert(abi.encodeWithSelector(AttestationReceiver.UnauthorizedRelayer.selector, attacker));
        receiver.receiveAttestation(subject, "defi_pool", true, 100, expiry, nonce, sig);
    }

    function testRejectsMalformedAndHighSSignature() public {
        bytes32 nonce = keccak256("stellar-event-3");
        uint64 expiry = uint64(block.timestamp + 3600);

        // Wrong length
        vm.expectRevert(AttestationReceiver.InvalidSignature.selector);
        receiver.receiveAttestation(subject, "defi_pool", true, 100, expiry, nonce, hex"1234");

        // Malleable high-s signature
        bytes32 digest = receiver.hashAttestation(subject, "defi_pool", true, 100, expiry, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(RELAYER_PK, digest);
        uint8 flippedV = v == 27 ? 28 : 27;
        bytes32 highS = bytes32(SECP256K1N - uint256(s));
        bytes memory malleableSig = abi.encodePacked(r, highS, flippedV);

        vm.expectRevert(AttestationReceiver.InvalidSignature.selector);
        receiver.receiveAttestation(subject, "defi_pool", true, 100, expiry, nonce, malleableSig);
    }

    function testRejectsNonceReplay() public {
        bytes32 nonce = keccak256("stellar-event-4");
        uint64 expiry = uint64(block.timestamp + 3600);
        bytes memory sig = _signAttestation(receiver, RELAYER_PK, subject, "defi_pool", true, 100, expiry, nonce);

        receiver.receiveAttestation(subject, "defi_pool", true, 100, expiry, nonce, sig);

        vm.expectRevert(abi.encodeWithSelector(AttestationReceiver.NonceAlreadyConsumed.selector, nonce));
        receiver.receiveAttestation(subject, "defi_pool", true, 100, expiry, nonce, sig);
    }

    function testRejectsCrossChainAndCrossContractReplay() public {
        bytes32 nonce = keccak256("stellar-event-5");
        uint64 expiry = uint64(block.timestamp + 3600);
        bytes memory sig = _signAttestation(receiver, RELAYER_PK, subject, "defi_pool", true, 100, expiry, nonce);

        // Cross-chain replay
        uint256 originalChain = block.chainid;
        vm.chainId(1);
        vm.expectRevert();
        receiver.receiveAttestation(subject, "defi_pool", true, 100, expiry, nonce, sig);
        vm.chainId(originalChain);

        // Cross-contract replay
        vm.prank(owner);
        AttestationReceiver otherReceiver = new AttestationReceiver(relayer);
        vm.expectRevert();
        otherReceiver.receiveAttestation(subject, "defi_pool", true, 100, expiry, nonce, sig);
    }

    function testRejectsExpiredAttestationAndEnforcesRuntimeExpiry() public {
        bytes32 nonce = keccak256("stellar-event-6");
        uint64 pastExpiry = uint64(block.timestamp - 1);
        bytes memory pastSig = _signAttestation(receiver, RELAYER_PK, subject, "defi_pool", true, 100, pastExpiry, nonce);

        vm.expectRevert(
            abi.encodeWithSelector(AttestationReceiver.AttestationExpired.selector, pastExpiry, block.timestamp)
        );
        receiver.receiveAttestation(subject, "defi_pool", true, 100, pastExpiry, nonce, pastSig);

        // Valid now, expires after warp
        bytes32 nonce2 = keccak256("stellar-event-7");
        uint64 soonExpiry = uint64(block.timestamp + 60);
        bytes memory sig2 = _signAttestation(receiver, RELAYER_PK, subject, "defi_pool", true, 101, soonExpiry, nonce2);
        receiver.receiveAttestation(subject, "defi_pool", true, 101, soonExpiry, nonce2, sig2);
        require(receiver.isCompliant(subject, "defi_pool"), "should be compliant before expiry");

        vm.warp(soonExpiry);
        require(!receiver.isCompliant(subject, "defi_pool"), "should expire at expiresAt");
    }

    function testRejectsStaleAttestationAfterRevocationOrNewerLedger() public {
        uint64 expiry = uint64(block.timestamp + 3600);

        // Older attestation (ledger 100) signed before revocation
        bytes32 staleNonce = keccak256("stellar-event-stale");
        bytes memory staleSig = _signAttestation(
            receiver, RELAYER_PK, subject, "defi_pool", true, 100, expiry, staleNonce
        );

        // Newer revocation at ledger 150 arrives first
        bytes32 revokeNonce = keccak256("stellar-event-revoke");
        bytes memory revokeSig = _signAttestation(
            receiver, RELAYER_PK, subject, "defi_pool", false, 150, expiry, revokeNonce
        );
        receiver.receiveAttestation(subject, "defi_pool", false, 150, expiry, revokeNonce, revokeSig);
        require(!receiver.isCompliant(subject, "defi_pool"), "revoked subject must not be compliant");

        // Submitting older ledger 100 compliant=true attestation MUST fail
        vm.expectRevert(abi.encodeWithSelector(AttestationReceiver.StaleAttestation.selector, uint64(100), uint64(150)));
        receiver.receiveAttestation(subject, "defi_pool", true, 100, expiry, staleNonce, staleSig);
        require(!receiver.isCompliant(subject, "defi_pool"), "stale attestation must not overwrite revocation");
    }

    function testExplicitRevocationAndUnauthorizedRevokeRejected() public {
        bytes32 nonce = keccak256("stellar-event-8");
        uint64 expiry = uint64(block.timestamp + 3600);
        bytes memory sig = _signAttestation(receiver, RELAYER_PK, subject, "defi_pool", true, 200, expiry, nonce);
        receiver.receiveAttestation(subject, "defi_pool", true, 200, expiry, nonce, sig);
        require(receiver.isCompliant(subject, "defi_pool"), "expected compliant");

        vm.prank(attacker);
        vm.expectRevert(AttestationReceiver.UnauthorizedCaller.selector);
        receiver.revokeAttestation(subject, "defi_pool", 201);

        vm.prank(relayer);
        receiver.revokeAttestation(subject, "defi_pool", 201);
        require(!receiver.isCompliant(subject, "defi_pool"), "expected non-compliant after revoke");
    }

    function testRelayerRotationAndTwoStepOwnership() public {
        vm.prank(attacker);
        vm.expectRevert(AttestationReceiver.UnauthorizedCaller.selector);
        receiver.rotateRelayer(relayer, relayer2);

        vm.prank(owner);
        receiver.rotateRelayer(relayer, relayer2);
        require(!receiver.authorizedRelayers(relayer), "old relayer should be revoked");
        require(receiver.authorizedRelayers(relayer2), "new relayer should be authorized");

        // Old relayer signature now rejected
        bytes32 nonceOld = keccak256("stellar-event-old-relayer");
        uint64 expiry = uint64(block.timestamp + 3600);
        bytes memory oldSig = _signAttestation(receiver, RELAYER_PK, subject, "defi_pool", true, 300, expiry, nonceOld);
        vm.expectRevert(abi.encodeWithSelector(AttestationReceiver.UnauthorizedRelayer.selector, relayer));
        receiver.receiveAttestation(subject, "defi_pool", true, 300, expiry, nonceOld, oldSig);

        // New relayer signature accepted
        bytes32 nonceNew = keccak256("stellar-event-new-relayer");
        bytes memory newSig = _signAttestation(receiver, RELAYER2_PK, subject, "defi_pool", true, 300, expiry, nonceNew);
        receiver.receiveAttestation(subject, "defi_pool", true, 300, expiry, nonceNew, newSig);
        require(receiver.isCompliant(subject, "defi_pool"), "new relayer attestation should succeed");

        // 2-step ownership transfer
        vm.prank(owner);
        receiver.transferOwnership(relayer2);
        vm.prank(attacker);
        vm.expectRevert(AttestationReceiver.UnauthorizedCaller.selector);
        receiver.acceptOwnership();
        vm.prank(relayer2);
        receiver.acceptOwnership();
        require(receiver.owner() == relayer2, "owner should transfer after acceptance");
    }

    function testRejectsZeroSubjectEmptyPolicyAndZeroLedger() public {
        bytes32 nonce = keccak256("stellar-event-invalid");
        uint64 expiry = uint64(block.timestamp + 3600);
        bytes memory sig = hex"";

        vm.expectRevert(AttestationReceiver.InvalidSubject.selector);
        receiver.receiveAttestation(address(0), "defi_pool", true, 1, expiry, nonce, sig);

        vm.expectRevert(AttestationReceiver.EmptyPolicy.selector);
        receiver.receiveAttestation(subject, "", true, 1, expiry, nonce, sig);

        vm.expectRevert(AttestationReceiver.InvalidLedger.selector);
        receiver.receiveAttestation(subject, "defi_pool", true, 0, expiry, nonce, sig);
    }
}
