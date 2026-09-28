import { Contract, formatEther } from "ethers";
const statuses = ["Active", "Funded", "Paid", "Refundable"];
export function createService(provider, deployment, artifact) {
  const contract = new Contract(deployment.address, artifact.abi, provider);
  const config = {
    ...deployment,
    abi: artifact.abi,
    networkName: deployment.chainId === 31337 ? "Local development" : "Sepolia",
    explorer:
      deployment.chainId === 11155111 ? "https://sepolia.etherscan.io" : null,
  };
  const encode = (c, id, timestamp) => ({
    id,
    creator: c.creator,
    beneficiary: c.beneficiary,
    goal: formatEther(c.goal),
    raised: formatEther(c.raised),
    refunded: formatEther(c.refunded),
    deadline: Number(c.deadline),
    withdrawn: c.withdrawn,
    title: c.title,
    description: c.description,
    category: Number(c.category),
    status:
      statuses[
        c.withdrawn
          ? 2
          : c.raised >= c.goal
            ? 1
            : timestamp >= Number(c.deadline)
              ? 3
              : 0
      ],
  });
  async function block() {
    return provider.getBlock("latest");
  }
  async function campaign(id) {
    const b = await block();
    if (BigInt(id) >= (await contract.campaignCount({ blockTag: b.number })))
      throw Object.assign(new Error("Not found"), { status: 404 });
    return encode(
      await contract.getCampaign(id, { blockTag: b.number }),
      id,
      b.timestamp,
    );
  }
  return {
    config,
    artifact,
    async health() {
      if (
        Number((await provider.getNetwork()).chainId) !== deployment.chainId ||
        (await provider.getCode(deployment.address)) === "0x"
      )
        throw new Error("Deployment does not match RPC");
    },
    campaign,
    async campaigns(offset, limit) {
      const b = await block();
      const total = Number(
        await contract.campaignCount({ blockTag: b.number }),
      );
      const ids = Array.from(
        { length: Math.max(0, Math.min(limit, total - offset)) },
        (_, i) => total - 1 - offset - i,
      );
      return {
        total,
        offset,
        blockNumber: b.number,
        items: await Promise.all(
          ids.map(async (id) =>
            encode(
              await contract.getCampaign(id, { blockTag: b.number }),
              id,
              b.timestamp,
            ),
          ),
        ),
      };
    },
    async history(account) {
      const latest = await block();
      // Bounded recent history avoids unbounded RPC work. The UI discloses this window.
      const fromBlock = Math.max(deployment.blockNumber, latest.number - 9999);
      const rows = [];
      for (let from = fromBlock; from <= latest.number; from += 500) {
        const logs = await provider.getLogs({
          address: deployment.address,
          fromBlock: from,
          toBlock: Math.min(from + 499, latest.number),
        });
        for (const log of logs) {
          const parsed = contract.interface.parseLog(log);
          if (!parsed) continue;
          const actor =
            parsed.args.donor || parsed.args.beneficiary || parsed.args.creator;
          if (
            account &&
            actor.toLowerCase() !== account.toLowerCase() &&
            parsed.args.creator?.toLowerCase() !== account.toLowerCase()
          )
            continue;
          rows.push({
            type: parsed.name,
            campaignId: Number(parsed.args.id),
            account: actor,
            amount: parsed.args.amount ? formatEther(parsed.args.amount) : null,
            hash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index,
            confirmations: latest.number - log.blockNumber + 1,
          });
        }
      }
      return {
        fromBlock,
        toBlock: latest.number,
        total: rows.length,
        items: rows.reverse().slice(0, 100),
        limit: 100,
      };
    },
  };
}
