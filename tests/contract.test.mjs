import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import {
  BrowserProvider,
  ContractFactory,
  parseEther,
  ZeroAddress,
} from "ethers";
import { compile } from "../scripts/compile.mjs";

let rpc, p, creator, donor, other, fund, receiver, compiled, snapshot;
const gas = {};
const eth = parseEther;
const tx = async (promise) => (await promise).wait();
async function now() {
  return Number(
    (
      await rpc.request({
        method: "eth_getBlockByNumber",
        params: ["latest", false],
      })
    ).timestamp,
  );
}
async function create(options = {}) {
  return tx(
    fund.createCampaign(
      options.title ?? "Water access",
      options.description ?? "A demonstrable community water project.",
      options.beneficiary ?? (await creator.getAddress()),
      options.goal ?? eth("1"),
      options.deadline ?? (await now()) + 3600,
      options.category ?? 0,
    ),
  );
}
async function advance(seconds) {
  await rpc.request({ method: "evm_increaseTime", params: [seconds] });
  await rpc.request({ method: "evm_mine", params: [] });
}
before(async () => {
  compiled = compile({
    "Receivers.sol": {
      content: fs.readFileSync("tests/Receivers.sol", "utf8"),
    },
  });
  rpc = ganache.provider({
    logging: { quiet: true },
    wallet: { deterministic: true },
    chain: { chainId: 31337, hardfork: "shanghai" },
  });
  p = new BrowserProvider(rpc);
  p.pollingInterval = 20;
  creator = await p.getSigner(0);
  donor = await p.getSigner(1);
  other = await p.getSigner(2);
  const a = compiled["CharityFund.sol"].CharityFund;
  fund = await new ContractFactory(
    a.abi,
    a.evm.bytecode.object,
    creator,
  ).deploy();
  gas.deployment = String((await fund.deploymentTransaction().wait()).gasUsed);
  const r = compiled["Receivers.sol"].Receiver;
  receiver = await new ContractFactory(
    r.abi,
    r.evm.bytecode.object,
    creator,
  ).deploy(await fund.getAddress());
  await receiver.waitForDeployment();
  snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
});
beforeEach(async () => {
  await rpc.request({ method: "evm_revert", params: [snapshot] });
  snapshot = await rpc.request({ method: "evm_snapshot", params: [] });
});
after(async () => {
  fs.mkdirSync("evidence", { recursive: true });
  fs.writeFileSync(
    "evidence/gas.json",
    JSON.stringify(
      {
        network: "in-process Ganache / Shanghai",
        compiler: "0.8.30",
        optimizerRuns: 200,
        gas,
      },
      null,
      2,
    ),
  );
  await p.destroy();
  await rpc.disconnect();
});
test("deployment starts with zero campaigns", async () =>
  assert.equal(await fund.campaignCount(), 0n));
