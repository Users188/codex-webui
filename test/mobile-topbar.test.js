import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("mobile topbar groups secondary actions behind an accessible more menu", () => {
  const menuStart = html.indexOf('id="topbarSecondaryActions"');
  assert.ok(menuStart > 0);

  for (const id of [
    "compactThreadBtn",
    "archiveThreadBtn",
    "deleteThreadBtn",
    "startReviewBtn",
    "toggleSidePanel",
    "toggleTerminalBtn",
    "openEcosystemBtn",
    "fullscreenToggle"
  ]) {
    assert.ok(html.indexOf(`id="${id}"`) > menuStart, `${id} should be grouped in the mobile menu`);
  }

  assert.match(html, /id="topbarMoreBtn"[^>]*aria-controls="topbarSecondaryActions"[^>]*aria-expanded="false"/);
  assert.match(css, /#topbarActions \.topbar-secondary-actions\.open\s*\{\s*display:\s*grid !important;/);
  assert.match(css, /@media \(max-width: 900px\), \(max-width: 1100px\) and \(pointer: coarse\)[\s\S]*?\.topbar-action-label\s*\{[\s\S]*?display:\s*block !important;/);
  assert.match(app, /function setupTopbarMoreMenu\(\)/);
  assert.match(app, /topbarMoreBtn\.setAttribute\("aria-expanded", String\(isOpen\)\)/);
});

test("mobile drawer stacks above the composer while keeping the topbar visible", () => {
  const mobileCss = css.slice(css.indexOf("/* Mobile topbar layout"));
  assert.match(mobileCss, /\.sidebar\s*\{\s*z-index:\s*18 !important;/);
  assert.match(mobileCss, /\.sidebar\s*\{[\s\S]*?inset:\s*calc\(var\(--visual-viewport-offset-top\) \+ var\(--mobile-topbar-height, 68px\)\) auto auto 0 !important;/);
  assert.match(mobileCss, /#composer\s*\{\s*z-index:\s*5 !important;/);
  assert.match(mobileCss, /\.sidebar\.open\s*~\s*\.chat-pane #composer\s*\{[\s\S]*?visibility:\s*hidden;/);
  assert.match(mobileCss, /\.topbar\s*\{[\s\S]*?z-index:\s*19 !important;/);
  assert.match(app, /document\.documentElement\.style\.setProperty\("--mobile-topbar-height"/);
});
