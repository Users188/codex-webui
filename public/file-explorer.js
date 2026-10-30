/**
 * File explorer and @-mention utilities for Codex WebUI.
 * Pure ESM module with no Node built-in dependencies (browser and Node compatible).
 */

export function detectFileMentionTrigger(text, cursorIndex) {
  if (typeof text !== "string" || typeof cursorIndex !== "number") {
    return { active: false, query: "", start: -1, end: -1 };
  }

  const index = Math.max(0, Math.min(cursorIndex, text.length));
  const before = text.slice(0, index);

  // Focus only on the current line up to the cursor
  const lastNewline = before.lastIndexOf("\n");
  const lineStartOffset = lastNewline >= 0 ? lastNewline + 1 : 0;
  const currentLine = before.slice(lineStartOffset);

  const atPos = currentLine.lastIndexOf("@");
  if (atPos < 0) {
    return { active: false, query: "", start: -1, end: -1 };
  }

  // Preceding char must be start of line or whitespace
  if (atPos > 0) {
    const prevChar = currentLine[atPos - 1];
    if (!/\s/.test(prevChar)) {
      return { active: false, query: "", start: -1, end: -1 };
    }
  }

  const query = currentLine.slice(atPos + 1);
  // Query cannot contain spaces
  if (/\s/.test(query)) {
    return { active: false, query: "", start: -1, end: -1 };
  }

  const start = lineStartOffset + atPos;
  const end = index;

  return { active: true, query, start, end };
}

export function insertFileMention(text, trigger, filePath) {
  if (typeof text !== "string" || !trigger || typeof trigger.start !== "number" || typeof trigger.end !== "number") {
    return { text: String(text || ""), cursor: 0 };
  }

  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const insertion = `@${filePath} `;
  const nextText = before + insertion + after;
  const cursor = trigger.start + insertion.length;

  return { text: nextText, cursor };
}

export function normalizeFileTreeEntries(entries, parentPath = "") {
  const list = Array.isArray(entries)
    ? entries
    : (Array.isArray(entries?.entries) ? entries.entries : []);
  const normalizedParent = parentPath ? String(parentPath).replace(/\\/g, "/").replace(/\/+$/, "") : "";

  const items = [];
  for (const entry of list) {
    if (!entry) continue;
    const name = String(entry.name || entry.fileName || (entry.path ? entry.path.split(/[\\/]/).pop() : ""));
    if (!name) continue;

    const lowerName = name.toLowerCase();
    if (lowerName === ".git" || lowerName === "node_modules") continue;

    const isDirectory = Boolean(
      entry.isDirectory === true ||
      entry.type === "directory" ||
      entry.type === "dir" ||
      entry.kind === "directory" ||
      (entry.isFile === false && entry.isDirectory !== false)
    );

    let itemPath = "";
    if (entry.path) {
      itemPath = String(entry.path).replace(/\\/g, "/");
    } else {
      itemPath = normalizedParent ? `${normalizedParent}/${name}` : name;
    }

    const size = Number(entry.size) || 0;
    items.push({
      name,
      path: itemPath,
      isDirectory,
      size
    });
  }

  // Sort: directory first, then alphabetically by name
  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return items;
}

const previewKindMap = new Map([
  ["md", { kind: "markdown", language: "markdown" }],
  ["markdown", { kind: "markdown", language: "markdown" }],
  ["mdown", { kind: "markdown", language: "markdown" }],

  ["png", { kind: "image", language: "image" }],
  ["jpg", { kind: "image", language: "image" }],
  ["jpeg", { kind: "image", language: "image" }],
  ["gif", { kind: "image", language: "image" }],
  ["webp", { kind: "image", language: "image" }],
  ["svg", { kind: "image", language: "svg" }],
  ["bmp", { kind: "image", language: "image" }],
  ["ico", { kind: "image", language: "image" }],

  ["js", { kind: "code", language: "javascript" }],
  ["mjs", { kind: "code", language: "javascript" }],
  ["cjs", { kind: "code", language: "javascript" }],
  ["jsx", { kind: "code", language: "javascript" }],
  ["ts", { kind: "code", language: "typescript" }],
  ["mts", { kind: "code", language: "typescript" }],
  ["cts", { kind: "code", language: "typescript" }],
  ["tsx", { kind: "code", language: "typescript" }],
  ["json", { kind: "code", language: "json" }],
  ["html", { kind: "code", language: "html" }],
  ["htm", { kind: "code", language: "html" }],
  ["css", { kind: "code", language: "css" }],
  ["scss", { kind: "code", language: "scss" }],
  ["less", { kind: "code", language: "less" }],
  ["py", { kind: "code", language: "python" }],
  ["rs", { kind: "code", language: "rust" }],
  ["go", { kind: "code", language: "go" }],
  ["java", { kind: "code", language: "java" }],
  ["c", { kind: "code", language: "c" }],
  ["h", { kind: "code", language: "c" }],
  ["cpp", { kind: "code", language: "cpp" }],
  ["hpp", { kind: "code", language: "cpp" }],
  ["cc", { kind: "code", language: "cpp" }],
  ["sh", { kind: "code", language: "shell" }],
  ["bash", { kind: "code", language: "shell" }],
  ["zsh", { kind: "code", language: "shell" }],
  ["ps1", { kind: "code", language: "powershell" }],
  ["yaml", { kind: "code", language: "yaml" }],
  ["yml", { kind: "code", language: "yaml" }],
  ["xml", { kind: "code", language: "xml" }],
  ["sql", { kind: "code", language: "sql" }],
  ["toml", { kind: "code", language: "toml" }],
  ["ini", { kind: "code", language: "ini" }],
  ["conf", { kind: "code", language: "plaintext" }],
  ["txt", { kind: "code", language: "plaintext" }],
  ["log", { kind: "code", language: "plaintext" }],

  ["zip", { kind: "binary", language: "binary" }],
  ["tar", { kind: "binary", language: "binary" }],
  ["gz", { kind: "binary", language: "binary" }],
  ["tgz", { kind: "binary", language: "binary" }],
  ["7z", { kind: "binary", language: "binary" }],
  ["rar", { kind: "binary", language: "binary" }],
  ["pdf", { kind: "binary", language: "binary" }],
  ["exe", { kind: "binary", language: "binary" }],
  ["dll", { kind: "binary", language: "binary" }],
  ["so", { kind: "binary", language: "binary" }],
  ["dylib", { kind: "binary", language: "binary" }],
  ["bin", { kind: "binary", language: "binary" }],
  ["wasm", { kind: "binary", language: "binary" }],
  ["mp3", { kind: "binary", language: "binary" }],
  ["mp4", { kind: "binary", language: "binary" }],
  ["wav", { kind: "binary", language: "binary" }],
  ["ogg", { kind: "binary", language: "binary" }],
  ["woff", { kind: "binary", language: "binary" }],
  ["woff2", { kind: "binary", language: "binary" }],
  ["ttf", { kind: "binary", language: "binary" }],
  ["eot", { kind: "binary", language: "binary" }],
  ["iso", { kind: "binary", language: "binary" }]
]);

export function classifyFilePreviewKind(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return { kind: "code", language: "plaintext" };
  }
  const clean = filePath.split("?")[0].split("#")[0];
  const parts = clean.split(".");
  if (parts.length <= 1) {
    return { kind: "code", language: "plaintext" };
  }
  const ext = parts.pop().toLowerCase();
  const found = previewKindMap.get(ext);
  if (found) return { ...found };
  return { kind: "code", language: "plaintext" };
}
