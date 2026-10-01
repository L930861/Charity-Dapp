import "dotenv/config";
import fs from "node:fs";
import { JsonRpcProvider } from "ethers";
import { createApp } from "./app.mjs";
import { loadDeployment } from "./deployment.mjs";
import { createService } from "./service.mjs";
const chainId = Number(process.env.CHAIN_ID || 31337);
const deployment = loadDeployment();
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

