import "dotenv/config";
import fs from "node:fs";
import { JsonRpcProvider } from "ethers";
import { createApp } from "./app.mjs";
import { createService } from "./service.mjs";
const chainId = Number(process.env.CHAIN_ID || 31337);
const deploymentFile =
  process.env.DEPLOYMENT_FILE || `deployments/${chainId}.json`;
const deployment = process.env.CONTRACT_ADDRESS
  ? {
      chainId,
      address: process.env.CONTRACT_ADDRESS,
      blockNumber: Number(process.env.DEPLOYMENT_BLOCK || 0),
      transactionHash: process.env.DEPLOYMENT_TX_HASH || null,
      deployedAt: process.env.DEPLOYED_AT || null,
    }
  : JSON.parse(fs.readFileSync(deploymentFile));
if (!/^0x[0-9a-fA-F]{40}$/.test(deployment.address)) {
  throw new Error(
    "CONTRACT_ADDRESS or deployment manifest contains an invalid address.",
  );
}
if (
  !Number.isSafeInteger(deployment.blockNumber) ||
  deployment.blockNumber < 0
) {
  throw new Error("DEPLOYMENT_BLOCK must be a non-negative integer.");
}
const artifact = JSON.parse(fs.readFileSync("artifacts/CharityFund.json"));
const provider = new JsonRpcProvider(
  process.env.RPC_URL || "http://127.0.0.1:8545",
);
const service = createService(provider, deployment, artifact);
await service.health();
createApp(service).listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      "ClearCause ready at http://localhost:" + (process.env.PORT || 3001),
    ),
);

