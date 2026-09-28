import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { isAddress } from "ethers";
import path from "node:path";

export function createApp(service) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "connect-src": [
            "'self'",
            "https:",
            "http://127.0.0.1:8545",
            "http://localhost:8545",
          ],
        },
      },
    }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.get("/api/health", async (_req, res) => {
    await service.health();
    res.json({ ok: true });
  });
  app.get("/api/config", (_req, res) => res.json(service.config));
  app.get("/api/artifact", (_req, res) => res.json(service.artifact));
  app.get("/api/campaigns", async (req, res) => {
    const offset = Number(req.query.offset || 0),
      limit = Number(req.query.limit || 20);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      return res.status(400).json({ error: "Invalid pagination." });
    res.json(await service.campaigns(offset, limit));
  });
  app.get("/api/campaigns/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 0)
      return res.status(400).json({ error: "Invalid campaign ID." });
    res.json(await service.campaign(id));
  });
  app.get("/api/history", async (req, res) => {
    const account = req.query.account;
    if (account && (typeof account !== "string" || !isAddress(account)))
      return res.status(400).json({ error: "Invalid wallet address." });
    res.json(await service.history(account));
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.use(express.static(path.resolve("dist")));
  app.get("/{*splat}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
  app.use((error, _req, res, _next) => {
    const status = error.status || 503;
    res
      .status(status)
      .json({
        error:
          status === 404
            ? "Campaign not found."
            : "Blockchain service unavailable. Check the RPC connection and deployment.",
      });
  });
  return app;
}
