import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTerminalResizeParams,
  buildTerminalStartParams,
  buildTerminalTerminateParams,
  buildTerminalWriteParams,
  decodeTerminalOutputBase64,
  encodeTerminalInputBase64,
  stripAnsiCodes
} from "../public/terminal-pane.js";
import {
  buildSkillToggleParams,
  extractSubagentsAndLoadedThreads,
  normalizeMcpServerList,
  normalizePluginCatalog,
  normalizeSkillsCatalog,
  normalizeThreadGoal
} from "../public/ecosystem-panel.js";

// -------------------------------------------------------------
// Tests for public/terminal-pane.js
// -------------------------------------------------------------

test("encodeTerminalInputBase64 and decodeTerminalOutputBase64 support UTF-8 round-tripping", () => {
  const plain = "echo 'Hello World'\r\n";
  const encoded = encodeTerminalInputBase64(plain);
  assert.equal(typeof encoded, "string");
  assert.equal(decodeTerminalOutputBase64(encoded), plain);

  const utf8Text = "ls -la; echo '你好，世界！🚀'\n";
  const utf8Encoded = encodeTerminalInputBase64(utf8Text);
  assert.equal(decodeTerminalOutputBase64(utf8Encoded), utf8Text);

  assert.equal(encodeTerminalInputBase64(""), "");
  assert.equal(encodeTerminalInputBase64(null), "");
  assert.equal(decodeTerminalOutputBase64(""), "");
  assert.equal(decodeTerminalOutputBase64(null), "");
});

test("stripAnsiCodes strips CSI, OSC, and styling escapes while preserving text and newlines", () => {
  const colored = "\x1b[31;1mError:\x1b[0m \x1b[33mWarning message\x1b[0m\r\n";
  assert.equal(stripAnsiCodes(colored), "Error: Warning message\r\n");

  const oscTitle = "\x1b]0;Administrator: PowerShell\x07PS C:\\Users> dir";
  assert.equal(stripAnsiCodes(oscTitle), "PS C:\\Users> dir");

  const cursorCodes = "\x1b[2K\x1b[1GProgress: 50%\x1b[0m";
  assert.equal(stripAnsiCodes(cursorCodes), "Progress: 50%");

  assert.equal(stripAnsiCodes(""), "");
  assert.equal(stripAnsiCodes(null), "");
});

test("buildTerminalStartParams constructs valid v2/CommandExecParams across shells and commands", () => {
  // Default powershell
  const psParams = buildTerminalStartParams({ processId: "proc-1", cwd: "D:\\test" });
  assert.deepEqual(psParams.command, ["powershell.exe", "-NoLogo"]);
  assert.equal(psParams.processId, "proc-1");
  assert.equal(psParams.cwd, "D:\\test");
  assert.equal(psParams.tty, true);
  assert.equal(psParams.streamStdin, true);
  assert.equal(psParams.streamStdoutStderr, true);
  assert.equal(psParams.disableTimeout, true);
  assert.deepEqual(psParams.size, { rows: 28, cols: 100 });

  // CMD shell
  const cmdParams = buildTerminalStartParams({ processId: 2, shell: "cmd", cols: 120, rows: 40 });
  assert.deepEqual(cmdParams.command, ["cmd.exe"]);
  assert.equal(cmdParams.processId, "2");
  assert.deepEqual(cmdParams.size, { rows: 40, cols: 120 });

  // Bash shell
  const bashParams = buildTerminalStartParams({ processId: "bash-1", shell: "bash" });
  assert.deepEqual(bashParams.command, ["bash", "-i"]);

  // Explicit custom command
  const customParams = buildTerminalStartParams({
    processId: "custom-1",
    command: ["node", "server.js", "--watch"]
  });
  assert.deepEqual(customParams.command, ["node", "server.js", "--watch"]);
});

