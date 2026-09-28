import fs from "node:fs";
import { JsonRpcProvider, Contract, parseEther } from "ethers";
const provider = new JsonRpcProvider("http://127.0.0.1:8545");
if ((await provider.getNetwork()).chainId !== 31337n)
  throw new Error("Seed is local-only.");
const deployment = JSON.parse(fs.readFileSync("deployments/31337.json"));
const abi = JSON.parse(fs.readFileSync("artifacts/CharityFund.json")).abi;
const owner = await provider.getSigner(0),
  donor = await provider.getSigner(1);
const c = new Contract(deployment.address, abi, owner);
if ((await c.campaignCount()) !== 0n)
  throw new Error("Seed requires a fresh deployment.");
const now = (await provider.getBlock("latest")).timestamp;
const samples = [
  [
    "Clean water for a village",
    "Coursework demonstration campaign. Help fund a community water filtration system, including installation and maintenance training. This fictional campaign demonstrates transparent, goal-based giving; no real charity affiliation is claimed.",
    "2",
    now + 86400 * 20,
    0,
  ],
  [
    "Learning without barriers",
    "Coursework demonstration campaign. Equip a shared learning space with textbooks and accessible learning materials. The beneficiary can collect only after the funding goal is reached.",
    "1",
    now + 86400 * 14,
    1,
  ],
  [
    "Community health essentials",
    "Coursework demonstration campaign. Support essential supplies for a community health programme. This funded example demonstrates the beneficiary withdrawal workflow.",
    "0.5",
    now + 86400 * 10,
    2,
  ],
  [
    "Emergency shelter supplies",
    "Coursework demonstration campaign. This deliberately short campaign demonstrates the refund protection available when a deadline passes before the goal is met.",
    "3",
    now + 60,
    3,
  ],
];
for (const [title, description, goal, deadline, category] of samples)
  await (
    await c.createCampaign(
      title,
      description,
      await owner.getAddress(),
      parseEther(goal),
      deadline,
      category,
    )
  ).wait();
for (const [id, amount] of [
  [0, "0.72"],
  [1, "0.35"],
  [2, "0.5"],
  [3, "0.2"],
])
  await (
    await c.connect(donor).donate(id, { value: parseEther(amount) })
  ).wait();
await provider.send("evm_increaseTime", [65]);
await provider.send("evm_mine", []);
console.log(
  "Seeded 4 fictional campaigns; account 0 is beneficiary, account 1 is donor.",
);
await provider.destroy();
