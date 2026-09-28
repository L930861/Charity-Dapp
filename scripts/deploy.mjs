import "dotenv/config";
import fs from "node:fs";
import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";
const provider = new JsonRpcProvider(
  process.env.RPC_URL || "http://127.0.0.1:8545",
);
const chainId = Number((await provider.getNetwork()).chainId);
if (![31337, 11155111].includes(chainId))
  throw new Error("Only local development and Sepolia are supported.");
if (process.env.CHAIN_ID && chainId !== Number(process.env.CHAIN_ID))
  throw new Error("RPC network differs from CHAIN_ID.");
const signer =
  chainId === 31337
    ? await provider.getSigner(0)
    : new Wallet(process.env.DEPLOYER_PRIVATE_KEY || "", provider);
const artifact = JSON.parse(fs.readFileSync("artifacts/CharityFund.json"));
const contract = await new ContractFactory(
  artifact.abi,
  artifact.bytecode,
  signer,
).deploy();
const receipt = await contract.deploymentTransaction().wait();
const deployment = {
  chainId,
  address: await contract.getAddress(),
  blockNumber: receipt.blockNumber,
  transactionHash: receipt.hash,
  deployedAt: new Date().toISOString(),
};
fs.mkdirSync("deployments", { recursive: true });
fs.writeFileSync(
  `deployments/${chainId}.json`,
  JSON.stringify(deployment, null, 2),
);
console.log(JSON.stringify(deployment, null, 2));
await provider.destroy();
