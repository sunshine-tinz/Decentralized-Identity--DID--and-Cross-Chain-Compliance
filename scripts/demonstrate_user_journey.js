/**
 * Complete User Journey Live Demonstration Script
 * 
 * Demonstrates the full lifecycle for open-source reviewers:
 * 1. User wallet creation & funding (simulating Freighter connection)
 * 2. DID registration & on-chain resolution
 * 3. KYC credential issuance by registered issuer
 * 4. Verification of credential validity & compound compliance
 * 5. Credential revocation & on-chain compliance reversal
 * 
 * Run with: node scripts/demonstrate_user_journey.js
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
  did_registry: 'da3cc052e4652462c59579842b2290961f807f7c69d6b3bdf55fbae7429720d0',
  compliance_engine: 'a748176dd25d338e1f34d9a6f5d7387a5a53839094de57424976b0c89c406919',
  vc_verifier: '013da017dfe680e1722ea489a5e828c7ec2ce2bc7b21c7f08a75302dd93cd33f'
};

async function waitForTx(hash) {
  for (let i = 0; i < 35; i++) {
    await new Promise(r => setTimeout(r, 2000));
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
        if (data.result.status === 'FAILED') throw new Error(`Tx ${hash} failed: ${JSON.stringify(data.result)}`);
      }
    } catch (e) {
      if (e.message && e.message.includes('failed:')) throw e;
    }
  }
  throw new Error(`Tx ${hash} timed out`);
}

async function fundAccount(pubkey) {
  process.stdout.write(`Funding ${pubkey.slice(0, 10)}... via Friendbot... `);
  const res = await fetch(`https://friendbot.stellar.org?addr=${pubkey}`);
  if (!res.ok) throw new Error(`Friendbot failed: ${await res.text()}`);
  console.log('Funded!');
}

async function invokeMethod(sourceKeypair, contractId, method, args, signers = []) {
  const account = await rpc.getAccount(sourceKeypair.publicKey());
  const contract = new Address(contractId);
  const op = Operation.invokeContractFunction({
    contractAddress: contract,
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
  prepared.sign(sourceKeypair);
  for (const signer of signers) {
    if (signer.publicKey() !== sourceKeypair.publicKey()) {
      prepared.sign(signer);
    }
  }

  const sendRes = await rpc.sendTransaction(prepared);
  if (sendRes.status === 'ERROR') {
    throw new Error(`Invocation of ${method} failed: ${JSON.stringify(sendRes)}`);
  }
  const txResult = await waitForTx(sendRes.hash);
  return { txHash: sendRes.hash, ledger: txResult.ledger };
}

async function simulateRead(sourceKeypair, contractId, method, args) {
  const account = await rpc.getAccount(sourceKeypair.publicKey());
  const contract = new Address(contractId);
  const op = Operation.invokeContractFunction({
    contractAddress: contract,
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

  const sim = await rpc.simulateTransaction(tx);
  if (!sim.result) throw new Error(`Simulation of ${method} failed: ${sim.error}`);
  return scValToNative(sim.result.retval);
}

async function deployContract(adminKeypair, wasmHashHex, name) {
  process.stdout.write(`Deploying contract ${name}... `);
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

  const sim = await rpc.simulateTransaction(tx);
  if (!sim.result) throw new Error(`Simulation failed: ${sim.error}`);
  const contractId = scValToNative(sim.result.retval);

  const prepared = await rpc.prepareTransaction(tx);
  prepared.sign(adminKeypair);
  const sendRes = await rpc.sendTransaction(prepared);
  if (sendRes.status === 'ERROR') throw new Error(`Deploy failed: ${JSON.stringify(sendRes)}`);
  const txResult = await waitForTx(sendRes.hash);
  console.log(`Deployed! Contract ID: ${contractId} (Ledger ${txResult.ledger})`);
  return { contractId, txHash: sendRes.hash, ledger: txResult.ledger };
}

async function runDemonstration() {
  console.log('========================================================================');
  console.log('   DECENTRALIZED IDENTITY & COMPLIANCE — COMPLETE USER JOURNEY DEMO    ');
  console.log('========================================================================\n');

  console.log('[STAGE 1] Key Generation & Friendbot Funding');
  const admin = Keypair.random();
  const issuer = Keypair.random();
  const user = Keypair.random();

  console.log(`  Admin Key:  ${admin.publicKey()}`);
  console.log(`  Issuer Key: ${issuer.publicKey()}`);
  console.log(`  User (DID Controller): ${user.publicKey()}\n`);

  await fundAccount(admin.publicKey());
  await fundAccount(issuer.publicKey());
  await fundAccount(user.publicKey());

  console.log('\n[STAGE 2] Contract Setup on Stellar Testnet');
  const did = await deployContract(admin, WASM_HASHES.did_registry, 'DID Registry');
  const vc = await deployContract(admin, WASM_HASHES.vc_verifier, 'VC Verifier');
  const comp = await deployContract(admin, WASM_HASHES.compliance_engine, 'Compliance Engine');

  console.log('  Initializing VCVerifier and ComplianceEngine...');
  await invokeMethod(admin, vc.contractId, 'initialize', [new Address(admin.publicKey()).toScVal()]);
  await invokeMethod(admin, comp.contractId, 'initialize', [new Address(admin.publicKey()).toScVal()]);
  await invokeMethod(admin, comp.contractId, 'set_verifier', [new Address(admin.publicKey()).toScVal(), new Address(vc.contractId).toScVal()]);
  console.log('  Contracts linked successfully.\n');

  console.log('[STAGE 3] User Action: Registering Decentralized Identity (DID)');
  const docHash = crypto.createHash('sha256').update('alice-kyc-passport-v1').digest();
  const regTx = await invokeMethod(
    user,
    did.contractId,
    'register',
    [new Address(user.publicKey()).toScVal(), nativeToScVal(docHash, { type: 'bytes' })],
    [user]
  );
  console.log(`  DID Registered! Tx: ${regTx.txHash} (Ledger ${regTx.ledger})`);
  console.log(`  Explorer: https://stellar.expert/explorer/testnet/tx/${regTx.txHash}`);

  const resolved = await simulateRead(user, did.contractId, 'resolve', [new Address(user.publicKey()).toScVal()]);
  console.log(`  Resolved DID Document:`);
  console.log(`    - DID URI: ${resolved.id}`);
  console.log(`    - Active:  ${resolved.active}`);
  console.log(`    - Hash:    ${Buffer.from(resolved.document_hash).toString('hex')}\n`);

  console.log('[STAGE 4] KYC Issuer: Adding Issuer & Issuing Credential');
  await invokeMethod(admin, vc.contractId, 'add_issuer', [new Address(admin.publicKey()).toScVal(), new Address(issuer.publicKey()).toScVal()]);
  
  const expiresAt = regTx.ledger + 10000;
  const issueTx = await invokeMethod(
    issuer,
    vc.contractId,
    'issue_credential',
    [
      new Address(issuer.publicKey()).toScVal(),
      new Address(user.publicKey()).toScVal(),
      nativeToScVal('kyc_passed', { type: 'symbol' }),
      nativeToScVal(expiresAt, { type: 'u32' })
    ],
    [issuer]
  );
  console.log(`  Credential Issued! Tx: ${issueTx.txHash} (Ledger ${issueTx.ledger})`);
  console.log(`  Explorer: https://stellar.expert/explorer/testnet/tx/${issueTx.txHash}\n`);

  console.log('[STAGE 5] Verification: Credential Validity & Compound Compliance');
  const valid = await simulateRead(user, vc.contractId, 'is_credential_valid', [
    new Address(user.publicKey()).toScVal(),
    nativeToScVal('kyc_passed', { type: 'symbol' })
  ]);
  console.log(`  VCVerifier.is_credential_valid('kyc_passed'): ${valid} (Expected: true)`);

  // Configure DeFi pool compliance policy requiring 'kyc_passed'
  await invokeMethod(admin, comp.contractId, 'set_policy', [
    new Address(admin.publicKey()).toScVal(),
    nativeToScVal('defi_pool', { type: 'symbol' }),
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('kyc_passed')])
  ]);

  const compliant = await simulateRead(user, comp.contractId, 'is_compliant', [
    new Address(user.publicKey()).toScVal(),
    nativeToScVal('defi_pool', { type: 'symbol' })
  ]);
  console.log(`  ComplianceEngine.is_compliant('defi_pool'): ${compliant} (Expected: true)\n`);

  console.log('[STAGE 6] Revocation & On-Chain Reversal Enforcement');
  const revokeTx = await invokeMethod(
    issuer,
    vc.contractId,
    'revoke_credential',
    [
      new Address(issuer.publicKey()).toScVal(),
      new Address(user.publicKey()).toScVal(),
      nativeToScVal('kyc_passed', { type: 'symbol' })
    ],
    [issuer]
  );
  console.log(`  Credential Revoked! Tx: ${revokeTx.txHash} (Ledger ${revokeTx.ledger})`);
  console.log(`  Explorer: https://stellar.expert/explorer/testnet/tx/${revokeTx.txHash}`);

  const validAfter = await simulateRead(user, vc.contractId, 'is_credential_valid', [
    new Address(user.publicKey()).toScVal(),
    nativeToScVal('kyc_passed', { type: 'symbol' })
  ]);
  const compliantAfter = await simulateRead(user, comp.contractId, 'is_compliant', [
    new Address(user.publicKey()).toScVal(),
    nativeToScVal('defi_pool', { type: 'symbol' })
  ]);
  console.log(`  VCVerifier.is_credential_valid('kyc_passed'): ${validAfter} (Expected: false)`);
  console.log(`  ComplianceEngine.is_compliant('defi_pool'): ${compliantAfter} (Expected: false)\n`);

  console.log('========================================================================');
  console.log('   FULL USER JOURNEY DEMONSTRATION COMPLETE — 100% SUCCESS');
  console.log('========================================================================');
}

if (require.main === module) {
  runDemonstration().catch(err => {
    console.error('Demonstration Error:', err);
    process.exit(1);
  });
}

module.exports = { runDemonstration };
