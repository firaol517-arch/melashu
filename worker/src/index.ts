import http from "node:http";
import { config } from "./config.js";
import { log } from "./log.js";
import { resumeAll, pollAuthRequests, pollOutbox, heartbeat, liveCount } from "./tg.js";

const started = Date.now();
let lastLoop = Date.now();

// Health endpoint for Render / uptime monitors. Exposes counts only — no business data.
http.createServer((req, res) => {
  if (req.url === "/healthz") {
    const healthy = Date.now() - lastLoop < 30_000;
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: healthy, clients: liveCount(), uptimeSec: Math.round((Date.now() - started) / 1000) }));
  }
  res.writeHead(404).end();
}).listen(config.port, () => log.info({ port: config.port }, "worker health endpoint up"));

const every = (ms: number, fn: () => Promise<unknown>, name: string) => {
  let running = false;
  setInterval(async () => { if (running) return; running = true; try { await fn(); } catch (e: any) { log.error({ err: e?.message, job: name }, "job failed"); } finally { running = false; } }, ms);
};

await resumeAll().catch((e) => log.error({ err: e.message }, "resumeAll failed"));
every(config.pollMs, async () => { await pollAuthRequests(); await pollOutbox(); lastLoop = Date.now(); }, "poll");
every(config.heartbeatMs, heartbeat, "heartbeat");

for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { log.info({ sig }, "shutting down"); process.exit(0); });
process.on("unhandledRejection", (e: any) => log.error({ err: e?.message }, "unhandledRejection"));
log.info("telegram worker started");
