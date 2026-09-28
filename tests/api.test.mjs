import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../server/app.mjs";
const service = {
  config: { chainId: 31337 },
  health: async () => {},
  campaigns: async (offset, limit) => ({ offset, limit, items: [] }),
  campaign: async (id) => {
    if (id === 99) throw Object.assign(new Error(), { status: 404 });
    return { id };
  },
  history: async () => ({ items: [] }),
};
const app = createApp(service);
test("API health and network configuration", async () => {
  assert.equal((await request(app).get("/api/health")).body.ok, true);
  assert.equal((await request(app).get("/api/config")).body.chainId, 31337);
});
test("API limits pagination and rejects invalid IDs", async () => {
  for (const url of [
    "/api/campaigns?limit=100",
    "/api/campaigns?offset=-1",
    "/api/campaigns?offset=0.5",
    "/api/campaigns/nan",
  ])
    assert.equal((await request(app).get(url)).status, 400);
});
test("API campaign query returns data and missing campaign is 404", async () => {
  assert.equal((await request(app).get("/api/campaigns/2")).body.id, 2);
  assert.equal((await request(app).get("/api/campaigns/99")).status, 404);
});
test("API validates wallet filter and does not expose stack traces", async () => {
  assert.equal((await request(app).get("/api/history?account=no")).status, 400);
  const broken = createApp({
    ...service,
    health: async () => {
      throw new Error("SECRET_INTERNAL");
    },
  });
  const r = await request(broken).get("/api/health");
  assert.equal(r.status, 503);
  assert.ok(!r.text.includes("SECRET_INTERNAL"));
});
test("API applies security headers and handles unknown endpoints", async () => {
  const r = await request(app).get("/api/health");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.ok(r.headers["content-security-policy"]);
  assert.equal((await request(app).get("/api/unknown")).status, 404);
});
