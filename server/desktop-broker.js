import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readlinkSync, statSync, unlinkSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { desktopBridgePipePath, ensureDesktopBridgeSecret } from "./desktop-bridge-common.js";

const brokerDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(brokerDir, "..");
const desktopArgs = process.argv.slice(2);
const realCodex = resolveRealCodex();

function runPassthrough() {
  const child = spawn(realCodex.command, [...realCodex.prefixArgs, ...desktopArgs], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: childEnvironment()
  });
  bomStrippedStdin().pipe(child.stdin);
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.on("error", failFatal);
  child.on("exit", (code, signal) => process.exitCode = code ?? signalExitCode(signal));
}

function isPipeListening(pipePath, timeoutMs = 200) {
  return new Promise((resolve) => {
    const socket = net.createConnection(pipePath);
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

if (!isPrimaryAppServerInvocation(desktopArgs) || (await isPipeListening(desktopBridgePipePath()))) {
  runPassthrough();
} else {
  await runBroker();
}

async function runBroker() {
  const secret = await ensureDesktopBridgeSecret();
  const pipePath = desktopBridgePipePath();
  if (process.platform !== "win32" && existsSync(pipePath)) unlinkSync(pipePath);

  const child = spawn(realCodex.command, [...realCodex.prefixArgs, ...desktopArgs], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: childEnvironment()
  });
  const clients = new Set();
  const pending = new Map();
  const serverRequests = new Set();
  let managedWebUi = null;
  let managedWebUiStarted = false;
  let restartTimer = null;
  const crashTimestamps = [];
  const MAX_CRASH_WINDOW_MS = 30000;
  const MAX_CRASH_COUNT = 3;
  let markPipeReady;
  const pipeReady = new Promise((resolve) => markPipeReady = resolve);
  let nextInternalId = 1;

  const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    socket.authenticated = false;
    const rl = readline.createInterface({ input: socket });
    rl.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        sendSocket(socket, { type: "bridge-error", error: "Invalid JSON" });
        return;
      }
      if (!socket.authenticated) {
        if (message.type !== "hello" || !sameSecret(message.token, secret)) {
          sendSocket(socket, { type: "hello", ok: false, error: "Unauthorized" });
          socket.end();
          return;
        }
        socket.authenticated = true;
        clients.add(socket);
        sendSocket(socket, { type: "hello", ok: true, hostRuntime: "windows" });
        return;
      }
      handleClientMessage(socket, message);
    });
    socket.on("close", () => {
      clients.delete(socket);
      for (const [id, route] of pending) {
        if (route.socket === socket) pending.delete(id);
      }
    });
  });

  function handleClientMessage(socket, message) {
    if (message.type === "request") {
      const id = nextInternalId++;
      pending.set(id, {
        destination: "webui",
        socket,
        originalId: message.requestId,
        method: message.method
      });
      sendChild({ id, method: message.method, params: message.params || {} });
      return;
    }
    if (message.type === "server-response") {
      const key = String(message.id);
      if (!serverRequests.delete(key)) {
        sendSocket(socket, {
          type: "response",
          requestId: message.requestId,
          error: { message: "Server request is no longer pending" }
        });
        return;
      }
      sendChild({ id: message.id, result: message.result });
      broadcast({ type: "server-request-resolved", id: message.id });
      sendSocket(socket, { type: "response", requestId: message.requestId, result: {} });
      return;
    }
    sendSocket(socket, { type: "bridge-error", error: "Unknown bridge message type" });
  }

  function handleDesktopMessage(message) {
    if (message?.method === "initialize") {
      pipeReady.then(startManagedWebUiOnce).catch((error) => {
        process.stderr.write(`[codex-webui-bridge] WebUI lifecycle startup failed: ${error.message}\n`);
      });
    }
    if (message?.id !== undefined && message?.method) {
      const id = nextInternalId++;
      pending.set(id, {
        destination: "desktop",
        originalId: message.id,
        method: message.method
      });
      sendChild({ ...message, id });
      return;
    }
    if (message?.id !== undefined && !message?.method) {
      if (!serverRequests.delete(String(message.id))) {
        process.stderr.write(`[codex-webui-bridge] Ignored duplicate server response ${message.id}\n`);
        return;
      }
      broadcast({ type: "server-request-resolved", id: message.id });
    }
    sendChild(message);
  }

  function handleChildMessage(message) {
    if (message?.id !== undefined && !message?.method && pending.has(message.id)) {
      const route = pending.get(message.id);
      pending.delete(message.id);
      const restored = { ...message, id: route.originalId };
      if (route.destination === "desktop") writeDesktop(restored);
      else sendSocket(route.socket, {
        type: "response",
        requestId: route.originalId,
        ...(message.error ? { error: message.error } : { result: message.result })
      });
      return;
    }
    if (message?.id !== undefined && message?.method) serverRequests.add(String(message.id));
    writeDesktop(message);
    broadcast({ type: "appserver", message });
  }

  function sendChild(message) {
    if (!child.stdin.writable) throw new Error("Real Codex app-server is not writable");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function writeDesktop(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }

  function broadcast(message) {
    for (const socket of clients) sendSocket(socket, message);
  }

  function attachManagedWebUi(webUi) {
    managedWebUi = webUi;
    webUi.on("error", (error) => {
      process.stderr.write(`[codex-webui-bridge] Managed WebUI error: ${error.message}\n`);
    });
    webUi.on("exit", (code, signal) => {
      process.stderr.write(`[codex-webui-bridge] Managed WebUI exited (${code ?? signal ?? "unknown"}).\n`);
      if (managedWebUi === webUi) {
        managedWebUi = null;
      }
      if (closing) return;

      const now = Date.now();
      crashTimestamps.push(now);
      while (crashTimestamps.length > 0 && now - crashTimestamps[0] > MAX_CRASH_WINDOW_MS) {
        crashTimestamps.shift();
      }

      if (crashTimestamps.length > MAX_CRASH_COUNT) {
        process.stderr.write(
          `[codex-webui-bridge] Managed WebUI exited ${crashTimestamps.length} times within ${MAX_CRASH_WINDOW_MS / 1000}s. Circuit breaker tripped; auto-restart paused.\n`
        );
        return;
      }

      const backoffMs = Math.min(1000 * Math.pow(2, crashTimestamps.length - 1), 5000);
      process.stderr.write(`[codex-webui-bridge] Scheduling Managed WebUI restart in ${backoffMs}ms...\n`);
      clearTimeout(restartTimer);
      restartTimer = setTimeout(async () => {
        if (closing) return;
        try {
          const restarted = await startManagedWebUi();
          if (restarted) {
            if (closing) {
              restarted.kill("SIGTERM");
            } else {
              attachManagedWebUi(restarted);
            }
          }
        } catch (error) {
          process.stderr.write(`[codex-webui-bridge] Failed to restart WebUI: ${error.message}\n`);
        }
      }, backoffMs);
    });
  }

  function startManagedWebUiOnce() {
    if (managedWebUiStarted) return;
    managedWebUiStarted = true;
    startManagedWebUi().then((startedWebUi) => {
      if (!startedWebUi) return;
      if (closing) {
        startedWebUi.kill("SIGTERM");
      } else {
        attachManagedWebUi(startedWebUi);
      }
    }).catch((error) => {
      process.stderr.write(`[codex-webui-bridge] WebUI lifecycle startup failed: ${error.message}\n`);
    });
  }

  const desktopInput = bomStrippedStdin();
  readline.createInterface({ input: desktopInput }).on("line", (line) => {
    try {
      handleDesktopMessage(JSON.parse(line));
    } catch (error) {
      process.stderr.write(`[codex-webui-bridge] Invalid Desktop message: ${error.message}\n`);
    }
  });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      handleChildMessage(JSON.parse(line));
    } catch {
      process.stdout.write(`${line}\n`);
    }
  });
  child.stderr.pipe(process.stderr);

  server.on("error", failFatal);
  child.on("error", failFatal);
  let closing = false;

  const closeBroker = (code, signal) => {
    if (closing) return;
    closing = true;
    clearTimeout(restartTimer);
    restartTimer = null;
    if (managedWebUi && !managedWebUi.killed) managedWebUi.kill("SIGTERM");
    broadcast({ type: "bridge-error", error: `Codex app-server exited (${code ?? signal ?? "unknown"})` });
    for (const socket of clients) socket.destroy();
    desktopInput.destroy();
    server.close(() => {
      if (signal) process.exit(signalExitCode(signal));
    });
    process.exitCode = code ?? signalExitCode(signal);
  };

  child.on("exit", closeBroker);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      child.kill(signal);
      closeBroker(null, signal);
    });
  }
  desktopInput.on("end", () => child.stdin.end());
  try {
    await new Promise((resolve, reject) => server.listen(pipePath, resolve).once("error", reject));
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      server.close();
      if (!child.killed) child.kill();
      runPassthrough();
      return;
    }
    throw error;
  }
  markPipeReady();
}

