"use strict";

const { expect } = require("chai");
const { ethers } = require("hardhat");

const SUBJECT = "G" + "A".repeat(55); // 56-char Stellar strkey shape
const POLICY = "defi_pool";
const LEDGER = 100n;

function nonceFor(id) {
  return ethers.keccak256(ethers.toUtf8Bytes(id));
}

/**
 * Mirror of the on-chain digest. Non-packed encoding is required: with
 * `abi.encodePacked` two adjacent dynamic strings could be re-split into a
 * different (subject, policy) pair with identical bytes.
 */
function digestOf({ receiver, subject, policy, compliant, ledger, nonce, chainId }) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "string", "string", "bool", "uint256", "bytes32", "uint256"],
      [receiver, subject, policy, compliant, ledger, nonce, chainId]
    )
  );
}

/** Sign as the relayer would: EIP-191 over the 32-byte digest. */
function signAttestation(attestation, signer) {
  return signer.signMessage(ethers.getBytes(digestOf(attestation)));
}

async function deployReceiver({ expectedChainId, owner } = {}) {
  const [ownerSigner, relayer, other] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = expectedChainId ?? network.chainId;

  const factory = await ethers.getContractFactory("AttestationReceiver");
  const contract = await factory.deploy(owner ?? ownerSigner.address, chainId);
  await contract.waitForDeployment();

  return {
    contract,
    address: await contract.getAddress(),
    owner: ownerSigner,
    relayer,
    other,
    chainId,
    networkChainId: network.chainId,
  };
}

async function attestationFor(fixture, overrides = {}) {
  const attestation = {
    receiver: fixture.address,
    subject: SUBJECT,
    policy: POLICY,
    compliant: true,
    ledger: LEDGER,
    nonce: nonceFor("0000000100-0000000001"),
    chainId: fixture.chainId,
    ...overrides,
  };
  attestation.signature = await signAttestation(attestation, overrides.signer ?? fixture.relayer);
  return attestation;
}

function submit(contract, attestation) {
  return contract.receiveAttestation(
    attestation.subject,
    attestation.policy,
    attestation.compliant,
    attestation.ledger,
    attestation.nonce,
    attestation.signature
  );
}

