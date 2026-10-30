import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildSplitDiffRows,
  diffFromFileChangeItem,
  parseUnifiedDiff,
  validatePatchPaths
} from "../public/diff-review.js";
import {
  classifyFilePreviewKind,
  detectFileMentionTrigger,
  insertFileMention,
  normalizeFileTreeEntries
} from "../public/file-explorer.js";

// -------------------------------------------------------------
// Tests for public/diff-review.js (B2, B5, B7)
// -------------------------------------------------------------

test("parseUnifiedDiff parses single modified file with B2 dual compatibility (hunks, chunks, oldLineNo, newLineNo)", () => {
  const sampleDiff = `diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -10,4 +10,5 @@
 const a = 1;
-const b = 2;
+const b = 20;
+const c = 30;
 const d = 4;
`;
  const files = parseUnifiedDiff(sampleDiff);
  assert.equal(files.length, 1);
  const file = files[0];
  assert.equal(file.path, "src/app.js");
  assert.equal(file.oldPath, "src/app.js");
  assert.equal(file.newPath, "src/app.js");
  assert.equal(file.status, "modified");
  assert.equal(file.additions, 2);
  assert.equal(file.deletions, 1);

  // B2: check both hunks and chunks alias
  assert.equal(Array.isArray(file.hunks), true);
  assert.equal(Array.isArray(file.chunks), true);
  assert.equal(file.hunks, file.chunks);
  assert.equal(file.hunks.length, 1);

  const hunk = file.hunks[0];
  assert.equal(hunk.oldStart, 10);
  assert.equal(hunk.oldLines, 4);
  assert.equal(hunk.newStart, 10);
  assert.equal(hunk.newLines, 5);
  assert.equal(hunk.lines.length, 5);

  // B2: line and lineNo aliases
  assert.equal(hunk.lines[0].oldLine, 10);
  assert.equal(hunk.lines[0].oldLineNo, 10);
  assert.equal(hunk.lines[0].newLine, 10);
  assert.equal(hunk.lines[0].newLineNo, 10);

  assert.equal(hunk.lines[1].type, "del");
  assert.equal(hunk.lines[1].oldLine, 11);
  assert.equal(hunk.lines[1].oldLineNo, 11);
  assert.equal(hunk.lines[1].newLine, null);
  assert.equal(hunk.lines[1].newLineNo, null);

  assert.equal(hunk.lines[2].type, "add");
  assert.equal(hunk.lines[2].oldLine, null);
  assert.equal(hunk.lines[2].oldLineNo, null);
  assert.equal(hunk.lines[2].newLine, 11);
  assert.equal(hunk.lines[2].newLineNo, 11);
});

test("parseUnifiedDiff parses added, deleted, and renamed files correctly", () => {
  const addedDiff = `diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`;
  const addedFiles = parseUnifiedDiff(addedDiff);
  assert.equal(addedFiles.length, 1);
  assert.equal(addedFiles[0].status, "added");
  assert.equal(addedFiles[0].path, "new.txt");
  assert.equal(addedFiles[0].additions, 2);

  const deletedDiff = `diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-bye
-world
`;
  const deletedFiles = parseUnifiedDiff(deletedDiff);
  assert.equal(deletedFiles.length, 1);
  assert.equal(deletedFiles[0].status, "deleted");
  assert.equal(deletedFiles[0].path, "old.txt");

  const renameDiff = `diff --git a/old-name.js b/new-name.js
similarity index 98%
rename from old-name.js
rename to new-name.js
--- a/old-name.js
+++ b/new-name.js
@@ -1,1 +1,1 @@
-console.log("old");
+console.log("new");
`;
  const renameFiles = parseUnifiedDiff(renameDiff);
  assert.equal(renameFiles.length, 1);
  assert.equal(renameFiles[0].status, "renamed");
  assert.equal(renameFiles[0].oldPath, "old-name.js");
  assert.equal(renameFiles[0].newPath, "new-name.js");
});