async function startManagedWebUi() {
  if (!desktopWebUiLifecycleEnabled()) {
    process.stderr.write("[codex-webui-bridge] Desktop-managed WebUI startup is disabled.\n");
    return null;
  }

  const port = desktopWebUiPort();
  if (await isTcpPortListening(port)) {
    process.stderr.write(`[codex-webui-bridge] Port ${port} is already listening; preserving the existing service.\n`);
    return null;
  }

  const dataDir = resolveWebUiDataDir();
  mkdirSync(dataDir, { recursive: true });
  const outputFd = openSync(path.join(dataDir, "codex-webui.log"), "a");
  const errorFd = openSync(path.join(dataDir, "codex-webui.err.log"), "a");
  let webUi;
  try {
    webUi = spawn(process.execPath, [path.join(projectRoot, "server", "index.js")], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: String(process.env.CODEX_WEBUI_HOST_ADDRESS || "0.0.0.0"),
        CODEX_WEBUI_DATA_DIR: dataDir,
        CODEX_WEBUI_TERMINAL_QR: "0"
      },
      stdio: ["ignore", outputFd, errorFd],
      windowsHide: true
    });
  } finally {
    closeSync(outputFd);
    closeSync(errorFd);
  }
  process.stderr.write(`[codex-webui-bridge] Started Desktop-managed WebUI on port ${port} (PID ${webUi.pid}).\n`);
  return webUi;
}

