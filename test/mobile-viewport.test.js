import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const viewportSetup = app.slice(app.indexOf("function setupMobileViewport()"), app.indexOf("function setupTopbarMoreMenu()"));

function viewportHarness() {
  const listeners = new Map();
  const visualListeners = new Map();
  const styles = new Map();
  const classes = new Set();
  const promptInput = { addEventListener() {} };
  const messages = { scrollHeight: 2000, clientHeight: 715, scrollTop: 1165 };
  let pendingFrame;
  const viewport = {
    height: 915,
    offsetTop: 0,
    addEventListener(name, callback) { visualListeners.set(name, callback); }
  };
  const window = {
    innerHeight: 915,
    visualViewport: viewport,
    addEventListener(name, callback) {
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    }
  };
  const document = {
    activeElement: null,
    documentElement: {
      style: {
        setProperty(name, value) {
          styles.set(name, value);
          if (name === "--visual-viewport-height") messages.clientHeight = Number.parseFloat(value) - 200;
        }
      },
      classList: {
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
      }
    }
  };
  vm.runInNewContext(`${viewportSetup}\nsetupMobileViewport();`, {
    window,
    document,
    els: { promptInput, messages },
    updateMobileChromeMetrics() {},
    requestAnimationFrame(callback) { pendingFrame = callback; return 1; },
    cancelAnimationFrame() {},
    console: { debug() {} }
  });
  return {
    window, viewport, document, promptInput, styles, classes, messages,
    resize() { visualListeners.get("resize")(); pendingFrame(); },
    rotate() { for (const callback of listeners.get("orientationchange")) callback(); pendingFrame(); }
  };
}

test("overlay keyboard keeps the composer in the visual viewport and preserves reading position", () => {
  const h = viewportHarness();
  h.document.activeElement = h.promptInput;
  h.viewport.height = 520;
  h.resize();
  assert.equal(h.styles.get("--visual-viewport-height"), "520px");
  assert.equal(h.styles.get("--keyboard-inset"), "395px");
  assert.ok(h.classes.has("keyboard-open"));
  assert.equal(h.messages.scrollHeight - h.messages.scrollTop - h.messages.clientHeight, 120);
});

test("panned visual viewport uses its height separately from its top offset", () => {
  const h = viewportHarness();
  h.document.activeElement = h.promptInput;
  h.viewport.height = 450;
  h.viewport.offsetTop = 70;
  h.resize();
  assert.equal(h.styles.get("--visual-viewport-height"), "450px");
  assert.equal(h.styles.get("--visual-viewport-offset-top"), "70px");
  assert.equal(h.styles.get("--keyboard-inset"), "395px");
});

test("Android resizes-content keyboard does not apply a second bottom offset", () => {
  const h = viewportHarness();
  h.document.activeElement = h.promptInput;
  h.window.innerHeight = h.viewport.height = 520;
  h.resize();
  assert.equal(h.styles.get("--visual-viewport-height"), "520px");
  assert.equal(h.styles.get("--keyboard-inset"), "0px");
  assert.ok(h.classes.has("keyboard-open"));
});

test("phone rotation while editing does not infer a keyboard from the portrait height", () => {
  const h = viewportHarness();
  h.document.activeElement = h.promptInput;
  h.window.innerHeight = h.viewport.height = 412;
  h.rotate();
  assert.equal(h.styles.get("--visual-viewport-height"), "412px");
  assert.equal(h.classes.has("keyboard-open"), false);
});