test("buildSplitDiffRows supports both individual hunks and entire file objects (B2)", () => {
  const sampleDiff = `diff --git a/sample.js b/sample.js
--- a/sample.js
+++ b/sample.js
@@ -1,3 +1,3 @@
 line 1
-old line
+new line
 line 3
`;
  const files = parseUnifiedDiff(sampleDiff);
  const file = files[0];

  // Passing file object with hunks/chunks directly
  const fileRows = buildSplitDiffRows(file);
  assert.equal(fileRows.length, 3);
  assert.equal(fileRows[0].left.line, 1);
  assert.equal(fileRows[0].left.lineNo, 1);
  assert.equal(fileRows[1].left.type, "del");
  assert.equal(fileRows[1].left.line, 2);
  assert.equal(fileRows[1].left.lineNo, 2);
  assert.equal(fileRows[1].right.type, "add");
  assert.equal(fileRows[1].right.line, 2);
  assert.equal(fileRows[1].right.lineNo, 2);

  // Passing single hunk directly
  const hunkRows = buildSplitDiffRows(file.hunks[0]);
  assert.equal(hunkRows.length, 3);
  assert.deepEqual(fileRows, hunkRows);
});

test("validatePatchPaths handles B7 binary git diffs and B5 case-insensitive sensitive blocks", () => {
  // B7: Binary diff without ---/+++ headers
  const binaryDiff = `diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..1234567
Binary files /dev/null and b/assets/logo.png differ
`;
  const binRes = validatePatchPaths(binaryDiff);
  assert.equal(binRes.valid, true);
  assert.deepEqual(binRes.paths, ["assets/logo.png"]);

  // B5: Case-insensitive sensitive path detection
  const upperEnv = `diff --git a/.ENV b/.ENV
--- a/.ENV
+++ b/.ENV
@@ -1 +1 @@
-A=1
+A=2
`;
  assert.equal(validatePatchPaths(upperEnv).valid, false);

  const upperGit = `--- a/.GIT/config\n+++ b/.GIT/config\n`;
  assert.equal(validatePatchPaths(upperGit).valid, false);

  const mixedModules = `--- a/Node_Modules/lib/index.js\n+++ b/Node_Modules/lib/index.js\n`;
  assert.equal(validatePatchPaths(mixedModules).valid, false);

  const envLocal = `--- a/.env.production\n+++ b/.env.production\n`;
  assert.equal(validatePatchPaths(envLocal).valid, false);
});

test("diffFromFileChangeItem extracts diff text from various item shapes", () => {
  assert.equal(diffFromFileChangeItem("diff --git a/foo b/foo"), "diff --git a/foo b/foo");
  assert.equal(diffFromFileChangeItem({ patch: "--- a\n+++ b" }), "--- a\n+++ b");
  assert.equal(diffFromFileChangeItem({ diff: "--- a\n+++ b" }), "--- a\n+++ b");
  assert.equal(
    diffFromFileChangeItem({ changes: [{ patch: "patch 1" }, { diff: "diff 2" }] }),
    "patch 1\ndiff 2"
  );
  assert.equal(diffFromFileChangeItem(null), "");
  assert.equal(diffFromFileChangeItem({}), "");
});

// -------------------------------------------------------------
// Tests for public/file-explorer.js (B3)
// -------------------------------------------------------------

