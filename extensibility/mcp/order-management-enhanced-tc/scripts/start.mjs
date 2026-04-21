#!/usr/bin/env node

/**
 * Cross-platform script to start both MCP servers + devtunnels.
 * Prints the tunnel URLs for connector deployment.
 *
 * Usage: node scripts/start.mjs
 */

import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const servers = [
  { name: "Order Management", dir: "mcp-servers/order-management", port: 3000 },
  { name: "Warehouse", dir: "mcp-servers/warehouse", port: 3001 },
];

const children = [];

function startServer(server) {
  const cwd = resolve(ROOT, server.dir);
  const proc = spawn("node", ["dist/start.js"], {
    cwd,
    env: { ...process.env, PORT: String(server.port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stdout.write(`[${server.name}] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[${server.name}] ${d}`));
  children.push(proc);
  return proc;
}

function startTunnel(server) {
  const proc = spawn("devtunnel", ["host", "-p", String(server.port), "-a"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout.on("data", (data) => {
    const text = data.toString();
    // Extract and print the clean tunnel URL
    if (text.includes("Connect via browser")) {
      const urls = text.match(/https:\/\/[^\s,]+/g);
      if (urls) {
        const clean = urls.find((u) => u.includes(`-${server.port}.`)) ?? urls[0];
        const base = clean.replace(/\/$/, "");
        console.log(`\n  ${server.name} MCP endpoint: ${base}/mcp\n`);
      }
    }
  });
  proc.stderr.on("data", (d) => process.stderr.write(d));
  children.push(proc);
  return proc;
}

// Cleanup on exit
function cleanup() {
  for (const child of children) {
    try { child.kill(); } catch {}
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

console.log("Starting MCP servers and devtunnels...\n");

for (const server of servers) {
  startServer(server);
  startTunnel(server);
}

console.log("Servers starting. Tunnel URLs will appear below.\n");
console.log("Use the tunnel URLs to:");
console.log("  1. Deploy connectors: node scripts/deploy-connectors.mjs <env-id> <order-url> <warehouse-url>");
console.log("  2. Configure in Copilot Studio MCP actions\n");
console.log("Press Ctrl+C to stop all servers.\n");