function desktopWebUiLifecycleEnabled() {
  const value = String(process.env.CODEX_WEBUI_DESKTOP_LIFECYCLE || "1").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

function desktopWebUiPort() {
  const port = Number(process.env.CODEX_WEBUI_PORT || 9526);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Codex WebUI port: ${process.env.CODEX_WEBUI_PORT}`);
  }
  return port;
}

function resolveWebUiDataDir() {
  const explicit = String(process.env.CODEX_WEBUI_DATA_DIR || "").trim();
  if (explicit) return path.resolve(explicit);
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "CodexWebUI");
}

function isTcpPortListening(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

function isPrimaryAppServerInvocation(args) {
  const index = args.indexOf("app-server");
  return index >= 0
    && args.includes("--analytics-default-enabled")
    // `--print-startup-config` is a one-shot probe: the core writes a single JSON
    // line to stdout and exits. It must stay transparent (passthrough), otherwise
    // the broker keeps the pipe open and Codex Desktop reports a protocol error
    // on its startup policy gate.
    && !args.includes("--print-startup-config")
    && !args.includes("--listen")
    && args[index + 1] !== "daemon"
    && args[index + 1] !== "proxy";
}

// The MSIX app-execution-alias directory is recreated on every Codex update and
// its entries are symlinks into the live package, so resolving one of them keeps
// this bridge pinned to the installed desktop build without enumerating
// C:\Program Files\WindowsApps (EPERM for non-admin users).
function resolvePackagedAppCore(localAppData) {
  const bases = [];
  if (localAppData) bases.push(localAppData);
  const profile = process.env.USERPROFILE || os.homedir();
  if (profile) bases.push(path.join(profile, "AppData", "Local"));
  for (const base of bases) {
    const aliasPath = path.join(
      base,
      "Microsoft",
      "WindowsApps",
      "OpenAI.Codex_2p2nqsd0c76g0",
      "codex-core-command-runner.exe"
    );
    try {
      const target = readlinkSync(aliasPath);
      const resourcesDir = path.dirname(path.resolve(path.dirname(aliasPath), target));
      const candidate = path.join(resourcesDir, "codex.exe");
      if (existsSync(candidate)) return candidate;
    } catch {
      // Alias missing or not a symlink on this install: try the next base.
    }
  }
  return null;
}

function resolveRealCodex() {
  const explicit = String(process.env.CODEX_DESKTOP_BRIDGE_CODEX_PATH || "").trim();
  const prefixArgs = parsePrefixArgs();
  if (explicit) return { command: explicit, prefixArgs };
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    // Codex Desktop refuses an app-server whose build differs from its own, so
    // prefer the core shipped with the live package over a standalone CLI copy
    // in %LOCALAPPDATA%\OpenAI\Codex\bin (those lag behind app updates).
    // NOTE: never trust CODEX_APP_RUNTIME_CLI_PATH here — when this bridge is the
    // override, the desktop sets it to the bridge itself and following it forks.
    const packaged = resolvePackagedAppCore(localAppData);
    if (packaged) return { command: packaged, prefixArgs };
    const root = path.join(localAppData, "OpenAI", "Codex", "bin");
    try {
      const command = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, "codex.exe"))
        .filter((candidate) => existsSync(candidate))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      if (command) return { command, prefixArgs };
    } catch {
      // Fall through to PATH.
    }
  }
  return { command: "codex", prefixArgs };
}

function parsePrefixArgs() {
  const raw = String(process.env.CODEX_DESKTOP_BRIDGE_CODEX_ARGS_JSON || "").trim();
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("CODEX_DESKTOP_BRIDGE_CODEX_ARGS_JSON must be a JSON string array");
  }
  return value;
}

function childEnvironment() {
  const env = { ...process.env };
  delete env.CODEX_CLI_PATH;
  delete env.CODEX_DESKTOP_BRIDGE_HOST;
  delete env.CODEX_DESKTOP_BRIDGE_HOST_OVERRIDE;
  delete env.CODEX_DESKTOP_BRIDGE_TRANSPORT;
  delete env.CODEX_DESKTOP_BRIDGE_PORT;
  delete env.CODEX_DESKTOP_BRIDGE_PIPE;
  delete env.CODEX_DESKTOP_BRIDGE_CODEX_PATH;
  delete env.CODEX_DESKTOP_BRIDGE_CODEX_ARGS_JSON;
  return env;
}

function bomStrippedStdin() {
  let firstChunk = true;
  const transform = new Transform({
    transform(chunk, encoding, callback) {
      let next = chunk;
      if (firstChunk) {
        firstChunk = false;
        if (next.length >= 3 && next[0] === 0xef && next[1] === 0xbb && next[2] === 0xbf) {
          next = next.subarray(3);
        }
      }
      callback(null, next);
    }
  });
  process.stdin.pipe(transform);
  return transform;
}

function sameSecret(value, expected) {
  const left = Buffer.from(String(value || ""));
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendSocket(socket, message) {
  if (socket?.writable) socket.write(`${JSON.stringify(message)}\n`);
}

function signalExitCode(signal) {
  return signal ? 1 : 0;
}

function failFatal(error) {
  process.stderr.write(`[codex-webui-bridge] ${error?.stack || error}\n`);
  process.exit(1);
}
