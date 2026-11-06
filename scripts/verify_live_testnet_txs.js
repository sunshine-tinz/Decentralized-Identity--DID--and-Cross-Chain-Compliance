const RPC_URL = 'https://soroban-testnet.stellar.org';

const txHashes = [
  { name: 'did_upload', hash: '4dbd76107b4d0c4a92994518850749c063ca3ffe54681f35ca34cfd3c9362707' },
  { name: 'comp_upload', hash: '64ea5ac7d744e51f9710738f15c4e24f7a832ff4cb47b890c9350be8ad1b22ee' },
  { name: 'vc_upload', hash: 'd47e8f39fee7200eedbc985b084f498c68cf00cac9c2d631b483fe4fb7e25135' },
  { name: 'did_deploy', hash: '54bfa3691912e8ef747bbd060d76d2893941910553dacb2c9c78ccf67628f680' },
  { name: 'vc_deploy', hash: 'bca2b66ca1dea03ee0b5ca2379393494b82419bda10323685cb8cd0e49356437' },
  { name: 'comp_deploy', hash: 'a6609c28837c031c681c8e77826dd16f0532ea775e106e8059df05229cbb5572' },
  { name: 'vc_init', hash: '3dc71f7fc818d95e4c09077baae4db1005fa1ee721050040c6bfbbd044d5a05b' },
  { name: 'comp_init', hash: '7c1f46982fcb05d4c836230c7bfb7129f9b0558a8b8aaf5cbe18e9c1894e7529' },
  { name: 'set_verifier', hash: 'ef1ce652a9f1f30c411901c735d3f551935c6cb12fc09c7d7f1a0dba32839a9d' },
  { name: 'register_did', hash: 'e94cf1b9005e48b43b6ab9818a10da3cd54b8362038ee0de5a114cb18220a759' },
  { name: 'add_issuer', hash: 'cd57a443dd8fda40575b069b9e0c0334e19bd0d4daf286bfc519735c2429f5d9' },
  { name: 'issue_cred', hash: '5ce0c9ff4a71c1d449e732631ef02b83c40121b3fb12a61182fc4735eb50c625' },
  { name: 'set_policy', hash: '97b509712921c4eac1f9f8085c3bc30cd56f3aa3cffbd54e4a5cc625f87ef49a' },
  { name: 'revoke_cred', hash: '9191a8698c6c4f279bc9275644d06e7a43929810a1b12b3e468ddcd738abadb7' }
];

async function check() {
  console.log('Verifying active Testnet transactions live on ' + RPC_URL + '...');
  for (const item of txHashes) {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: { hash: item.hash }
        })
      });
      const data = await res.json();
      if (data.result) {
        console.log(`[PASS] ${item.name}: Status=${data.result.status}, Ledger=${data.result.ledger}, Tx=${item.hash}`);
      } else {
        console.log(`[FAIL] ${item.name}: ${JSON.stringify(data.error)}`);
      }
    } catch (e) {
      console.log(`[ERR] ${item.name}: ${e.message}`);
    }
  }
}
check();
