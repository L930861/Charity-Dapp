import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { JsonRpcProvider } from "ethers";
const rpc = new JsonRpcProvider("http://127.0.0.1:8545");
if ((await rpc.getNetwork()).chainId !== 31337n)
  throw new Error("Browser tests require local network.");
const accounts = await rpc.send("eth_accounts", []);
fs.mkdirSync("evidence/screenshots", { recursive: true });
// This test adapter implements EIP-1193 requests against the REAL local EVM.
// It is not MetaMask. Extension approval screens require manual acceptance testing.
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
});
await context.exposeBinding("localRpc", async (_source, payload) =>
  rpc.send(payload.method, payload.params || []),
);
await context.addInitScript(
  ({ accounts }) => {
    let address = accounts[1],
      chain = "0x7a69",
      connected = false,
      rejectNext = false;
    const handlers = {};
    window.testWallet = {
      switchAccount: (index) => {
        address = accounts[index];
        (handlers.accountsChanged || []).forEach((fn) => fn([address]));
      },
      switchChain: (id) => {
        chain = id;
        (handlers.chainChanged || []).forEach((fn) => fn(id));
      },
      reject: () => {
        rejectNext = true;
      },
    };
    window.ethereum = {
      on: (name, fn) => {
        (handlers[name] ||= []).push(fn);
      },
      removeListener: (name, fn) => {
        handlers[name] = (handlers[name] || []).filter((x) => x !== fn);
      },
      request: async ({ method, params = [] }) => {
        if (method === "eth_requestAccounts") {
          connected = true;
          return [address];
        }
        if (method === "eth_accounts") return connected ? [address] : [];
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") {
          chain = params[0].chainId;
          (handlers.chainChanged || []).forEach((fn) => fn(chain));
          return null;
        }
        if (method === "eth_sendTransaction" && rejectNext) {
          rejectNext = false;
          throw Object.assign(new Error("User rejected"), { code: 4001 });
        }
        return window.localRpc({ method, params });
      },
    };
  },
  { accounts },
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
async function check(name, fn) {
  const start = performance.now();
  await fn();
  results.push({
    name,
    status: "passed",
    durationMs: Math.round(performance.now() - start),
  });
  console.log("PASS", name);
}
const shot = async (name) =>
  page.screenshot({ path: `evidence/screenshots/${name}.png`, fullPage: true });