describe("AttestationReceiver", () => {
  let fixture;

  beforeEach(async () => {
    fixture = await deployReceiver();
    await fixture.contract.setRelayer(fixture.relayer.address, true);
  });

  describe("deployment", () => {
    it("records the expected chain id and owner", async () => {
      expect(await fixture.contract.expectedChainId()).to.equal(fixture.chainId);
      expect(await fixture.contract.owner()).to.equal(fixture.owner.address);
    });

    it("rejects a zero expected chain id", async () => {
      const factory = await ethers.getContractFactory("AttestationReceiver");
      await expect(factory.deploy(fixture.owner.address, 0)).to.be.revertedWithCustomError(
        factory,
        "InvalidInput"
      );
    });

    it("rejects a zero owner", async () => {
      const factory = await ethers.getContractFactory("AttestationReceiver");
      await expect(
        factory.deploy(ethers.ZeroAddress, fixture.chainId)
      ).to.be.revertedWithCustomError(factory, "OwnableInvalidOwner");
    });
  });

  describe("relayer allowlist", () => {
    it("only the owner may allow or revoke a relayer", async () => {
      await expect(
        fixture.contract.connect(fixture.other).setRelayer(fixture.other.address, true)
      ).to.be.revertedWithCustomError(fixture.contract, "OwnableUnauthorizedAccount");
    });

    it("emits RelayerSet", async () => {
      await expect(fixture.contract.setRelayer(fixture.other.address, true))
        .to.emit(fixture.contract, "RelayerSet")
        .withArgs(fixture.other.address, true);
      expect(await fixture.contract.isRelayer(fixture.other.address)).to.equal(true);
    });

    it("rejects a revoked relayer's otherwise valid signature", async () => {
      const attestation = await attestationFor(fixture);

      await fixture.contract.setRelayer(fixture.relayer.address, false);

      await expect(submit(fixture.contract, attestation)).to.be.revertedWithCustomError(
        fixture.contract,
        "NotRelayer"
      );
    });

    it("rejects a signature from an address that was never allowlisted", async () => {
      const attestation = await attestationFor(fixture, { signer: fixture.other });

      await expect(submit(fixture.contract, attestation)).to.be.revertedWithCustomError(
        fixture.contract,
        "NotRelayer"
      );
    });
  });

  describe("accepting an attestation", () => {
    it("stores the result and emits AttestationReceived", async () => {
      const attestation = await attestationFor(fixture);
      const pair = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], [SUBJECT, POLICY])
      );

      await expect(submit(fixture.contract, attestation))
        .to.emit(fixture.contract, "AttestationReceived")
        .withArgs(
          fixture.relayer.address,
          SUBJECT,
          POLICY,
          true,
          LEDGER,
          attestation.nonce
        );

      expect(await fixture.contract.consumedNonce(attestation.nonce)).to.equal(true);
      expect(await fixture.contract.lastLedger(pair)).to.equal(LEDGER);
    });

    it("accepts a compliant=false attestation", async () => {
      const attestation = await attestationFor(fixture, { compliant: false });
      await expect(submit(fixture.contract, attestation)).to.emit(
        fixture.contract,
        "AttestationReceived"
      );
    });

    it("accepts a later attestation for the same pair with a new nonce", async () => {
      await submit(fixture.contract, await attestationFor(fixture));

      const next = await attestationFor(fixture, {
        ledger: LEDGER + 5n,
        nonce: nonceFor("event-2"),
      });
      await expect(submit(fixture.contract, next)).to.emit(
        fixture.contract,
        "AttestationReceived"
      );
    });

    it("accepts a second attestation at the same ledger with a new nonce", async () => {
      await submit(fixture.contract, await attestationFor(fixture));
      const sameLedger = await attestationFor(fixture, {
        nonce: nonceFor("event-same-ledger"),
      });
      await expect(submit(fixture.contract, sameLedger)).to.emit(
        fixture.contract,
        "AttestationReceived"
      );
    });
  });

  describe("replay protection", () => {
    it("rejects a consumed nonce", async () => {
      const attestation = await attestationFor(fixture);
      await submit(fixture.contract, attestation);

      await expect(submit(fixture.contract, attestation))
        .to.be.revertedWithCustomError(fixture.contract, "NonceAlreadyConsumed")
        .withArgs(attestation.nonce);
    });

    it("rejects a replay even when the payload claims a different policy", async () => {
      const attestation = await attestationFor(fixture);
      await submit(fixture.contract, attestation);

      // A different policy fails signature recovery too, but the nonce check runs
      // first, so the replay is rejected deterministically.
      await expect(
        submit(fixture.contract, { ...attestation, policy: "other_pool" })
      ).to.be.revertedWithCustomError(fixture.contract, "NonceAlreadyConsumed");
    });
  });

  describe("chain id binding", () => {
    it("reverts when the deployment's expected chain id does not match the chain", async () => {
      const mismatched = await deployReceiver({
        expectedChainId: (await ethers.provider.getNetwork()).chainId + 1n,
      });
      await mismatched.contract.setRelayer(mismatched.relayer.address, true);
      const attestation = await attestationFor(mismatched);

      await expect(submit(mismatched.contract, attestation))
        .to.be.revertedWithCustomError(mismatched.contract, "WrongChainId")
        .withArgs(await mismatched.contract.expectedChainId(), mismatched.networkChainId);
    });

    it("rejects a signature created for another chain id", async () => {
      const otherChain = await attestationFor(fixture, { chainId: fixture.chainId + 1n });

      // A well-formed signature over a different chain id recovers to some other
      // address, so it is rejected by the allowlist rather than by recovery.
      await expect(submit(fixture.contract, otherChain)).to.be.revertedWithCustomError(
        fixture.contract,
        "NotRelayer"
      );
    });
  });

  describe("freshness", () => {
    it("rejects a ledger older than the last one seen for the pair", async () => {
      await submit(fixture.contract, await attestationFor(fixture, { ledger: 100n }));

      const stale = await attestationFor(fixture, {
        ledger: 99n,
        nonce: nonceFor("older-event"),
      });

      await expect(submit(fixture.contract, stale))
        .to.be.revertedWithCustomError(fixture.contract, "StaleAttestation")
        .withArgs(99n, 100n);
    });

    it("tracks freshness independently per policy", async () => {
      await submit(fixture.contract, await attestationFor(fixture, { ledger: 100n }));

      const otherPolicy = await attestationFor(fixture, {
        policy: "payments",
        ledger: 50n,
        nonce: nonceFor("payments-event"),
      });

      await expect(submit(fixture.contract, otherPolicy)).to.emit(
        fixture.contract,
        "AttestationReceived"
      );
    });
  });

  describe("signature binding", () => {
    it("rejects a tampered compliance result", async () => {
      const attestation = await attestationFor(fixture, { compliant: true });
      await expect(
        submit(fixture.contract, { ...attestation, compliant: false })
      ).to.be.reverted;
    });

    it("rejects a tampered policy", async () => {
      const attestation = await attestationFor(fixture);
      await expect(
        submit(fixture.contract, { ...attestation, policy: "other_pool" })
      ).to.be.reverted;
    });

    it("rejects a tampered subject", async () => {
      const attestation = await attestationFor(fixture);
      await expect(
        submit(fixture.contract, { ...attestation, subject: "G" + "B".repeat(55) })
      ).to.be.reverted;
    });

    it("rejects a signature for a different receiver deployment", async () => {
      const second = await deployReceiver();
      await second.contract.setRelayer(second.relayer.address, true);

      // Signed for `fixture.address`, submitted to `second.address`.
      const attestation = await attestationFor(fixture);
      await expect(submit(second.contract, attestation)).to.be.reverted;
    });

    it("rejects a malformed signature", async () => {
      const attestation = await attestationFor(fixture);
      await expect(
        submit(fixture.contract, { ...attestation, signature: "0x1234" })
      ).to.be.revertedWithCustomError(fixture.contract, "InvalidSignature");
    });
  });

  describe("input validation", () => {
    it("rejects an empty or oversized subject", async () => {
      const empty = await attestationFor(fixture, { subject: "" });
      await expect(submit(fixture.contract, empty)).to.be.revertedWithCustomError(
        fixture.contract,
        "InvalidInput"
      );

      const oversized = await attestationFor(fixture, { subject: "G".repeat(129) });
      await expect(submit(fixture.contract, oversized)).to.be.revertedWithCustomError(
        fixture.contract,
        "InvalidInput"
      );
    });

    it("rejects an empty or oversized policy", async () => {
      const empty = await attestationFor(fixture, { policy: "" });
      await expect(submit(fixture.contract, empty)).to.be.revertedWithCustomError(
        fixture.contract,
        "InvalidInput"
      );

      const oversized = await attestationFor(fixture, { policy: "p".repeat(65) });
      await expect(submit(fixture.contract, oversized)).to.be.revertedWithCustomError(
        fixture.contract,
        "InvalidInput"
      );
    });
  });

  describe("ownership", () => {
    it("lets the new owner manage relayers after transfer", async () => {
      await fixture.contract.transferOwnership(fixture.other.address);

      await expect(
        fixture.contract.connect(fixture.owner).setRelayer(fixture.owner.address, true)
      ).to.be.revertedWithCustomError(fixture.contract, "OwnableUnauthorizedAccount");

      await fixture.contract.connect(fixture.other).setRelayer(fixture.other.address, true);
      expect(await fixture.contract.isRelayer(fixture.other.address)).to.equal(true);
    });
  });
});
