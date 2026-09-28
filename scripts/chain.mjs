import ganache from "ganache";
// Public deterministic DEVELOPMENT accounts, never use on a public network.
const server = ganache.server({
  wallet: { deterministic: true, totalAccounts: 10, defaultBalance: 1000 },
  chain: { chainId: 31337, hardfork: "shanghai" },
  logging: { quiet: true },
});
await server.listen(8545, "127.0.0.1");
console.log(
  "Local development blockchain: http://127.0.0.1:8545 (31337). Accounts are unlocked locally.",
);
process.on("SIGINT", async () => {
  await server.close();
  process.exit();
});
