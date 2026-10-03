# ClearCause Charity DApp

SC6113 financial DApp coursework: transparent, goal-based charitable fundraising with Solidity, React, Python Flask and MetaMask. Campaigns and their descriptions live on chain. The Flask backend queries campaign state and normalizes transaction events; it cannot sign transactions or move funds.

**Verified:** local EVM deployment, 34 contract/API tests across Node and Flask, 13 browser integration checks, a MetaMask-signed Sepolia deployment and public Render hosting. Sample campaigns are fictional. Test ETH only.

**Live application:** https://clearcause-charity-dapp.onrender.com<br>
**Sepolia contract:** [`0x9590b666c1257599e58cb32b4f638195afa77119`](https://sepolia.etherscan.io/address/0x9590b666c1257599e58cb32b4f638195afa77119)<br>
**Deployment transaction:** [`0xc68055fa...75b7430`](https://sepolia.etherscan.io/tx/0xc68055fabdd67c4a435ac7e77f44290f5ba210005163e06e2165e7c1575b7430), block `11821189`

The public repository contains source code and running instructions. The report, recording guide and collected evidence are supplied separately in the local submission package; references to `docs/` and saved `evidence/` below refer to that package. Running the tests generates fresh evidence locally.

## Quick start on Windows

Install Node.js 22 or newer (tested with 24.12.0) and use a browser with MetaMask. Open PowerShell in this folder:

```powershell
npm ci
npm run build
npm run demo
```

Open http://localhost:3001. Keep the terminal open. `npm run demo` compiles the contract, starts a fresh local chain on 8545, deploys, seeds four sample campaigns and starts Express on 3001. Ports must be free. The chain is in memory; stopping it discards its state. Restarting the demo starts over. A previous manifest alone cannot restore a stopped chain.

Alternatively, double-click `START_LOCAL.cmd`. Its first run installs dependencies, then builds and starts the demo. It uses `npm ci` only when dependencies are absent.

### Connect your own MetaMask account without importing development keys

1. Open the application in the browser where MetaMask is installed and click **Connect wallet**. Choose a dedicated test account.
2. If asked, click **Switch to Local development** and approve adding the network. Manual settings: RPC `http://127.0.0.1:8545`, chain ID `31337`, symbol `ETH`.
3. Copy the selected public address. In a second project terminal run:

```powershell
npm run local -- fund 0xYOUR_PUBLIC_WALLET_ADDRESS
```

This sends 10 local test ETH from an unlocked local account. It cannot fund Sepolia. No private key is requested. Ganache accounts are development accounts; never use them on public networks.

To demonstrate both outcomes with your own wallet: create one campaign with a 0.02 ETH target, donate 0.02 ETH and withdraw as its beneficiary. Create a second with a 1 ETH target and a deadline ten minutes ahead, donate 0.01 ETH, then run `npm run local -- advance 900`. Refresh that campaign and claim the refund as the donor. Time advancement is local-only. Use separate test accounts for beneficiary and donor if you want to demonstrate the roles explicitly.

4. Donate to a sample active campaign, or create your own with your MetaMask address as beneficiary. The sample beneficiary/donor accounts are automated local accounts, so their withdrawals/refunds cannot be signed by your own wallet. For your own full demonstration follow `docs/VIDEO_GUIDE_ZH.md`.
5. If MetaMask retains pending transactions after restarting the local chain, use its account activity reset for this **test account/network** (or a fresh test account). Never reset a real transaction merely to hide it.

## Business rules

- Anyone may create a campaign; there is no verified-charity registry or administrator.
- Immutable fields: creator, beneficiary, goal, deadline, category, title and description.
- Goals and donations must be positive. Title is 1–96 UTF-8 bytes, description 1–1600 bytes; contract deadline is within 365 days. The UI uses a conservative 364-day limit.
- Donations are accepted only before the deadline while the goal is unmet. The final donation may overshoot the goal; later donations close.
- Once funded, only the beneficiary may withdraw the full raised amount, once, even before the deadline.
- If the deadline is reached below target, donors individually reclaim their contributions. Refunds never reimburse gas fees. `raised` preserves historical gross donations; `refunded` tracks returned funds separately.
- No cancellation, editing, platform fee, token, dispute mechanism or upgrade key.
- A beneficiary contract that cannot receive ETH can strand its own campaign's funds. Recipient failures roll back state. Use an address capable of receiving ETH.

## Architecture

```text
React UI --- read requests ---> Flask API --- JSON-RPC ---> Ethereum EVM
   |                                                       ^
   +--- BrowserProvider ---> MetaMask --- signed transaction+
                              |
                    private keys stay in wallet
```

The contract is the authority for funds and campaign terms. The backend serves the compiled UI, checks the deployment, reads consistent block snapshots for campaign lists, formats wei as decimal strings, and decodes/filter events. There is no separate database because this prototype does not need off-chain mutable records. Requests are read-only; authorization for state changes is enforced on chain using `msg.sender`.

| Path                         | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `contracts/CharityFund.sol`  | Fundraising, withdrawal and refund rules                     |
| `src/`                       | Responsive React interface and wallet integration            |
| `app.py`                     | Flask API, chain query service and production entry point    |
| `server/`                    | Previous Express implementation retained for comparison      |
| `scripts/`                   | Compilation, local network, deployment and local tools       |
| `tests/`                     | Contract, adversarial receiver, API and browser checks       |
| `artifacts/CharityFund.json` | Compiler version, ABI and deployable bytecode                |
| `deployments/`               | Runtime manifests, generated per network                     |
| `evidence/`                  | Test results, screenshots, gas measurements and audit output |
| `docs/`                      | Report, recording guide and requirements checklist           |

## API

| GET endpoint                       | Response                                                 |
| ---------------------------------- | -------------------------------------------------------- |
| `/api/health`                      | RPC network and deployed-code availability               |
| `/api/config`                      | Public chain ID, address, ABI and explorer configuration |
| `/api/artifact`                    | Public ABI and bytecode for wallet-assisted deployment   |
| `/api/campaigns?offset=0&limit=20` | Newest first, maximum 50 per page                        |
| `/api/campaigns/:id`               | Campaign fields and derived status                       |
| `/api/history?account=0x...`       | Matching on-chain events and confirmation counts         |

History is deliberately bounded to at most 100 returned events from the latest 10,000 blocks since deployment. RPC log requests use 500-block chunks. The response and UI disclose the range. This is recent activity, not an archival indexer. Block confirmations are not finality guarantees. RPC errors are returned without stack traces.

## Development and testing

```powershell
npm run compile
npm test
npm run build
python -m pip install -r requirements.txt
python -m unittest tests.test_flask_app -v
```

For live frontend development run `npm run dev` in another terminal while the backend and local chain are running. Vite proxies `/api` to port 3001.

Browser tests require Google Chrome (or set `BROWSER_CHANNEL=msedge`), a **fresh demo**, and a second terminal:

```powershell
npm run test:e2e
```

The browser adapter communicates with the actual local chain and simulates wallet account access, rejection and network-change events. It does not install or test MetaMask itself. The tests mutate seeded campaigns, so stop and restart the demo before repeating. Screenshots are saved under `evidence/screenshots`. `BASE_URL` can select a different local API port.

Contract/API tests isolate each case with snapshots. They cover invalid data, exact deadline boundary, account authorization, overfunding, duplicate operations, campaign isolation, failed receiver rollback and reentrant refund attempts. Gas values are measured for specific local fixtures, not estimates of public-chain cost.

Clean installation was verified on Windows. The lockfile explicitly marks Ganache's nested macOS-only `fsevents` dependency optional, correcting upstream bundled metadata that otherwise causes `npm ci` to fail on Windows/Linux. Preserve this marker when regenerating the lockfile. The local demo also checks that ports are free and forces local network settings even if `.env` previously selected Sepolia.

## Sepolia deployment

The compiled `CharityFund` artifact was deployed through MetaMask to Sepolia on 1 October 2026. The confirmed manifest is stored in `deployments/11155111.json`. An independent JSON-RPC `eth_getCode` check returned 3,998 bytes of runtime code at the address above. This verifies deployment existence; it is not an audit or a claim of mainnet readiness.

### Preferred method using MetaMask

1. Start the local application and connect MetaMask. Use **How it works → Sepolia deployment helper**.
2. Enable Sepolia in MetaMask. Obtain free test ETH from a faucet listed by [ethereum.org](https://ethereum.org/developers/docs/networks/#sepolia). Faucet eligibility and CAPTCHA may require your participation; never buy mainnet ETH for this assignment.
3. Switch to Sepolia in the helper, click **Deploy CharityFund**, inspect the network and gas in MetaMask, then sign. Wait for confirmation.
4. Download the generated manifest and save it as `deployments/11155111.json` in this project.
5. Copy `.env.example` to `.env`, set `CHAIN_ID=11155111` and `RPC_URL` to your Sepolia HTTPS JSON-RPC endpoint. Do not place an RPC credential in browser code or commit `.env`.
6. Stop the local demo, install `requirements.txt`, then run `python app.py`. Backend startup verifies the configured network and code address through `/api/health`. Create new Sepolia campaigns and test them with very small amounts of test ETH.
7. Capture the contract address, deployment receipt, donation receipt, wallet approval and explorer records. Add them to the report only after verification.

### Optional CLI deployment

For users who choose a dedicated test-only deployment key: put `DEPLOYER_PRIVATE_KEY` in untracked `.env`, set RPC/chain ID, then run `npm run compile` and `npm run deploy`. Never share the key, use a mainnet wallet key, or commit this file. The wallet method avoids this key handling entirely.

## Public hosting

`render.yaml` defines the live Render Docker web service with a health check. A Node build stage compiles the React interface, and Gunicorn runs the Python Flask application in the final container. The deployed frontend and API share one HTTPS origin; MetaMask signs transactions in the visitor's browser and the Render service never receives wallet private keys. The production service is live at https://clearcause-charity-dapp.onrender.com and reports chain ID `11155111`.

To reproduce the deployment in another Render workspace, provide these environment variables when prompted:

| Variable             | Value                                       |
| -------------------- | ------------------------------------------- |
| `CHAIN_ID`           | `11155111`                                  |
| `RPC_URL`            | A Sepolia HTTPS JSON-RPC endpoint           |
| `CONTRACT_ADDRESS`   | Confirmed Sepolia contract address          |
| `DEPLOYMENT_BLOCK`   | Block containing the deployment transaction |
| `DEPLOYMENT_TX_HASH` | Deployment transaction hash                 |
| `DEPLOYED_AT`        | ISO timestamp for the confirmed deployment  |

`CONTRACT_ADDRESS` and `DEPLOYMENT_BLOCK` replace the local deployment-manifest file on Render. The backend validates the network and checks that bytecode exists at the address before listening. Render supplies `PORT`; the service binds to `0.0.0.0`. The included public RPC default is convenient for coursework, but a dedicated provider is more reliable if it becomes rate-limited.

Connect the GitHub repository in Render and choose **New Blueprint Instance**, or create a Docker Web Service manually. The current service uses Render's free plan and can sleep after inactivity, so open it before a presentation and allow up to about a minute for a cold start. The blockchain state remains on Sepolia when the Render container restarts.

## Security and limitations

The contract uses a reentrancy lock plus checks-effects-interactions; failed external calls revert all prior changes. Pull refunds avoid unbounded donor loops. Solidity 0.8 checked arithmetic and integer wei accounting avoid floating-point balance errors. React escapes campaign text; the API validates parameters, sets Helmet headers and rate-limits calls.

The September 2026 audit records 27 advisories in **Ganache's bundled development dependency tree**, including four critical advisories. These are not represented as fixed or as a clean audit. Ganache is local-only, bound to loopback, and excluded from the runtime Docker stage. `npm audit --omit=dev` can still enumerate these bundled lockfile entries. This is a development-tool limitation; do not expose the local chain, use real funds, or treat this coursework as production-audited software. Review `evidence/dependency-audit.json` and `docs/TESTING.md`.

Campaigns may contain false claims. Blockchain cannot verify off-chain impact or constrain use after withdrawal. Public descriptions and addresses have privacy implications. Long on-chain descriptions cost gas. Centralized frontend/RPC availability, Render free-instance sleep, the bounded history window, limited public-testnet measurement and no independent security audit limit the prototype.

## Submission

Read `docs/SUBMISSION_CHECKLIST.md`. The report PDF has eight pages. A Chinese recording guide and English timed narration replace the video, which the student records. Original screenshots are included. Review the report, add course-required identity details if necessary, and record a genuine MetaMask session before submission. Do not claim that automated wallet-adapter evidence is an extension approval screenshot.

## References

- [Solidity security considerations](https://docs.soliditylang.org/en/latest/security-considerations.html)
- [ethers v6 documentation](https://docs.ethers.org/v6/)
- [MetaMask account management](https://docs.metamask.io/metamask-connect/evm/guides/manage-user-accounts/)
- [Ethereum networks](https://ethereum.org/developers/docs/networks/)
- [Express security practices](https://expressjs.com/en/advanced/best-practice-security/)\n
