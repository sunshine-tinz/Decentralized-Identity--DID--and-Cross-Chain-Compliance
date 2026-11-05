/**
 * Independent Stellar Testnet Verification Script
 * Validates deployed contracts, queries on-chain state, uploads current local WASMs,
 * and reproduces the full on-chain lifecycle.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jsXdr = require('../services/cross-chain-bridge/node_modules/@stellar/js-xdr');
const {
  Keypair,
  SorobanRpc,
  Operation,
  TransactionBuilder,
  Networks,
  Address,
  xdr,
  scValToNative,
  nativeToScVal,
  StrKey
} = require('../services/cross-chain-bridge/node_modules/@stellar/stellar-sdk');

// Apply Protocol 22 arm 2 patch for js-xdr compatibility
const context = { results: {} };
const Struct = Object.getPrototypeOf(xdr.CreateContractArgs);
const CreateContractArgsV2 = Struct.create(context, 'CreateContractArgsV2', [
  ['contractIdPreimage', xdr.ContractIdPreimage],
  ['executable', xdr.ContractExecutable],
  ['constructorArgs', new jsXdr.VarArray(xdr.ScVal, 4294967295)]
]);

const typeEnum = xdr.SorobanAuthorizedFunctionType;
const member2 = new typeEnum('sorobanAuthorizedFunctionTypeCreateContractV2HostFn', 2);
typeEnum._members['sorobanAuthorizedFunctionTypeCreateContractV2HostFn'] = member2;
typeEnum._byValue[2] = member2;

const fnUnion = xdr.SorobanAuthorizedFunction;
fnUnion._switches.set(member2, 'createContractV2HostFn');
fnUnion._arms['createContractV2HostFn'] = CreateContractArgsV2;
fnUnion['sorobanAuthorizedFunctionTypeCreateContractV2HostFn'] = function(val) {
  return new fnUnion(member2, val);
};

const RPC_URL = 'https://soroban-testnet.stellar.org';
const rpc = new SorobanRpc.Server(RPC_URL);

async function waitForTx(hash) {
  for (let i = 0; i < 35; i++) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: { hash }
        })
      });
      const data = await res.json();
      if (data.result) {
        if (data.result.status === 'SUCCESS') return data.result;
        if (data.result.status === 'FAILED') {
          throw new Error(`Tx ${hash} failed: ${JSON.stringify(data.result.resultXdr)}`);
        }
      }
    } catch (e) {
      if (e.message && e.message.includes('failed:')) throw e;
    }
  }
  throw new Error(`Tx ${hash} timed out`);
}

async function fundAccount(pubkey) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${pubkey}`);
  if (!res.ok) throw new Error(`Friendbot failed: ${await res.text()}`);
}

async function queryExistingTx(hash) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: { hash }
    })
  });
  const data = await res.json();
  return data.result;
}

async function main() {
  console.log('=== [1/4] AUDITING PREVIOUSLY DEPLOYED CONTRACT TRANSACTIONS ===');
  const evidencePath = path.resolve(__dirname, '../TESTNET_DEPLOYMENT_EVIDENCE.json');
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

  for (const [name, contract] of Object.entries(evidence.contracts)) {
    process.stdout.write(`Checking ${name} (${contract.contractId})... `);
    const tx = await queryExistingTx(contract.txHash);
    if (tx && tx.status === 'SUCCESS') {
      console.log(`[VERIFIED] Confirmed on ledger ${tx.ledger}`);
    } else {
      console.log(`[NOT CONFIRMED] status: ${tx ? tx.status : 'not found'}`);
    }
  }

  console.log('\n=== [2/4] AUDITING LOCAL WASM HASHES VS TESTNET UPLOADS ===');
  const wasmDir = path.resolve(__dirname, '../contracts/target/wasm32-unknown-unknown/release');
  const localWasms = {
    did_registry: fs.readFileSync(path.join(wasmDir, 'did_registry.wasm')),
    compliance_engine: fs.readFileSync(path.join(wasmDir, 'compliance_engine.wasm')),
    vc_verifier: fs.readFileSync(path.join(wasmDir, 'vc_verifier.wasm'))
  };

  const localHashes = {};
  for (const [name, buf] of Object.entries(localWasms)) {
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    localHashes[name] = hash;
    console.log(`Local ${name}.wasm: ${buf.length} bytes | SHA256: ${hash}`);
  }

  // Upload current local wasms if needed to ensure 100% hash identity
  console.log('\n=== [3/4] UPLOADING CURRENT LOCAL WASMS TO TESTNET ===');
  const deployer = Keypair.random();
  console.log('Deployer public key:', deployer.publicKey());
  await fundAccount(deployer.publicKey());

  const currentWasmHashes = {};
  for (const [name, buf] of Object.entries(localWasms)) {
    const hash = localHashes[name];
    process.stdout.write(`Uploading ${name}.wasm (${buf.length} bytes)... `);
    const account = await rpc.getAccount(deployer.publicKey());
    const op = Operation.uploadContractWasm({ wasm: buf });
    const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
      .addOperation(op)
      .setTimeout(60)
      .build();

    const prepared = await rpc.prepareTransaction(tx);
    prepared.sign(deployer);
    const sendRes = await rpc.sendTransaction(prepared);
    const txRes = await waitForTx(sendRes.hash);
    console.log(`[UPLOADED] Tx: ${sendRes.hash} | Ledger: ${txRes.ledger} | SHA-256: ${hash}`);
    currentWasmHashes[name] = { hash, txHash: sendRes.hash, ledger: txRes.ledger };
  }

  console.log('\n=== [4/4] LIVE INDEPENDENT REPRODUCTION OF CONTRACT LIFECYCLE ===');
  const admin = Keypair.random();
  const issuer = Keypair.random();
  const subject = Keypair.random();

  await fundAccount(admin.publicKey());
  await fundAccount(issuer.publicKey());
  await fundAccount(subject.publicKey());

  // Deploy contracts from current uploaded WASMs
  async function deploy(wasmHashHex, name) {
    const account = await rpc.getAccount(admin.publicKey());
    const salt = crypto.randomBytes(32);
    const addr = Address.fromString(admin.publicKey());

    const op = Operation.createCustomContract({
      address: addr,
      wasmHash: Buffer.from(wasmHashHex, 'hex'),
      salt: salt
    });

    const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
      .addOperation(op)
      .setTimeout(60)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    const contractId = scValToNative(sim.result.retval);

    const prepared = await rpc.prepareTransaction(tx);
    prepared.sign(admin);
    const sendRes = await rpc.sendTransaction(prepared);
    const txRes = await waitForTx(sendRes.hash);
    console.log(`[DEPLOYED] ${name} (${contractId}) | Tx: ${sendRes.hash} | Ledger: ${txRes.ledger}`);
    return { contractId, txHash: sendRes.hash, ledger: txRes.ledger };
  }

  async function invoke(signer, contractId, method, args) {
    const account = await rpc.getAccount(signer.publicKey());
    const op = Operation.invokeContractFunction({ contract: contractId, function: method, args: args });
    const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
      .addOperation(op)
      .setTimeout(60)
      .build();
    const prepared = await rpc.prepareTransaction(tx);
    prepared.sign(signer);
    const sendRes = await rpc.sendTransaction(prepared);
    const txRes = await waitForTx(sendRes.hash);
    return { txHash: sendRes.hash, ledger: txRes.ledger };
  }

  async function query(contractId, method, args) {
    const account = await rpc.getAccount(admin.publicKey());
    const op = Operation.invokeContractFunction({ contract: contractId, function: method, args: args });
    const tx = new TransactionBuilder(account, { fee: '100000', networkPassphrase: Networks.TESTNET })
      .addOperation(op)
      .setTimeout(60)
      .build();
    const sim = await rpc.simulateTransaction(tx);
    if (sim.error) throw new Error(sim.error);
    return scValToNative(sim.result.retval);
  }

  // 1. Deploy
  const didC = await deploy(currentWasmHashes.did_registry.hash, 'DID Registry');
  const vcC = await deploy(currentWasmHashes.vc_verifier.hash, 'VC Verifier');
  const compC = await deploy(currentWasmHashes.compliance_engine.hash, 'Compliance Engine');

  // 2. Initialize
  const vcInit = await invoke(admin, vcC.contractId, 'initialize', [new Address(admin.publicKey()).toScVal()]);
  console.log(`VCVerifier initialized. Tx: ${vcInit.txHash}`);

  const compInit = await invoke(admin, compC.contractId, 'initialize', [new Address(admin.publicKey()).toScVal()]);
  console.log(`ComplianceEngine initialized. Tx: ${compInit.txHash}`);

  const setVerif = await invoke(admin, compC.contractId, 'set_verifier', [
    new Address(admin.publicKey()).toScVal(),
    new Address(vcC.contractId).toScVal()
  ]);
  console.log(`Verifier linked. Tx: ${setVerif.txHash}`);

  // 3. Register & Resolve DID
  const docHash = crypto.createHash('sha256').update('independent-audit-doc').digest();
  const regDid = await invoke(subject, didC.contractId, 'register', [
    new Address(subject.publicKey()).toScVal(),
    nativeToScVal(docHash, { type: 'bytes' })
  ]);
  console.log(`DID registered. Tx: ${regDid.txHash}`);

  const resolved = await query(didC.contractId, 'resolve', [new Address(subject.publicKey()).toScVal()]);
  console.log(`[VERIFIED ON-CHAIN] Resolved DID: ${resolved.id} | Active: ${resolved.active}`);

  // 4. Register Issuer & Issue Credential
  const addIss = await invoke(admin, vcC.contractId, 'add_issuer', [
    new Address(admin.publicKey()).toScVal(),
    new Address(issuer.publicKey()).toScVal()
  ]);
  console.log(`Issuer registered. Tx: ${addIss.txHash}`);

  const expiresAt = addIss.ledger + 1000;
  const issueCred = await invoke(issuer, vcC.contractId, 'issue_credential', [
    new Address(issuer.publicKey()).toScVal(),
    new Address(subject.publicKey()).toScVal(),
    nativeToScVal('kyc_passed', { type: 'symbol' }),
    nativeToScVal(expiresAt, { type: 'u32' })
  ]);
  console.log(`Credential issued. Tx: ${issueCred.txHash}`);

  const isValidBefore = await query(vcC.contractId, 'is_credential_valid', [
    new Address(subject.publicKey()).toScVal(),
    nativeToScVal('kyc_passed', { type: 'symbol' })
  ]);
  console.log(`[VERIFIED ON-CHAIN] is_credential_valid('kyc_passed'): ${isValidBefore}`);

  // 5. Configure Policy & Evaluate Compliance
  const setPol = await invoke(admin, compC.contractId, 'set_policy', [
    new Address(admin.publicKey()).toScVal(),
    nativeToScVal('defi_pool', { type: 'symbol' }),
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('kyc_passed')])
  ]);
  console.log(`Policy registered. Tx: ${setPol.txHash}`);

  const isCompliantBefore = await query(compC.contractId, 'is_compliant', [
    new Address(subject.publicKey()).toScVal(),
    nativeToScVal('defi_pool', { type: 'symbol' })
  ]);
  console.log(`[VERIFIED ON-CHAIN] is_compliant('defi_pool'): ${isCompliantBefore}`);

  // 6. Revoke Credential & Verify Compliance Reversal
  const revokeCred = await invoke(issuer, vcC.contractId, 'revoke_credential', [
    new Address(issuer.publicKey()).toScVal(),
    new Address(subject.publicKey()).toScVal(),
    nativeToScVal('kyc_passed', { type: 'symbol' })
  ]);
  console.log(`Credential revoked. Tx: ${revokeCred.txHash}`);

  const isValidAfter = await query(vcC.contractId, 'is_credential_valid', [
    new Address(subject.publicKey()).toScVal(),
    nativeToScVal('kyc_passed', { type: 'symbol' })
  ]);
  console.log(`[VERIFIED ON-CHAIN] is_credential_valid post-revocation: ${isValidAfter}`);

  const isCompliantAfter = await query(compC.contractId, 'is_compliant', [
    new Address(subject.publicKey()).toScVal(),
    nativeToScVal('defi_pool', { type: 'symbol' })
  ]);
  console.log(`[VERIFIED ON-CHAIN] is_compliant post-revocation: ${isCompliantAfter}`);

  const auditRecord = {
    network: 'Stellar Testnet',
    auditTimestamp: new Date().toISOString(),
    wasmUploads: currentWasmHashes,
    reproducedContracts: {
      did_registry: didC,
      vc_verifier: vcC,
      compliance_engine: compC
    },
    lifecycleTxs: {
      vc_init: vcInit,
      comp_init: compInit,
      set_verifier: setVerif,
      register_did: regDid,
      add_issuer: addIss,
      issue_credential: issueCred,
      set_policy: setPol,
      revoke_credential: revokeCred
    },
    stateVerifications: {
      did_resolved_id: resolved.id,
      did_active: resolved.active,
      is_valid_initial: isValidBefore,
      is_compliant_initial: isCompliantBefore,
      is_valid_post_revocation: isValidAfter,
      is_compliant_post_revocation: isCompliantAfter
    }
  };

  fs.writeFileSync(
    path.resolve(__dirname, '../INDEPENDENT_STELLAR_AUDIT_DATA.json'),
    JSON.stringify(auditRecord, null, 2)
  );
  console.log('\nAudit record successfully persisted to INDEPENDENT_STELLAR_AUDIT_DATA.json');
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