test("buildTerminalWriteParams, ResizeParams, and TerminateParams format payloads properly", () => {
  const write1 = buildTerminalWriteParams("proc-1", "dir\r");
  assert.equal(write1.processId, "proc-1");
  assert.equal(decodeTerminalOutputBase64(write1.deltaBase64), "dir\r");
  assert.equal("closeStdin" in write1, false);

  const write2 = buildTerminalWriteParams("proc-1", "exit\r", true);
  assert.equal(write2.closeStdin, true);

  const resize = buildTerminalResizeParams("proc-1", 160, 50);
  assert.equal(resize.processId, "proc-1");
  assert.deepEqual(resize.size, { cols: 160, rows: 50 });

  const term = buildTerminalTerminateParams("proc-1");
  assert.equal(term.processId, "proc-1");
});

// -------------------------------------------------------------
// Tests for public/ecosystem-panel.js
// -------------------------------------------------------------

test("normalizeSkillsCatalog normalizes, deduplicates, and sorts skills from v2/SkillsListResponse", () => {
  const rawResponse = {
    data: [
      {
        cwd: "/home/user/project",
        skills: [
          {
            name: "git-commit",
            description: "Automates git commit messages",
            path: "/home/user/.codex/skills/git-commit",
            scope: "user",
            enabled: true
          },
          {
            name: "agent-readiness",
            shortDescription: "Evaluates readiness for coding agents",
            path: "/home/user/project/.skills/agent-readiness",
            scope: "workspace",
            enabled: false,
            pluginId: "plugin-audit"
          }
        ]
      },
      {
        cwd: "/home/user/project/sub",
        skills: [
          // Duplicate path
          {
            name: "git-commit",
            description: "Duplicate",
            path: "/home/user/.codex/skills/git-commit"
          }
        ]
      }
    ]
  };

  const catalog = normalizeSkillsCatalog(rawResponse);
  assert.equal(catalog.length, 2);

  // Sorted alphabetically by name: agent-readiness, git-commit
  assert.equal(catalog[0].name, "agent-readiness");
  assert.equal(catalog[0].description, "Evaluates readiness for coding agents");
  assert.equal(catalog[0].enabled, false);
  assert.equal(catalog[0].pluginId, "plugin-audit");

  assert.equal(catalog[1].name, "git-commit");
  assert.equal(catalog[1].description, "Automates git commit messages");
  assert.equal(catalog[1].enabled, true);
  assert.equal(catalog[1].pluginId, null);

  assert.deepEqual(normalizeSkillsCatalog(null), []);
});

test("buildSkillToggleParams constructs valid v2/SkillsConfigWriteParams", () => {
  const p1 = buildSkillToggleParams({ path: "/skills/test", name: "test-skill" }, true);
  assert.deepEqual(p1, { path: "/skills/test", name: "test-skill", enabled: true });

  const p2 = buildSkillToggleParams({ name: "name-only" }, false);
  assert.deepEqual(p2, { name: "name-only", enabled: false });
});

test("normalizeMcpServerList handles tools as dictionary object and array shapes", () => {
  const rawResponse = {
    data: [
      {
        name: "weather-mcp",
        runtimeStatus: "connected",
        authStatus: "authorized",
        tools: {
          get_current_weather: { description: "Fetches weather" },
          get_forecast: { description: "Fetches forecast" }
        },
        resources: [{ uri: "weather://locations" }],
        resourceTemplates: []
      },
      {
        name: "db-mcp",
        status: "error",
        toolsError: "Connection refused",
        tools: [
          { name: "query_database" }
        ],
        resources: []
      }
    ]
  };

  const servers = normalizeMcpServerList(rawResponse);
  assert.equal(servers.length, 2);

  // db-mcp
  assert.equal(servers[0].name, "db-mcp");
  assert.equal(servers[0].status, "error");
  assert.equal(servers[0].error, "Connection refused");
  assert.equal(servers[0].toolCount, 1);
  assert.deepEqual(servers[0].toolNames, ["query_database"]);

  // weather-mcp
  assert.equal(servers[1].name, "weather-mcp");
  assert.equal(servers[1].status, "connected");
  assert.equal(servers[1].authStatus, "authorized");
  assert.equal(servers[1].toolCount, 2);
  assert.deepEqual(servers[1].toolNames, ["get_current_weather", "get_forecast"]);
  assert.equal(servers[1].resourceCount, 1);

  assert.deepEqual(normalizeMcpServerList(null), []);
});

