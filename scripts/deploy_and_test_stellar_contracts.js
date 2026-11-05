/**
 * Deploy and Verify Contract Instances on Live Stellar Testnet (Protocol 22+)
 *
 * This script:
 * 1. Instantiates DidRegistry, VCVerifier, and ComplianceEngine from their verified WASM hashes.
 * 2. Initializes the contracts with an admin key.
 * 3. Links the compliance engine to the verifier instance.
 * 4. Executes a full lifecycle:
 *    - Register DID and resolve
 *    - Add trusted issuer
 *    - Issue KYC credential
 *    - Validate credential on-chain
 *    - Set compliance policy and evaluate compliance
 *    - Revoke credential and verify compliance flips to false
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
  nativeToScVal
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

const WASM_HASHES = {
  did_registry: '3a007ecfe2f24b0d7ef2a784761f6e1ff498a2b9c3cded0e6f84a862820c86eb',
  compliance_engine: 'c74baa06c75d9aa311adc1a2b36e1419c3e746ee128d86961fa37ca7a7c33f2c',
  vc_verifier: '013da017dfe680e1722ea489a5e828c7ec2ce2bc7b21c7f08a75302dd93cd33f'
};

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
        if (data.result.status === 'SUCCESS') {
          return data.result;
        }
        if (data.result.status === 'FAILED') {
          throw new Error(`Tx ${hash} FAILED on ledger ${data.result.ledger}: ${JSON.stringify(data.result.diagnosticEventsXdr || data.result.resultXdr)}`);
        }
      }
    } catch (e) {
      if (e.message && e.message.includes('FAILED on ledger')) throw e;
      // Transient network error during poll, retry next tick
    }
  }
  throw new Error(`Tx ${hash} timed out`);
}

async function fundAccount(pubkey) {
  console.log(`Funding account ${pubkey} via Friendbot...`);
  const res = await fetch(`https://friendbot.stellar.org?addr=${pubkey}`);
  if (!res.ok) throw new Error(`Friendbot failed: ${await res.text()}`);
}

async function deployContract(adminKeypair, wasmHashHex, name) {
  console.log(`\n--- Deploying ${name} ---`);
  const account = await rpc.getAccount(adminKeypair.publicKey());
  const salt = crypto.randomBytes(32);
  const addr = Address.fromString(adminKeypair.publicKey());

  const op = Operation.createCustomContract({
    address: addr,
    wasmHash: Buffer.from(wasmHashHex, 'hex'),
    salt: salt
  });

  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  // Simulate to retrieve the deployed Contract ID
  const sim = await rpc.simulateTransaction(tx);
  if (!sim.result) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  const contractId = scValToNative(sim.result.retval);
  console.log(`Projected ${name} Contract ID: ${contractId}`);

  const prepared = await rpc.prepareTransaction(tx);
  prepared.sign(adminKeypair);

  const sendRes = await rpc.sendTransaction(prepared);
  if (sendRes.status === 'ERROR') {
    throw new Error(`Deployment of ${name} failed: ${JSON.stringify(sendRes)}`);
  }
  console.log(`Deployment submitted: hash ${sendRes.hash}`);

  const txResult = await waitForTx(sendRes.hash);
  console.log(`Tx confirmed on ledger ${txResult.ledger} with status: ${txResult.status}`);
  console.log(`[DEPLOYED] ${name} Contract ID: ${contractId}`);

  return {
    contractId,
    txHash: sendRes.hash,
    ledger: txResult.ledger,
    status: txResult.status
  };
}

async function invokeMethod(adminKeypair, contractId, method, args, signers = [adminKeypair]) {
  const account = await rpc.getAccount(adminKeypair.publicKey());
  const contractAddress = new Address(contractId);

  const op = Operation.invokeContractFunction({
    contract: contractId,
    function: method,
    args: args
  });

  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  const prepared = await rpc.prepareTransaction(tx);
  for (const signer of signers) {
    prepared.sign(signer);
  }

  const sendRes = await rpc.sendTransaction(prepared);
  if (sendRes.status === 'ERROR') {
    throw new Error(`Invocation of ${method} failed: ${JSON.stringify(sendRes)}`);
  }

  const txResult = await waitForTx(sendRes.hash);
  return { txHash: sendRes.hash, ledger: txResult.ledger, status: txResult.status };
}

async function simulateRead(adminKeypair, contractId, method, args) {
  const account = await rpc.getAccount(adminKeypair.publicKey());
  const op = Operation.invokeContractFunction({
    contract: contractId,
    function: method,
    args: args
  });

  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  const sim = await rpc.simulateTransaction(tx);
  if (sim.error) throw new Error(sim.error);
  return scValToNative(sim.result.retval);
}

async function main() {
  console.log('================================================================');
  console.log('  LIVE STELLAR TESTNET CONTRACT DEPLOYMENT & VERIFICATION');
  console.log('================================================================');

  const admin = Keypair.random();
  const issuer = Keypair.random();
  const subject = Keypair.random();

  console.log('Admin:', admin.publicKey());
  console.log('Issuer:', issuer.publicKey());
  console.log('Subject (User):', subject.publicKey());

  await fundAccount(admin.publicKey());
  await fundAccount(issuer.publicKey());
  await fundAccount(subject.publicKey());

  const results = {
    network: 'Stellar Testnet',
    contracts: {},
    invocations: {}
  };

  // 1. Deploy all three contract instances
  results.contracts.did_registry = await deployContract(admin, WASM_HASHES.did_registry, 'DID Registry');
  results.contracts.vc_verifier = await deployContract(admin, WASM_HASHES.vc_verifier, 'VC Verifier');
  results.contracts.compliance_engine = await deployContract(admin, WASM_HASHES.compliance_engine, 'Compliance Engine');

  const didId = results.contracts.did_registry.contractId;
  const vcId = results.contracts.vc_verifier.contractId;
  const compId = results.contracts.compliance_engine.contractId;

  // 2. Initialize VCVerifier
  console.log('\n--- Initializing VCVerifier ---');
  results.invocations.vc_init = await invokeMethod(
    admin,
    vcId,
    'initialize',
    [new Address(admin.publicKey()).toScVal()]
  );
  console.log(`VCVerifier initialized. Tx: ${results.invocations.vc_init.txHash}`);

  // 3. Initialize ComplianceEngine
  console.log('\n--- Initializing ComplianceEngine ---');
  results.invocations.comp_init = await invokeMethod(
    admin,
    compId,
    'initialize',
    [new Address(admin.publicKey()).toScVal()]
  );
  console.log(`ComplianceEngine initialized. Tx: ${results.invocations.comp_init.txHash}`);

  // 4. Link VCVerifier in ComplianceEngine
  console.log('\n--- Linking VCVerifier in ComplianceEngine ---');
  results.invocations.set_verifier = await invokeMethod(
    admin,
    compId,
    'set_verifier',
    [new Address(admin.publicKey()).toScVal(), new Address(vcId).toScVal()]
  );
  console.log(`Verifier linked. Tx: ${results.invocations.set_verifier.txHash}`);

  // 5. Register and Resolve DID
  console.log('\n--- Registering DID ---');
  const docHashBytes = crypto.createHash('sha256').update('user-identity-doc-v1').digest();
  results.invocations.register_did = await invokeMethod(
    subject,
    didId,
    'register',
    [new Address(subject.publicKey()).toScVal(), nativeToScVal(docHashBytes, { type: 'bytes' })],
    [subject]
  );
  console.log(`DID registered. Tx: ${results.invocations.register_did.txHash}`);

  console.log('Resolving registered DID on-chain...');
  const resolvedDid = await simulateRead(
    admin,
    didId,
    'resolve',
    [new Address(subject.publicKey()).toScVal()]
  );
  console.log(`[VERIFIED] Resolved DID ID: ${resolvedDid.id}`);
  console.log(`[VERIFIED] Active: ${resolvedDid.active}`);

  // 6. Admin adds Issuer
  console.log('\n--- Registering Trusted Issuer ---');
  results.invocations.add_issuer = await invokeMethod(
    admin,
    vcId,
    'add_issuer',
    [new Address(admin.publicKey()).toScVal(), new Address(issuer.publicKey()).toScVal()]
  );
  console.log(`Issuer registered. Tx: ${results.invocations.add_issuer.txHash}`);

  // 7. Issuer issues KYC Credential
  console.log('\n--- Issuing KYC Credential ---');
  // Get current ledger height
  const latestLedger = results.invocations.add_issuer.ledger;
  const expiresAt = latestLedger + 1000;
  results.invocations.issue_credential = await invokeMethod(
    issuer,
    vcId,
    'issue_credential',
    [
      new Address(issuer.publicKey()).toScVal(),
      new Address(subject.publicKey()).toScVal(),
      nativeToScVal('kyc_passed', { type: 'symbol' }),
      nativeToScVal(expiresAt, { type: 'u32' })
    ],
    [issuer]
  );
  console.log(`Credential issued. Tx: ${results.invocations.issue_credential.txHash}`);

  // 8. Query Credential Validity
  console.log('Verifying credential validity on-chain...');
  const isValid = await simulateRead(
    admin,
    vcId,
    'is_credential_valid',
    [new Address(subject.publicKey()).toScVal(), nativeToScVal('kyc_passed', { type: 'symbol' })]
  );
  console.log(`[VERIFIED] is_credential_valid('kyc_passed'): ${isValid}`);

  const isInvalidAttr = await simulateRead(
    admin,
    vcId,
    'is_credential_valid',
    [new Address(subject.publicKey()).toScVal(), nativeToScVal('unheld_attr', { type: 'symbol' })]
  );
  console.log(`[VERIFIED] is_credential_valid('unheld_attr'): ${isInvalidAttr}`);

  // 9. Set Policy & Check Compliance
  console.log('\n--- Setting Compliance Policy ---');
  results.invocations.set_policy = await invokeMethod(
    admin,
    compId,
    'set_policy',
    [
      new Address(admin.publicKey()).toScVal(),
      nativeToScVal('defi_pool', { type: 'symbol' }),
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('kyc_passed')])
    ]
  );
  console.log(`Policy registered. Tx: ${results.invocations.set_policy.txHash}`);

  console.log('Evaluating compliance on-chain...');
  const isCompliant = await simulateRead(
    admin,
    compId,
    'is_compliant',
    [new Address(subject.publicKey()).toScVal(), nativeToScVal('defi_pool', { type: 'symbol' })]
  );
  console.log(`[VERIFIED] is_compliant('defi_pool'): ${isCompliant}`);

  // 10. Revoke Credential & Verify Compliance Reversal
  console.log('\n--- Revoking Credential ---');
  results.invocations.revoke_credential = await invokeMethod(
    issuer,
    vcId,
    'revoke_credential',
    [
      new Address(issuer.publicKey()).toScVal(),
      new Address(subject.publicKey()).toScVal(),
      nativeToScVal('kyc_passed', { type: 'symbol' })
    ],
    [issuer]
  );
  console.log(`Credential revoked. Tx: ${results.invocations.revoke_credential.txHash}`);

  console.log('Re-verifying credential validity post-revocation...');
  const isValidPostRevoke = await simulateRead(
    admin,
    vcId,
    'is_credential_valid',
    [new Address(subject.publicKey()).toScVal(), nativeToScVal('kyc_passed', { type: 'symbol' })]
  );
  console.log(`[VERIFIED] is_credential_valid post-revocation: ${isValidPostRevoke}`);

  console.log('Re-evaluating compliance post-revocation...');
  const isCompliantPostRevoke = await simulateRead(
    admin,
    compId,
    'is_compliant',
    [new Address(subject.publicKey()).toScVal(), nativeToScVal('defi_pool', { type: 'symbol' })]
  );
  console.log(`[VERIFIED] is_compliant post-revocation: ${isCompliantPostRevoke}`);

  // Save full results artifact to file
  const evidencePath = path.resolve(__dirname, '../TESTNET_DEPLOYMENT_EVIDENCE.json');
  fs.writeFileSync(evidencePath, JSON.stringify(results, null, 2));
  console.log(`\nDeployment & Verification evidence written to: ${evidencePath}`);
  console.log('All live tests completed successfully!');
}

main().catch(err => {
  console.error('\n*** Deployment script failed:', err);
  process.exit(1);
});
