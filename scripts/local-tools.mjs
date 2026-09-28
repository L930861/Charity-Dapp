import { JsonRpcProvider, Contract, isAddress, parseEther } from "ethers";
import fs from "node:fs";
const p = new JsonRpcProvider("http://127.0.0.1:8545");
if ((await p.getNetwork()).chainId !== 31337n)
  throw new Error("This helper only supports local development.");
const [action, arg, value] = process.argv.slice(2);
try {
  if (action === "fund") {
    if (!isAddress(arg))
      throw new Error("Usage: npm run local -- fund 0xYourMetaMaskAddress");
    const t = await (
      await p.getSigner(0)
    ).sendTransaction({ to: arg, value: parseEther("10") });
    await t.wait();
    console.log("Sent 10 LOCAL test ETH to", arg);
  } else if (action === "advance") {
    const seconds = Number(arg);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 366 * 86400)
      throw new Error("Provide a positive number of seconds, up to one year.");
    await p.send("evm_increaseTime", [seconds]);
    await p.send("evm_mine", []);
    console.log("Advanced LOCAL chain by", seconds, "seconds.");
  } else if (action === "donate") {
    if (!/^\d+$/.test(arg) || !value || parseEther(value) <= 0n)
      throw new Error("Usage: npm run local -- donate CAMPAIGN_ID ETH_AMOUNT");
    const d = JSON.parse(fs.readFileSync("deployments/31337.json"));
    const a = JSON.parse(fs.readFileSync("artifacts/CharityFund.json"));
    const c = new Contract(d.address, a.abi, await p.getSigner(2));
    const r = await (await c.donate(arg, { value: parseEther(value) })).wait();
    console.log("Local helper donation:", r.hash);
  } else
    throw new Error(
      "Actions: fund ADDRESS | advance SECONDS | donate CAMPAIGN_ID ETH_AMOUNT",
    );
} finally {
  await p.destroy();
}
