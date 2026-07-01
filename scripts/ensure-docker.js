#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const requiredServices = [
  { name: "PostgreSQL", host: "127.0.0.1", port: 5432 },
  { name: "Redis", host: "127.0.0.1", port: 6379 },
  { name: "MinIO", host: "127.0.0.1", port: 9000 },
];

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

function canConnect({ host, port }, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function servicesAreReachable() {
  const checks = await Promise.all(
    requiredServices.map(async (service) => ({
      ...service,
      reachable: await canConnect(service),
    })),
  );

  const unreachable = checks.filter((service) => !service.reachable);
  if (unreachable.length === 0) {
    console.log("[ensure-docker] Required local services are already reachable.");
    return true;
  }

  const summary = unreachable
    .map((service) => `${service.name} (${service.host}:${service.port})`)
    .join(", ");
  console.log(`[ensure-docker] Missing local services: ${summary}`);
  return false;
}

async function main() {
  if (await servicesAreReachable()) {
    process.exit(0);
  }

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

main().catch((error) => {
  console.error("Docker bootstrap failed.", error);
  process.exit(1);
});
