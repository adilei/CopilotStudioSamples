#!/usr/bin/env node

/**
 * Cross-platform script to start both MCP servers + devtunnels.
 * Optionally deploys connectors automatically after tunnels are ready.
 *
 * Usage:
 *   node scripts/start.mjs                           # Start servers + tunnels only
 *   node scripts/start.mjs --env <environment-id>    # Also deploy connectors after tunnels are ready
 */

import { spawn, execSync } from "child_process";
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Parse --env flag
let envId = null;
const envIdx = process.argv.indexOf("--env");
if (envIdx !== -1 && process.argv[envIdx + 1]) {
  envId = process.argv[envIdx + 1];
}

const servers = [
  { name: "Order Management", dir: "mcp-servers/order-management", port: 3000, tunnelUrl: null },
  { name: "Warehouse", dir: "mcp-servers/warehouse", port: 3001, tunnelUrl: null },
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
    if (text.includes("Connect via browser")) {
      const urls = text.match(/https:\/\/[^\s,]+/g);
      if (urls) {
        const clean = urls.find((u) => u.includes(`-${server.port}.`)) ?? urls[0];
        const base = clean.replace(/\/$/, "");
        server.tunnelUrl = base;
        console.log(`\n  ${server.name} MCP endpoint: ${base}/mcp\n`);
        checkAllTunnelsReady();
      }
    }
  });
  proc.stderr.on("data", (d) => process.stderr.write(d));
  children.push(proc);
  return proc;
}

function checkAllTunnelsReady() {
  if (servers.every((s) => s.tunnelUrl)) {
    console.log("All tunnels ready.\n");
    if (envId) {
      deployConnectors();
    } else {
      console.log("To deploy connectors, restart with --env <environment-id>");
      console.log("Or run manually:");
      console.log(`  node scripts/deploy-connectors.mjs ${servers.map((s) => s.tunnelUrl).join(" ")}\n`);
    }
  }
}

function deployConnector(name, connectorDir, tunnelUrl) {
  console.log(`  Deploying ${name} connector...`);

  const tmpDir = mkdtempSync(join(tmpdir(), `connector-${name}-`));
  cpSync(connectorDir, tmpDir, { recursive: true });

  const swaggerPath = join(tmpDir, "apiDefinition.swagger.json");
  let swagger = readFileSync(swaggerPath, "utf-8");
  const host = tunnelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  swagger = swagger.replace("TUNNEL_HOST_PLACEHOLDER", host);
  writeFileSync(swaggerPath, swagger);

  const paconn = process.platform === "win32" ? "paconn" : "python3 -m paconn";
  try {
    execSync(
      `${paconn} update --api-def "${join(tmpDir, "apiDefinition.swagger.json")}" --api-prop "${join(tmpDir, "apiProperties.json")}" --env "${envId}"`,
      { stdio: "inherit" }
    );
    console.log(`  ✓ ${name} connector updated (host: ${host})`);
  } catch {
    // update failed — try create instead (first time)
    try {
      execSync(
        `${paconn} create --api-def "${join(tmpDir, "apiDefinition.swagger.json")}" --api-prop "${join(tmpDir, "apiProperties.json")}" --env "${envId}"`,
        { stdio: "inherit" }
      );
      console.log(`  ✓ ${name} connector created (host: ${host})`);
    } catch (e) {
      console.error(`  ✗ Failed to deploy ${name} connector. Run 'paconn login' first?`);
    }
  }
}

function deployConnectors() {
  console.log("=== Deploying connectors to environment", envId, "===\n");
  deployConnector("Order Management", resolve(ROOT, "connectors/order-management"), servers[0].tunnelUrl);
  deployConnector("Warehouse", resolve(ROOT, "connectors/warehouse"), servers[1].tunnelUrl);
  console.log("\n=== Connectors deployed. Servers running. Press Ctrl+C to stop. ===\n");
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
if (envId) {
  console.log(`Environment: ${envId} (connectors will auto-deploy after tunnels are ready)\n`);
}

for (const server of servers) {
  startServer(server);
  startTunnel(server);
}

console.log("Servers starting. Tunnel URLs will appear below.\n");
console.log("Press Ctrl+C to stop all servers.\n");