test("normalizePluginCatalog parses marketplaces and flattens installed and available plugins", () => {
  const response = {
    marketplaces: [
      {
        name: "official",
        plugins: [
          { id: "p1", name: "Linter", version: "1.0.0", installed: true, enabled: true },
          { id: "p2", name: "Formatter", version: "2.1.0", installed: false, enabled: false }
        ]
      }
    ]
  };

  const plugins = normalizePluginCatalog(response);
  assert.equal(plugins.length, 2);
  assert.equal(plugins[0].name, "Formatter");
  assert.equal(plugins[0].marketplace, "official");
  assert.equal(plugins[0].installed, false);

  assert.equal(plugins[1].name, "Linter");
  assert.equal(plugins[1].marketplace, "official");
  assert.equal(plugins[1].installed, true);
  assert.equal(plugins[1].enabled, true);

  assert.deepEqual(normalizePluginCatalog(null), []);
});

test("extractSubagentsAndLoadedThreads combines loaded threads with active and idle sessions", () => {
  const loadedResult = { data: ["thread-1", "thread-3"] };
  const threads = [
    { id: "thread-1", name: "Main Task", cwd: "E:\\repo", status: "active" },
    { id: "thread-2", name: "Old Task", cwd: "E:\\repo", status: "idle" }
  ];

  const extracted = extractSubagentsAndLoadedThreads({
    loadedResult,
    threads,
    currentThreadId: "thread-1"
  });

  assert.equal(extracted.length, 3);

  // thread-1: in threads, loaded, and isCurrent
  const t1 = extracted.find((t) => t.threadId === "thread-1");
  assert.equal(t1.isLoaded, true);
  assert.equal(t1.isCurrent, true);
  assert.equal(t1.name, "Main Task");

  // thread-2: in threads, not loaded, not current
  const t2 = extracted.find((t) => t.threadId === "thread-2");
  assert.equal(t2.isLoaded, false);
  assert.equal(t2.isCurrent, false);

  // thread-3: in loaded list, synthesized
  const t3 = extracted.find((t) => t.threadId === "thread-3");
  assert.equal(t3.isLoaded, true);
  assert.equal(t3.isCurrent, false);
});

test("normalizeThreadGoal handles active, completed, and missing goal payloads", () => {
  const activePayload = {
    goal: {
      objective: "Ship Wave 3 parity",
      status: "in_progress",
      tokenBudget: 50000,
      tokensUsed: 25000,
      elapsedMs: 12000
    }
  };
  const g1 = normalizeThreadGoal(activePayload);
  assert.equal(g1.active, true);
  assert.equal(g1.objective, "Ship Wave 3 parity");
  assert.equal(g1.tokenBudget, 50000);
  assert.equal(g1.tokensUsed, 25000);
  assert.equal(g1.progressPercent, 50);

  const completedPayload = {
    goal: {
      objective: "Task Done",
      status: "completed",
      tokenBudget: 10000,
      tokensUsed: 8000
    }
  };
  const g2 = normalizeThreadGoal(completedPayload);
  assert.equal(g2.active, false);
  assert.equal(g2.status, "completed");
  assert.equal(g2.progressPercent, 80);

  const emptyGoal = normalizeThreadGoal(null);
  assert.equal(emptyGoal.active, false);
  assert.equal(emptyGoal.objective, "");
  assert.equal(emptyGoal.progressPercent, null);
});

test("public/app.js integration contract for terminal-pane.js and ecosystem-panel.js", async () => {
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(content, /from\s+["']\.\/terminal-pane\.js["']/);
  assert.match(content, /from\s+["']\.\/ecosystem-panel\.js["']/);
  for (const symbol of [
    "encodeTerminalInputBase64",
    "decodeTerminalOutputBase64",
    "stripAnsiCodes",
    "buildTerminalStartParams",
    "buildTerminalWriteParams",
    "buildTerminalResizeParams",
    "buildTerminalTerminateParams",
    "normalizeSkillsCatalog",
    "buildSkillToggleParams",
    "normalizeMcpServerList",
    "normalizePluginCatalog",
    "extractSubagentsAndLoadedThreads",
    "normalizeThreadGoal"
  ]) {
    assert.ok(content.includes(symbol), `Expected public/app.js to import and use ${symbol}`);
  }
});
