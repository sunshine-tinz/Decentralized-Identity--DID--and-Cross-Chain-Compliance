# EVM Destination Receiver Security & Cryptographic Verification

**Contract:** [`contracts/evm/AttestationReceiver.sol`](contracts/evm/AttestationReceiver.sol)  
**Relayer:** [`services/cross-chain-bridge/src/lib/evmRelayer.js`](services/cross-chain-bridge/src/lib/evmRelayer.js)  
**Compiler:** Solidity `0.8.20`  
**Test Suite:** [`services/cross-chain-bridge/__tests__/receiver.test.js`](services/cross-chain-bridge/__tests__/receiver.test.js) (20 tests passing)  
**Verification Date:** November 5, 2026  

---

## 1. Cryptographic Digest & Signature Construction

The bridge signs and the destination contract verifies an EIP-191 personal signature over a 6-parameter packed hash:

$$\text{digest} = \text{keccak256}(\text{abi.encodePacked}(\text{subject}, \text{policy}, \text{compliant}, \text{nonce}, \text{block.chainid}, \text{address}(\text{this})))$$

$$\text{ethSignedMessageHash} = \text{keccak256}(\text{abi.encodePacked}(\text{"\\x19Ethereum Signed Message:\\n32"}, \text{digest}))$$

$$\text{signer} = \text{ecrecover}(\text{ethSignedMessageHash}, v, r, s)$$

### Security Properties Established:
- **Chain Separation**: Binding `block.chainid` prevents an attestation created for one EVM network (e.g. Sepolia testnet) from being replayed on another (e.g. Ethereum Mainnet).
- **Contract Separation**: Binding `address(this)` prevents an attestation intended for one receiver contract (e.g. Protocol A) from being presented to another contract (Protocol B) on the same chain.
- **Single-Use Replay Prevention**: The `nonce` is derived from the canonical Stellar event ID (`keccak256(toUtf8Bytes(eventId))`). The contract records consumed nonces in a persistent mapping `consumedNonce[nonce] = true`.

---

## 2. Independent Threat Modeling & Attack Verification Matrix

| Attack Vector / Security Property | Mitigation in Code | Verification Result |
| :--- | :--- | :--- |
| **1. Authorized Relayer Submission** | Contract checks `authorizedRelayers[signer]`. If true, stores attestation. | **PASS** — Verified relayer recovers correctly and updates `attestations[subject][policy]`. |
| **2. Unauthorized Relayer Rejection** | Private key not in `authorizedRelayers` produces unapproved `signer`. Reverts with `UnauthorizedRelayer(signer)`. | **PASS** — Tested with non-allowlisted keypair; reverts immediately. |
| **3. Invalid / Corrupted Signatures** | `recoverSigner` validates length (65 bytes), canonical $v \in \{27, 28\}$, and handles EC point failures. | **PASS** — Tested malformed lengths and altered $r$ bytes; rejected. |
| **4. Duplicate Nonce Replay** | `require(!consumedNonce[nonce])`. Set to `true` on first processing. | **PASS** — Second presentation reverts with `NonceAlreadyConsumed(nonce)`. |
| **5. Cross-Chain Replay** | Signed digest embeds `block.chainid`. Changing chainId alters the digest, recovering an arbitrary address. | **PASS** — Signature for Sepolia (`11155111`) submitted to Mainnet (`1`) rejected. |
| **6. Cross-Contract Replay** | Signed digest embeds `address(this)`. Changing destination contract alters digest, recovering an arbitrary address. | **PASS** — Signature for Receiver A submitted to Receiver B rejected. |
| **7. Payload Tampering** | Subject, policy string, or boolean compliance flag alterations break digest preimage. | **PASS** — Modifying subject or policy alters recovered signer, reverting. |
| **8. Access Control & Signer Rotation** | `setRelayer` and `transferOwnership` protected by `onlyOwner` modifier. | **PASS** — Non-owner calls revert with `UnauthorizedCaller()`. |

---

## 3. Relayer Rotation & Lifecycle Governance

```solidity
function setRelayer(address relayer, bool authorized) external onlyOwner {
    if (relayer == address(0)) revert InvalidSubject();
    authorizedRelayers[relayer] = authorized;
    emit RelayerUpdated(relayer, authorized);
}

function transferOwnership(address newOwner) external onlyOwner {
    if (newOwner == address(0)) revert InvalidSubject();
    emit OwnershipTransferred(owner, newOwner);
    owner = newOwner;
}
```
- **Compromised Relayer Key**: If a relayer key is leaked, the contract owner immediately invokes `setRelayer(compromisedKey, false)` to disable it.
- **Safe Signer Rotation**: Multiple relayers can be authorized concurrently to allow zero-downtime rotation.
- **Zero Address Guard**: Both `newOwner` and `relayer` reject `address(0)`.

---

## 4. Cross-Chain Integration Status & Prerequisites for Live Deployment

### Current State
- The EVM destination contract [`AttestationReceiver.sol`](contracts/evm/AttestationReceiver.sol) is compiled into `AttestationReceiver.json` with ABI and bytecode.
- The unit and integration tests simulate the full EVM environment, validating contract compilation, execution, signature recovery, and storage updates.

### Remaining Prerequisites for Public EVM Testnet (e.g. Sepolia)
To deploy and execute on a live public EVM network:
1. **EVM Node RPC Provider**: Set `EVM_RPC_URL` (e.g. Alchemy, Infura, or QuickNode Sepolia endpoint).
2. **Funded Relayer Account**: Provide an EVM private key `EVM_RELAYER_PRIVATE_KEY` funded with Sepolia ETH for gas fees.
3. **Deploy Contract**: Deploy `AttestationReceiver.sol` to Sepolia and record the address in `services/cross-chain-bridge/.env`.
4. **Bridge Daemon**: Launch `services/cross-chain-bridge` (`npm start`) to listen for live Soroban `compliance::attestation` events and broadcast EVM transactions.
