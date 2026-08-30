import net from "node:net";
import readline from "node:readline";
import { desktopBridgePipePath, ensureDesktopBridgeSecret } from "./desktop-bridge-common.js";

export class DesktopBridgeConnection {
  constructor({
    onAppServerMessage,
    onError,
    onServerRequestResolved,
    onStatus,
    resolvePipePath = desktopBridgePipePath,
    resolveSecret = ensureDesktopBridgeSecret
  } = {}) {
    this.onAppServerMessage = onAppServerMessage || (() => {});
    this.onError = onError || (() => {});
    this.onServerRequestResolved = onServerRequestResolved || (() => {});
    this.onStatus = onStatus || (() => {});
    this.resolvePipePath = resolvePipePath;
    this.resolveSecret = resolveSecret;
    this.socket = null;
    this.connecting = null;
    this.authenticated = false;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    if (this.socket?.writable && this.authenticated) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectOnce().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async connectOnce() {
    const secret = await this.resolveSecret();
    const socket = net.createConnection(this.resolvePipePath());
    socket.setNoDelay(true);
    this.socket = socket;

    const hello = new Promise((resolve, reject) => {
      const fail = (error) => reject(error instanceof Error ? error : new Error(String(error)));
      const closed = () => fail(new Error("Desktop bridge closed before authentication"));
      socket.once("error", fail);
      socket.once("close", closed);
      socket.once("connect", () => socket.write(`${JSON.stringify({ type: "hello", token: secret })}\n`));
      const rl = readline.createInterface({ input: socket });
      rl.on("error", (error) => {
        if (this.authenticated) this.onError(error);
        else fail(error);
      });
      rl.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.type === "hello") {
          socket.off("error", fail);
          socket.off("close", closed);
          if (message.ok) {
            this.setAuthenticated(true);
            resolve(message);
          }
          else reject(new Error(message.error || "Desktop bridge authentication failed"));
          return;
        }
        this.handleMessage(message);
      });
    });

    socket.on("error", (error) => this.onError(error));
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      this.setAuthenticated(false);
      const error = new Error("Desktop bridge disconnected");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.onError(error);
    });
    await hello;
  }

  handleMessage(message) {
    if (message.type === "response" && this.pending.has(message.requestId)) {
      const pending = this.pending.get(message.requestId);
      this.pending.delete(message.requestId);
      if (message.error) pending.reject(new Error(message.error.message || message.error));
      else pending.resolve(message.result);
      return;
    }
    if (message.type === "appserver") this.onAppServerMessage(message.message);
    if (message.type === "server-request-resolved") this.onServerRequestResolved(message.id);
    if (message.type === "bridge-error") this.onError(new Error(message.error || "Desktop bridge error"));
  }

  async request(method, params = {}) {
    await this.connect();
    const requestId = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(requestId)) return;
        this.pending.delete(requestId);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 120000).unref();
    });
    this.sendLine({ type: "request", requestId, method, params });
    return promise;
  }

  async respond(id, result) {
    await this.connect();
    const requestId = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(requestId)) return;
        this.pending.delete(requestId);
        reject(new Error(`Timed out responding to server request ${id}`));
      }, 120000).unref();
    });
    this.sendLine({ type: "server-response", requestId, id, result });
    return promise;
  }

  sendLine(message) {
    if (!this.socket?.writable || !this.authenticated) throw new Error("Desktop bridge is unavailable");
    this.socket.write(`${JSON.stringify(message)}\n`);
  }

  isConnected() {
    return Boolean(this.socket?.writable && this.authenticated);
  }

  setAuthenticated(value) {
    const next = Boolean(value);
    if (this.authenticated === next) return;
    this.authenticated = next;
    this.onStatus(next);
  }
}