test("creation stores immutable campaign details and emits event", async () => {
  const r = await create();
  gas.create = String(r.gasUsed);
  assert.equal(await fund.campaignCount(), 1n);
  const c = await fund.getCampaign(0);
  assert.equal(c.title, "Water access");
  assert.equal(c.beneficiary, await creator.getAddress());
  assert.equal(r.logs.length, 1);
});
test("rejects empty title and description", async () => {
  await assert.rejects(create({ title: "" }));
  await assert.rejects(create({ description: "" }));
});
test("rejects oversized UTF-8 metadata", async () => {
  await assert.rejects(create({ title: "水".repeat(33) }));
  await assert.rejects(create({ description: "a".repeat(1601) }));
});
test("rejects zero beneficiary and the fund contract itself", async () => {
  await assert.rejects(create({ beneficiary: ZeroAddress }));
  await assert.rejects(create({ beneficiary: await fund.getAddress() }));
});
test("rejects zero goal and invalid category", async () => {
  await assert.rejects(create({ goal: 0n }));
  await assert.rejects(create({ category: 4 }));
});
test("rejects expired and excessively distant deadlines", async () => {
  await assert.rejects(create({ deadline: await now() }));
  await assert.rejects(create({ deadline: (await now()) + 366 * 86400 }));
});
test("rejects nonexistent campaign reads and donations", async () => {
  await assert.rejects(fund.getCampaign(0));
  await assert.rejects(fund.donate(7, { value: eth(".1") }));
});
test("donation accumulates exact wei and emits event", async () => {
  await create();
  const r = await tx(fund.connect(donor).donate(0, { value: eth(".12") }));
  gas.donate = String(r.gasUsed);
  await tx(fund.connect(donor).donate(0, { value: eth(".08") }));
  assert.equal(
    await fund.contributions(0, await donor.getAddress()),
    eth(".2"),
  );
  assert.equal((await fund.getCampaign(0)).raised, eth(".2"));
  assert.equal(r.logs.length, 1);
});
test("rejects zero donation", async () => {
  await create();
  await assert.rejects(fund.donate(0, { value: 0n }));
});
test("final donation may exceed goal and closes further donations", async () => {
  await create();
  await tx(fund.donate(0, { value: eth("1.1") }));
  assert.equal(await fund.status(0), 1n);
  await assert.rejects(fund.donate(0, { value: 1n }));
});
test("only beneficiary may withdraw a funded campaign", async () => {
  await create();
  await tx(fund.connect(donor).donate(0, { value: eth("1") }));
  await assert.rejects(fund.connect(other).withdraw(0));
});
test("beneficiary receives all funds exactly once", async () => {
  await create({ beneficiary: await other.getAddress() });
  await tx(fund.donate(0, { value: eth("1") }));
  const before = BigInt(
    await rpc.request({
      method: "eth_getBalance",
      params: [await other.getAddress(), "latest"],
    }),
  );
  const r = await tx(fund.connect(other).withdraw(0));
  gas.withdraw = String(r.gasUsed);
  const after = BigInt(
    await rpc.request({
      method: "eth_getBalance",
      params: [await other.getAddress(), "latest"],
    }),
  );
  assert.equal(after - before + r.fee, eth("1"));
  assert.equal(await fund.status(0), 2n);
  await assert.rejects(fund.connect(other).withdraw(0));
  await assert.rejects(fund.refund(0));
});
test("cannot withdraw before target is met", async () => {
  await create();
  await tx(fund.donate(0, { value: eth(".1") }));
  await assert.rejects(fund.withdraw(0));
});
test("donations close exactly at deadline and failed campaign permits refund", async () => {
  const deadline = (await now()) + 30;
  await create({ deadline });
  await tx(fund.connect(donor).donate(0, { value: eth(".2") }));
  await rpc.request({ method: "evm_setTime", params: [deadline * 1000] });
  await rpc.request({ method: "evm_mine", params: [] });
  assert.equal(await fund.status(0), 3n);
  await assert.rejects(fund.donate(0, { value: 1n }));
  const r = await tx(fund.connect(donor).refund(0));
  gas.refund = String(r.gasUsed);
  assert.equal(await fund.contributions(0, await donor.getAddress()), 0n);
  assert.equal((await fund.getCampaign(0)).refunded, eth(".2"));
});
test("refund is unavailable before deadline or on successful campaign", async () => {
  await create();
  await tx(fund.donate(0, { value: eth(".1") }));
  await assert.rejects(fund.refund(0));
  await tx(fund.donate(0, { value: eth(".9") }));
  await advance(3700);
  await assert.rejects(fund.refund(0));
  assert.equal(await fund.status(0), 1n);
});
test("refunds are isolated per donor and cannot be repeated", async () => {
  await create();
  await tx(fund.connect(donor).donate(0, { value: eth(".2") }));
  await tx(fund.connect(other).donate(0, { value: eth(".3") }));
  await advance(3700);
  await tx(fund.connect(donor).refund(0));
  await assert.rejects(fund.connect(donor).refund(0));
  assert.equal(
    await fund.contributions(0, await other.getAddress()),
    eth(".3"),
  );
  await tx(fund.connect(other).refund(0));
  assert.equal((await fund.getCampaign(0)).refunded, eth(".5"));
});
test("non-donor cannot refund", async () => {
  await create();
  await advance(3700);
  await assert.rejects(fund.connect(other).refund(0));
});
test("campaign balances do not subsidize another campaign", async () => {
  await create();
  await create();
  await tx(fund.donate(0, { value: eth("1") }));
  await tx(fund.donate(1, { value: eth(".2") }));
  await tx(fund.withdraw(0));
  assert.equal(
    BigInt(
      await rpc.request({
        method: "eth_getBalance",
        params: [await fund.getAddress(), "latest"],
      }),
    ),
    eth(".2"),
  );
  assert.equal((await fund.getCampaign(1)).raised, eth(".2"));
});
test("failed beneficiary transfer rolls back withdrawn state", async () => {
  await create({ beneficiary: await receiver.getAddress() });
  await tx(fund.donate(0, { value: eth("1") }));
  await tx(receiver.configure(0, true, false));
  await assert.rejects(receiver.collect());
  assert.equal((await fund.getCampaign(0)).withdrawn, false);
  await tx(receiver.configure(0, false, false));
  await tx(receiver.collect({ gasLimit: 200000 }));
  assert.equal(await fund.status(0), 2n);
});
test("failed refund transfer preserves donor balance for retry", async () => {
  await create();
  await tx(receiver.configure(0, true, false));
  await tx(receiver.give({ value: eth(".2") }));
  await advance(3700);
  await assert.rejects(receiver.claim());
  assert.equal(
    await fund.contributions(0, await receiver.getAddress()),
    eth(".2"),
  );
  await tx(receiver.configure(0, false, false));
  await tx(receiver.claim({ gasLimit: 200000 }));
  assert.equal(await fund.contributions(0, await receiver.getAddress()), 0n);
});
test("malicious recipient cannot reenter a refund", async () => {
  await create();
  await tx(receiver.configure(0, false, true));
  await tx(receiver.give({ value: eth(".2") }));
  await tx(fund.connect(donor).donate(0, { value: eth(".3") }));
  await advance(3700);
  await tx(receiver.claim());
  assert.equal(await receiver.reentrySucceeded(), false);
  assert.equal((await fund.getCampaign(0)).refunded, eth(".2"));
  assert.equal(
    BigInt(
      await rpc.request({
        method: "eth_getBalance",
        params: [await fund.getAddress(), "latest"],
      }),
    ),
    eth(".3"),
  );
});
test("unattributed direct ETH transfers revert", async () => {
  await assert.rejects(
    creator.sendTransaction({ to: await fund.getAddress(), value: 1n }),
  );
});