try {
  await check("Desktop campaign catalogue loads live chain data", async () => {
    await page.goto(process.env.BASE_URL || "http://127.0.0.1:3001");
    await page
      .getByRole("heading", { name: "Small acts.", exact: false })
      .waitFor();
    await page
      .getByRole("heading", { name: "Clean water for a village" })
      .waitFor();
    await shot("01-campaigns-desktop");
  });
  await check("Wallet connection and account display", async () => {
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await page.getByRole("button", { name: /0x.*…/ }).waitFor();
  });
  await check(
    "Wrong network prevents donations and can be switched",
    async () => {
      await page
        .getByRole("heading", { name: "Clean water for a village" })
        .click();
      await page.evaluate(() => window.testWallet.switchChain("0x1"));
      await page
        .getByRole("button", {
          name: "Switch to Local development",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Donate with MetaMask" })
          .isDisabled(),
        true,
      );
      await shot("02-wrong-network");
      await page
        .getByRole("button", {
          name: "Switch to Local development",
          exact: true,
        })
        .click();
    },
  );
  await check("Zero amount is rejected before wallet submission", async () => {
    await page.getByLabel("Your contribution (ETH)").fill("0");
    await page.getByRole("button", { name: "Donate with MetaMask" }).click();
    await page.getByRole("alert").filter({ hasText: "positive ETH" }).waitFor();
    await shot("03-validation");
    await page.getByRole("button", { name: "Dismiss error" }).click();
  });
  await check("Wallet rejection yields recoverable error", async () => {
    await page.getByLabel("Your contribution (ETH)").fill("0.01");
    await page.evaluate(() => window.testWallet.reject());
    await page.getByRole("button", { name: "Donate with MetaMask" }).click();
    await page.getByRole("alert").filter({ hasText: "declined" }).waitFor();
    await page.getByRole("button", { name: "Dismiss error" }).click();
  });
  await check("Donation confirms on local chain", async () => {
    await page.getByRole("button", { name: "Donate with MetaMask" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Confirmed on chain" })
      .waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () =>
        document.querySelector("main").getAttribute("aria-busy") === "false",
    );
    await shot("04-donation-confirmed");
  });
  await check("Personal history includes confirmed donation", async () => {
    await page
      .getByRole("button", { name: "My activity", exact: true })
      .click();
    await page
      .getByRole("cell", { name: "Donated", exact: true })
      .first()
      .waitFor();
    await shot("05-history");
  });
  await check("Expired unsuccessful campaign refunds donor", async () => {
    await page.getByRole("button", { name: "Explore", exact: true }).click();
    await page
      .getByRole("heading", { name: "Emergency shelter supplies" })
      .click();
    const claim = page.getByRole("button", {
      name: "Claim refund",
      exact: true,
    });
    await claim.waitFor();
    await claim.click();
    await page
      .getByRole("status")
      .filter({ hasText: "Confirmed on chain" })
      .waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () =>
        document.querySelector("main").getAttribute("aria-busy") === "false",
    );
    await shot("06-refund");
  });
  await check("Account change enables beneficiary withdrawal", async () => {
    await page.evaluate(() => window.testWallet.switchAccount(0));
    await page.getByRole("button", { name: "Explore", exact: true }).click();
    await page
      .getByRole("heading", { name: "Community health essentials" })
      .click();
    await page
      .getByRole("button", { name: "Withdraw funds", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Confirmed on chain" })
      .waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () =>
        document.querySelector("main").getAttribute("aria-busy") === "false",
    );
    await page
      .getByText("Funds have been released to the beneficiary.", {
        exact: false,
      })
      .waitFor();
    await shot("07-withdrawal");
  });
  await check("Campaign creation through the full UI", async () => {
    await page.getByRole("button", { name: "Explore", exact: true }).click();
    await page.getByRole("button", { name: /Start a campaign/ }).click();
    await page
      .getByLabel("Campaign title", { exact: true })
      .fill("Community library access");
    await page
      .getByLabel("Description", { exact: true })
      .fill(
        "Fictional test campaign supporting accessible reading materials. Created by the browser integration test on the local chain.",
      );
    await page.getByLabel("Beneficiary wallet").fill(accounts[0]);
    await page.getByLabel("Target (ETH)").fill("0.2");
    const date = new Date(Date.now() + 7 * 86400000);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    await page
      .getByLabel("Deadline (your local time)")
      .fill(date.toISOString().slice(0, 16));
    await page.getByRole("combobox").selectOption("1");
    await shot("08-create-campaign");
    await page
      .getByRole("button", { name: "Create on chain", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Community library access", exact: true })
      .waitFor({ timeout: 20000 });
  });
  await check("Mobile layout has no horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Explore", exact: true }).click();
    await shot("09-mobile");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
  });
  await check("No uncaught browser application errors", async () =>
    assert.deepEqual(errors, []),
  );
  const naked = await browser.newContext();
  const q = await naked.newPage();
  await check("Missing wallet gives actionable guidance", async () => {
    await q.goto(process.env.BASE_URL || "http://127.0.0.1:3001");
    await q
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await q
      .getByRole("alert")
      .filter({ hasText: "Install MetaMask" })
      .waitFor();
  });
  await naked.close();
} finally {
  fs.writeFileSync(
    "evidence/browser-results.json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        network: "local Ganache 31337",
        wallet: "EIP-1193 test adapter, not the MetaMask extension",
        results,
        errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await rpc.destroy();
}
