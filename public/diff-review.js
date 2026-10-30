/**
 * Unified diff parsing and review utilities for Codex WebUI.
 * Pure ESM module with no Node built-in dependencies (browser and Node compatible).
 */

export function parseUnifiedDiff(diffText) {
  if (!diffText || typeof diffText !== "string") return [];
  const lines = diffText.split(/\r?\n/);
  const files = [];

  let currentFile = null;
  let currentHunk = null;
  let curOldLine = 0;
  let curNewLine = 0;
  let rawPatchLines = [];

  function finalizeHunk() {
    if (currentHunk && currentFile) {
      currentFile.hunks.push(currentHunk);
      currentHunk = null;
    }
  }

  function finalizeFile() {
    finalizeHunk();
    if (currentFile) {
      currentFile.rawPatch = rawPatchLines.join("\n");
      currentFile.chunks = currentFile.hunks;
      files.push(currentFile);
      currentFile = null;
      rawPatchLines = [];
    }
  }

  function cleanPrefix(p) {
    if (!p) return "";
    let s = p.trim();
    if (s.startsWith("a/") || s.startsWith("b/")) s = s.slice(2);
    return s;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("diff --git ")) {
      finalizeFile();
      rawPatchLines = [line];
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const oldPath = match ? match[1] : "";
      const newPath = match ? match[2] : "";
      currentFile = {
        oldPath,
        newPath,
        path: newPath || oldPath,
        status: "modified",
        additions: 0,
        deletions: 0,
        rawPatch: "",
        hunks: [],
        chunks: []
      };
      continue;
    }

    if (currentFile) rawPatchLines.push(line);

    if (line.startsWith("new file mode ")) {
      if (currentFile) currentFile.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode ")) {
      if (currentFile) currentFile.status = "deleted";
      continue;
    }
    if (line.startsWith("similarity index ") || line.startsWith("rename from ") || line.startsWith("rename to ")) {
      if (currentFile) currentFile.status = "renamed";
      continue;
    }

    if (line.startsWith("--- ")) {
      const raw = line.slice(4).trim();
      const clean = cleanPrefix(raw);
      if (!currentFile) {
        currentFile = {
          oldPath: raw === "/dev/null" ? "" : clean,
          newPath: "",
          path: raw === "/dev/null" ? "" : clean,
          status: raw === "/dev/null" ? "added" : "modified",
          additions: 0,
          deletions: 0,
          rawPatch: "",
          hunks: [],
          chunks: []
        };
        rawPatchLines = [line];
      } else {
        if (raw === "/dev/null") {
          currentFile.status = "added";
          currentFile.oldPath = "";
        } else {
          currentFile.oldPath = clean;
        }
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim();
      const clean = cleanPrefix(raw);
      if (currentFile) {
        if (raw === "/dev/null") {
          currentFile.status = "deleted";
          currentFile.newPath = "";
          currentFile.path = currentFile.oldPath;
        } else {
          currentFile.newPath = clean;
          currentFile.path = clean;
          if (currentFile.oldPath === "") currentFile.status = "added";
        }
      }
      continue;
    }

    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/);
    if (hunkMatch) {
      finalizeHunk();
      if (!currentFile) {
        currentFile = {
          oldPath: "unknown",
          newPath: "unknown",
          path: "unknown",
          status: "modified",
          additions: 0,
          deletions: 0,
          rawPatch: "",
          hunks: [],
          chunks: []
        };
        rawPatchLines = [line];
      }
      const oldStart = parseInt(hunkMatch[1], 10);
      const oldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
      currentHunk = {
        header: line,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: []
      };
      curOldLine = oldStart;
      curNewLine = newStart;
      continue;
    }

    if (currentHunk) {
      if (line.startsWith("+")) {
        const newLine = curNewLine++;
        currentHunk.lines.push({
          type: "add",
          content: line.slice(1),
          oldLine: null,
          newLine,
          oldLineNo: null,
          newLineNo: newLine
        });
        currentFile.additions++;
      } else if (line.startsWith("-")) {
        const oldLine = curOldLine++;
        currentHunk.lines.push({
          type: "del",
          content: line.slice(1),
          oldLine,
          newLine: null,
          oldLineNo: oldLine,
          newLineNo: null
        });
        currentFile.deletions++;
      } else if (line.startsWith(" ")) {
        const oldLine = curOldLine++;
        const newLine = curNewLine++;
        currentHunk.lines.push({
          type: "context",
          content: line.slice(1),
          oldLine,
          newLine,
          oldLineNo: oldLine,
          newLineNo: newLine
        });
      }
    }
  }

  finalizeFile();
  return files;
}