test("normalizeFileTreeEntries supports B3 real app-server { fileName, isDirectory, isFile } shape", () => {
  // Real app-server object shape: { entries: [...] } with fileName field
  const appServerResponse = {
    entries: [
      { fileName: "index.js", isFile: true, isDirectory: false, size: 2048 },
      { fileName: "node_modules", isFile: false, isDirectory: true },
      { fileName: ".GIT", isFile: false, isDirectory: true },
      { fileName: "components", isFile: false, isDirectory: true },
      { fileName: "package.json", isFile: true, isDirectory: false, size: 1024 }
    ]
  };

  const normalized = normalizeFileTreeEntries(appServerResponse, "app");
  assert.equal(normalized.length, 3); // node_modules and .GIT filtered

  // Directory first: components
  assert.equal(normalized[0].name, "components");
  assert.equal(normalized[0].isDirectory, true);
  assert.equal(normalized[0].path, "app/components");

  // Files alphabetical: index.js, package.json
  assert.equal(normalized[1].name, "index.js");
  assert.equal(normalized[1].isDirectory, false);
  assert.equal(normalized[1].path, "app/index.js");
  assert.equal(normalized[1].size, 2048);

  assert.equal(normalized[2].name, "package.json");
  assert.equal(normalized[2].isDirectory, false);
  assert.equal(normalized[2].path, "app/package.json");
  assert.equal(normalized[2].size, 1024);
});

test("detectFileMentionTrigger detects active triggers at line start, second line, and after space", () => {
  const t1 = detectFileMentionTrigger("@server/index", 13);
  assert.equal(t1.active, true);
  assert.equal(t1.query, "server/index");
  assert.equal(t1.start, 0);
  assert.equal(t1.end, 13);

  const t2 = detectFileMentionTrigger("Please inspect @utils/math", 26);
  assert.equal(t2.active, true);
  assert.equal(t2.query, "utils/math");

  // Email format rejected
  assert.equal(detectFileMentionTrigger("email user@example.com", 16).active, false);

  // Space in query rejected
  assert.equal(detectFileMentionTrigger("@foo bar", 8).active, false);

  // Empty @ at line start
  assert.equal(detectFileMentionTrigger("@", 1).active, true);
});

test("insertFileMention replaces trigger range with quoted file path and updates cursor", () => {
  const text = "Look at @uti for details";
  const trigger = { start: 8, end: 12 };
  const res = insertFileMention(text, trigger, "src/utils.js");
  assert.equal(res.text, "Look at @src/utils.js  for details");
  assert.equal(res.cursor, 8 + "@src/utils.js ".length);
});

test("classifyFilePreviewKind identifies markdown, code languages, images, and binaries", () => {
  assert.deepEqual(classifyFilePreviewKind("DOCS.md"), { kind: "markdown", language: "markdown" });
  assert.deepEqual(classifyFilePreviewKind("src/index.ts"), { kind: "code", language: "typescript" });
  assert.deepEqual(classifyFilePreviewKind("main.py"), { kind: "code", language: "python" });
  assert.deepEqual(classifyFilePreviewKind("lib.rs"), { kind: "code", language: "rust" });
  assert.deepEqual(classifyFilePreviewKind("config.json"), { kind: "code", language: "json" });
  assert.deepEqual(classifyFilePreviewKind("public/icon.png"), { kind: "image", language: "image" });
  assert.deepEqual(classifyFilePreviewKind("asset.svg"), { kind: "image", language: "svg" });
  assert.deepEqual(classifyFilePreviewKind("bundle.tar.gz"), { kind: "binary", language: "binary" });
  assert.deepEqual(classifyFilePreviewKind("binary.wasm"), { kind: "binary", language: "binary" });
});

test("public/app.js integration contract for diff-review.js and file-explorer.js", async () => {
  const content = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(content, /from\s+["']\.\/diff-review\.js["']/);
  assert.match(content, /from\s+["']\.\/file-explorer\.js["']/);
  for (const symbol of [
    "parseUnifiedDiff",
    "buildSplitDiffRows",
    "diffFromFileChangeItem",
    "detectFileMentionTrigger",
    "insertFileMention",
    "normalizeFileTreeEntries",
    "classifyFilePreviewKind"
  ]) {
    assert.ok(content.includes(symbol), `Expected public/app.js to import and use ${symbol}`);
  }
  assert.ok(
    content.includes('authenticatedUrl("/api/git/apply", state.token)'),
    "Expected /api/git/apply fetch calls to pass state.token to authenticatedUrl"
  );
});
