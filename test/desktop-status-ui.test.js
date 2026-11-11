import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/index.js", import.meta.url), "utf8");

test("Desktop takeover status reflects the real bridge and thread lock state", () => {
  assert.match(server, /desktopBridgeConnected: this\.connection\.isConnected\(\)/);
  assert.match(server, /desktopBridgeConnected: bridge\.connection\.isConnected\(\)/);
  assert.doesNotMatch(server, /desktopBridgeConnected: true/);
  assert.match(app, /typeof info\?\.desktopBridgeConnected === "boolean"/);
  assert.match(app, /const locked = hasThread && state\.threadLockConflict && status !== "draft" && !resuming;/);
  assert.match(app, /thread\.bridgeLockedShort/);
});
