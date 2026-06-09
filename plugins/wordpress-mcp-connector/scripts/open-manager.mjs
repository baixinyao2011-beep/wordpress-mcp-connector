#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.env.WORDPRESS_MCP_CONNECTOR_ROOT || process.cwd();
const host = "127.0.0.1";

function dashboardUrl() {
  try {
    const runtime = JSON.parse(readFileSync(path.join(root, "data", "runtime.json"), "utf8"));
    if (Number.isInteger(runtime.port)) return `http://${host}:${runtime.port}`;
  } catch {
    // The server creates this file on first start.
  }
  return null;
}

async function isRunning() {
  const url = dashboardUrl();
  if (!url) return false;
  try {
    const response = await fetch(`${url}/api/auth/status`, {
      signal: AbortSignal.timeout(1500)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function startServer() {
  if (!existsSync(`${root}/package.json`)) return false;
  const child = spawn("npm", ["start"], {
    cwd: root,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return true;
}

function openUrl() {
  const url = dashboardUrl();
  if (!url) {
    console.error("Dashboard URL is not available yet. Start the connector once with npm start.");
    process.exit(1);
  }
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

if (!(await isRunning())) {
  startServer();
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

openUrl();
console.log(dashboardUrl());