export function buildSplitDiffRows(hunkOrFile) {
  if (!hunkOrFile) return [];

  // Dual compatibility: if passed a file with hunks or chunks, process all of them
  const hunksList = hunkOrFile.hunks || hunkOrFile.chunks;
  if (Array.isArray(hunksList)) {
    const allRows = [];
    for (const h of hunksList) {
      allRows.push(...buildSplitDiffRows(h));
    }
    return allRows;
  }

  if (!Array.isArray(hunkOrFile.lines)) return [];
  const rows = [];
  const lines = hunkOrFile.lines;
  let i = 0;

  while (i < lines.length) {
    const item = lines[i];
    if (item.type === "context") {
      rows.push({
        left: { line: item.oldLine, lineNo: item.oldLine, content: item.content, type: "context" },
        right: { line: item.newLine, lineNo: item.newLine, content: item.content, type: "context" }
      });
      i++;
    } else {
      const delGroup = [];
      const addGroup = [];
      while (i < lines.length && (lines[i].type === "del" || lines[i].type === "add")) {
        if (lines[i].type === "del") delGroup.push(lines[i]);
        else addGroup.push(lines[i]);
        i++;
      }
      const count = Math.max(delGroup.length, addGroup.length);
      for (let j = 0; j < count; j++) {
        const left = j < delGroup.length
          ? { line: delGroup[j].oldLine, lineNo: delGroup[j].oldLine, content: delGroup[j].content, type: "del" }
          : { line: null, lineNo: null, content: "", type: "empty" };
        const right = j < addGroup.length
          ? { line: addGroup[j].newLine, lineNo: addGroup[j].newLine, content: addGroup[j].content, type: "add" }
          : { line: null, lineNo: null, content: "", type: "empty" };
        rows.push({ left, right });
      }
    }
  }

  return rows;
}

export function diffFromFileChangeItem(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  if (typeof item.patch === "string" && item.patch.trim()) return item.patch;
  if (typeof item.diff === "string" && item.diff.trim()) return item.diff;
  if (Array.isArray(item.changes)) {
    const parts = [];
    for (const change of item.changes) {
      if (typeof change === "string") {
        parts.push(change);
      } else if (change && typeof change.patch === "string") {
        parts.push(change.patch);
      } else if (change && typeof change.diff === "string") {
        parts.push(change.diff);
      }
    }
    return parts.filter(Boolean).join("\n");
  }
  return "";
}

export function validatePatchPaths(diffText) {
  if (!diffText || typeof diffText !== "string") {
    return { valid: false, reason: "Empty or invalid diff text", paths: [] };
  }
  const lines = diffText.split(/\r?\n/);
  const pathsSet = new Set();

  function recordPath(raw) {
    if (!raw || raw === "/dev/null") return;
    let s = raw.trim();
    if (s.startsWith("a/") || s.startsWith("b/")) s = s.slice(2);
    if (s && s !== "/dev/null") pathsSet.add(s);
  }

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        recordPath(match[1]);
        recordPath(match[2]);
      }
      continue;
    }
    if (line.startsWith("--- ")) {
      recordPath(line.slice(4).trim());
      continue;
    }
    if (line.startsWith("+++ ")) {
      recordPath(line.slice(4).trim());
      continue;
    }
  }

  const paths = Array.from(pathsSet);
  if (paths.length === 0) {
    return { valid: false, reason: "No target paths found in patch", paths: [] };
  }

  for (const p of paths) {
    // Check absolute path (POSIX or Windows drive / UNC)
    if (p.startsWith("/") || p.startsWith("\\") || /^[a-zA-Z]:[/\\]/.test(p)) {
      return { valid: false, reason: `Absolute path not allowed: ${p}`, paths };
    }
    const segments = p.split(/[/\\]/);
    if (segments.includes("..")) {
      return { valid: false, reason: `Path traversal not allowed: ${p}`, paths };
    }
    for (const seg of segments) {
      const lower = seg.toLowerCase();
      if (lower === ".git") {
        return { valid: false, reason: `Modification of .git is forbidden: ${p}`, paths };
      }
      if (lower === "node_modules") {
        return { valid: false, reason: `Modification of node_modules is forbidden: ${p}`, paths };
      }
      if (lower === ".env" || lower.startsWith(".env.")) {
        return { valid: false, reason: `Modification of .env files is forbidden: ${p}`, paths };
      }
    }
  }

  return { valid: true, reason: "", paths };
}
