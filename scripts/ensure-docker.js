#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
}

function commandExists(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore", shell: false });
  return result.status === 0;
}

function getComposeCommand() {
  if (commandExists("docker", ["compose", "version"])) {
    return { command: "docker", args: ["compose"] };
  }

  if (commandExists("docker-compose", ["version"])) {
    return { command: "docker-compose", args: [] };
  }

  return null;
}

function main() {
  const compose = getComposeCommand();
  if (!compose) {
    console.error("Docker Compose is not available. Install Docker Desktop or docker-compose.");
    process.exit(1);
  }

  const args = [...compose.args, "up", "-d"];
  const result = run(compose.command, args);
  if (result.status !== 0) {
    console.error("Docker Compose failed. Ensure Docker is running.");
    process.exit(result.status ?? 1);
  }
}

main();
