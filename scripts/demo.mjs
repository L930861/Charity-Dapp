import { spawn } from "node:child_process";
import net from "node:net";
// A demo must remain local even when .env is configured for Sepolia.
Object.assign(process.env, {
  RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  DEPLOYMENT_FILE: "deployments/31337.json",
  PORT: "3001",
  HOST: "127.0.0.1",
});
async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${port} is already in use. Stop the previous demo first.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}
const children = [];
const run = (file) =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [file], { stdio: "inherit" });
    children.push(p);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`)),
    );
  });
const stop = () => children.forEach((p) => p.kill());
process.on("SIGINT", () => {
  stop();
  process.exit();
});
process.on("exit", stop);
try {
  await requireFreePort(8545);
  await requireFreePort(3001);
  await run("scripts/compile.mjs");
  const chain = spawn(process.execPath, ["scripts/chain.mjs"], {
    stdio: "inherit",
  });
  children.push(chain);
  await new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const r = await fetch("http://127.0.0.1:8545", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_chainId",
            params: [],
          }),
        });
        if ((await r.json()).result === "0x7a69") {
          clearInterval(timer);
          resolve();
        }
      } catch {}
    }, 300);
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error("Local chain startup timed out"));
    }, 15000).unref();
    chain.once("exit", () => {
      clearInterval(timer);
      reject(new Error("Port 8545 may already be in use"));
    });
  });
  await run("scripts/deploy.mjs");
  await run("scripts/seed.mjs");
  await run("server/index.mjs");
} catch (error) {
  console.error(error.message);
  stop();
  process.exitCode = 1;
}
