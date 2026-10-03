import fs from "node:fs";

export function loadDeployment(env = process.env, readFile = fs.readFileSync) {
  const chainId = Number(env.CHAIN_ID || 31337);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("CHAIN_ID must be a positive integer.");
  }
  const deploymentFile = env.DEPLOYMENT_FILE || `deployments/${chainId}.json`;
  const deployment = env.CONTRACT_ADDRESS
    ? {
        chainId,
        address: env.CONTRACT_ADDRESS,
        blockNumber: Number(env.DEPLOYMENT_BLOCK || 0),
        transactionHash: env.DEPLOYMENT_TX_HASH || null,
        deployedAt: env.DEPLOYED_AT || null,
      }
    : JSON.parse(readFile(deploymentFile));
  if (Number(deployment.chainId) !== chainId) {
    throw new Error("Deployment chain ID does not match CHAIN_ID.");
  }
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
  return deployment;
}\n
