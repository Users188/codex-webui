/**
 * Terminal pane utilities for Codex WebUI.
 * Pure ESM module with no Node built-in dependencies (browser and Node compatible).
 */

export function encodeTerminalInputBase64(text) {
  if (typeof text !== "string") return "";
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decodeTerminalOutputBase64(deltaBase64) {
  if (!deltaBase64 || typeof deltaBase64 !== "string") return "";
  if (typeof Buffer !== "undefined") {
    return Buffer.from(deltaBase64, "base64").toString("utf8");
  }
  const binary = atob(deltaBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function stripAnsiCodes(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "");
}

export function buildTerminalStartParams({
  processId,
  cwd = "",
  cols = 100,
  rows = 28,
  shell = "powershell",
  command = null
} = {}) {
  let argv;
  if (Array.isArray(command) && command.length) {
    argv = command;
  } else if (shell === "cmd") {
    argv = ["cmd.exe"];
  } else if (shell === "bash") {
    argv = ["bash", "-i"];
  } else {
    argv = ["powershell.exe", "-NoLogo"];
  }

  return {
    command: argv,
    processId: String(processId),
    tty: true,
    streamStdin: true,
    streamStdoutStderr: true,
    disableTimeout: true,
    ...(cwd ? { cwd } : {}),
    size: {
      rows: Number(rows) || 28,
      cols: Number(cols) || 100
    }
  };
}

export function buildTerminalWriteParams(processId, text, closeStdin = false) {
  return {
    processId: String(processId),
    deltaBase64: encodeTerminalInputBase64(text),
    ...(closeStdin ? { closeStdin: true } : {})
  };
}

export function buildTerminalResizeParams(processId, cols, rows) {
  return {
    processId: String(processId),
    size: {
      rows: Number(rows) || 28,
      cols: Number(cols) || 100
    }
  };
}

export function buildTerminalTerminateParams(processId) {
  return {
    processId: String(processId)
  };
}
