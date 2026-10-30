import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DesktopStateManager, parseDesktopState, extractRemoteThreads } from "../server/desktop-state.js";

import {
  findProjectForThread,
  mergeRemoteThreads,
  groupThreadsByDesktopProjects,
  isPathInside
} from "../public/sidebar-projects.js";

const mockState = {
  "project-order": [
    "proj-remote",
    "proj-1",
    "proj-2"
  ],
  "local-projects": {
    "proj-1": {
      name: "本地项目一",
      rootPaths: ["D:\\Work\\Project1", "D:\\Work\\Project1-Alt"]
    },
    "proj-2": {
      name: "本地项目二",
      rootPaths: ["E:\\Software\\Project2"]
    }
  },
  "remote-projects": [
    {
      id: "proj-remote",
      label: "远程测试",
      remotePath: "D:/Remote/DV3",
      hostId: "remote-ssh-discovered:100.108.151.113"
    }
  ],
  "codex-managed-remote-connections": [
    {
      hostId: "remote-ssh-discovered:100.108.151.113",
      displayName: "100.108.151.113"
    }
  ],
  "thread-project-assignments": {
    "thread-explicit-remote": {
      projectKind: "remote",
      projectId: "proj-remote",
      hostId: "remote-ssh-discovered:100.108.151.113"
    },
    "thread-explicit-1": {
      projectKind: "local",
      projectId: "proj-1"
    }
  },
  "projectless-thread-ids": [
    "thread-isolated"
  ],
  "pinned-thread-ids": [
    "thread-pinned-1",
    "thread-pinned-2"
  ],
  "electron-persisted-atom-state": {
    "prompt-history": {
      "thread-explicit-remote": [
        { "markdown": "远程连通测试提示词" }
      ]
    },
    "thread-descriptions-v1": {
      "thread-explicit-remote": "远程测试会话标题"
    }
  }
};

test("parseDesktopState normalizes projects in project-order with remote and local kinds", () => {
  const result = parseDesktopState(mockState);
  assert.equal(result.projects.length, 3);
  assert.equal(result.projects[0].id, "proj-remote");
  assert.equal(result.projects[0].projectKind, "remote");
  assert.equal(result.projects[0].name, "远程测试");
  assert.equal(result.projects[0].hostDisplayName, "100.108.151.113");
  assert.equal(result.projects[0].primaryPath, "D:/Remote/DV3");

  assert.equal(result.projects[1].id, "proj-1");
  assert.equal(result.projects[1].projectKind, "local");
  assert.equal(result.projects[1].name, "本地项目一");
  assert.equal(result.projects[1].rootPaths.length, 2);

  assert.equal(result.pinnedThreadIds.length, 2);
  assert.equal(result.pinnedThreadIds[0], "thread-pinned-1");
});

test("isPathInside matches case-insensitively across Windows and forward slashes", () => {
  assert.equal(isPathInside("D:/work/project1/src", "D:\\Work\\Project1"), true);
  assert.equal(isPathInside("D:\\Work\\Project1", "D:/work/project1"), true);
  assert.equal(isPathInside("D:\\Work\\Other", "D:\\Work\\Project1"), false);
});

test("findProjectForThread respects explicit assignments, exclusions, and multi-root paths", () => {
  const state = parseDesktopState(mockState);

  // 1. Explicit assignment
  const matchedRemote = findProjectForThread(
    { id: "thread-explicit-remote", cwd: "C:\\unknown" },
    state.projects,
    state.assignments,
    state.projectlessThreadIds
  );
  assert.equal(matchedRemote?.id, "proj-remote");

  // 2. Projectless exclusion
  const isolated = findProjectForThread(
    { id: "thread-isolated", cwd: "D:\\Work\\Project1" },
    state.projects,
    state.assignments,
    state.projectlessThreadIds
  );
  assert.equal(isolated, null);

  // 3. Multi-root fallback matching
  const matchedAltRoot = findProjectForThread(
    { id: "thread-alt-root", cwd: "D:\\Work\\Project1-Alt\\sub" },
    state.projects,
    state.assignments,
    state.projectlessThreadIds
  );
  assert.equal(matchedAltRoot?.id, "proj-1");
});

test("groupThreadsByDesktopProjects preserves project order and groups threads", () => {
  const state = parseDesktopState(mockState);
  const threads = [
    { id: "thread-explicit-remote", cwd: "D:/Remote/DV3", updatedAt: 100 },
    { id: "thread-alt-root", cwd: "D:\\Work\\Project1-Alt", updatedAt: 200 },
    { id: "thread-isolated", cwd: "D:\\Work\\Project1", updatedAt: 300 },
    { id: "thread-unassigned", cwd: "C:\\Temp", updatedAt: 50 }
  ];

  const { projects, directThreads } = groupThreadsByDesktopProjects({
    threads,
    desktopProjects: state.projects,
    assignments: state.assignments,
    projectlessIds: state.projectlessThreadIds
  });

  assert.equal(projects.length, 3);
  assert.equal(projects[0].id, "proj-remote");
  assert.equal(projects[0].threads.length, 1);
  assert.equal(projects[1].id, "proj-1");
  assert.equal(projects[1].threads.length, 1);
  assert.equal(projects[2].id, "proj-2");
  assert.equal(projects[2].threads.length, 0); // empty project kept in order!

  assert.equal(directThreads.length, 2); // isolated + unassigned
  assert.equal(directThreads[0].id, "thread-isolated");
  assert.equal(directThreads[1].id, "thread-unassigned");
});

test("DesktopStateManager writes thread-project-assignment safely", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
  const tmpFile = path.join(tmpDir, "state.json");
  fs.writeFileSync(tmpFile, JSON.stringify(mockState), "utf-8");

  const manager = new DesktopStateManager({ stateFilePath: tmpFile });
  const loaded = manager.loadState();
  assert.equal(loaded.projects.length, 3);

  const assigned = manager.assignThreadToProject("new-thread-1", "proj-remote");
  assert.equal(assigned, true);

  const reloaded = manager.loadState();
  assert.equal(reloaded.assignments["new-thread-1"]?.projectId, "proj-remote");
  assert.equal(reloaded.assignments["new-thread-1"]?.projectKind, "remote");
  assert.equal(reloaded.assignments["new-thread-1"]?.hostId, "remote-ssh-discovered:100.108.151.113");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("DesktopStateManager writes local thread-project-assignment and cleans projectless list", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-local-"));
  const tmpFile = path.join(tmpDir, "state.json");
  const stateCopy = JSON.parse(JSON.stringify(mockState));
  stateCopy["projectless-thread-ids"].push("thread-isolated");
  fs.writeFileSync(tmpFile, JSON.stringify(stateCopy), "utf-8");

  const manager = new DesktopStateManager({ stateFilePath: tmpFile });
  let notifiedState = null;
  manager.onChange((st) => { notifiedState = st; });

  const assigned = manager.assignThreadToProject("thread-isolated", "proj-1");
  assert.equal(assigned, true);

  const reloaded = manager.loadState();
  assert.equal(reloaded.assignments["thread-isolated"]?.projectId, "proj-1");
  assert.equal(reloaded.assignments["thread-isolated"]?.projectKind, "local");
  assert.equal(reloaded.projectlessThreadIds.includes("thread-isolated"), false);
  assert.ok(notifiedState);

  const rawDisk = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
  assert.equal(rawDisk["thread-project-membership-host-ids"]["thread-isolated"], "local");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Multi-root realistic project grouping correctly unifies scattered directories", () => {
  const realisticState = {
    "project-order": ["proj-home", "proj-ai"],
    "local-projects": {
      "proj-home": {
        name: "家庭服务与设备",
        rootPaths: ["D:\\Development\\金麓小区设备", "C:\\Program Files\\Jellyfin"]
      },
      "proj-ai": {
        name: "AI研究学习",
        rootPaths: ["D:\\Development\\AI research", "C:\\Users\\CJH\\.codex"]
      }
    }
  };
  const parsed = parseDesktopState(realisticState);
  assert.equal(parsed.projects.length, 2);

  const threads = [
    { id: "t1", cwd: "D:\\Development\\金麓小区设备\\driver.py" },
    { id: "t2", cwd: "C:\\Program Files\\Jellyfin\\server.exe" },
    { id: "t3", cwd: "D:\\Development\\AI research\\notes.md" },
    { id: "t4", cwd: "C:\\Users\\CJH\\.codex\\config.toml" },
    { id: "t5", cwd: "E:\\Other\\Standalone" }
  ];

  const grouped = groupThreadsByDesktopProjects({
    threads,
    desktopProjects: parsed.projects
  });

  assert.equal(grouped.projects[0].name, "家庭服务与设备");
  assert.equal(grouped.projects[0].threads.length, 2);
  assert.equal(grouped.projects[1].name, "AI研究学习");
  assert.equal(grouped.projects[1].threads.length, 2);
  assert.equal(grouped.directThreads.length, 1);
  assert.equal(grouped.directThreads[0].id, "t5");
});

test("parseDesktopState extracts remote threads with derived metadata and sorting", () => {
  const result = parseDesktopState(mockState);
  assert.equal(result.remoteThreads.length, 1);
  const rt = result.remoteThreads[0];
  assert.equal(rt.id, "thread-explicit-remote");
  assert.equal(rt.title, "远程测试会话标题");
  assert.equal(rt.preview, "远程连通测试提示词");
  assert.equal(rt.hostId, "remote-ssh-discovered:100.108.151.113");
  assert.equal(rt.cwd, "D:/Remote/DV3");
  assert.equal(rt.projectKind, "remote");
  assert.equal(rt.isRemote, true);
});

test("mergeRemoteThreads merges unique remote threads into local list without duplication", () => {
  const localList = [{ id: "t1" }, { id: "t2" }];
  const remoteList = [{ id: "t2" }, { id: "t3" }];
  const merged = mergeRemoteThreads(localList, remoteList);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((t) => t.id), ["t1", "t2", "t3"]);
});

test("DesktopStateManager toggles thread pinned status correctly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-pin-"));
  const tmpFile = path.join(tmpDir, "state.json");
  fs.writeFileSync(tmpFile, JSON.stringify(mockState), "utf-8");

  const manager = new DesktopStateManager({ stateFilePath: tmpFile });
  assert.equal(manager.loadState().pinnedThreadIds.includes("thread-new-pin"), false);

  // Pin thread
  const pinOk = manager.setThreadPinned("thread-new-pin", true);
  assert.equal(pinOk, true);
  assert.equal(manager.loadState().pinnedThreadIds[0], "thread-new-pin");

  // Unpin thread
  const unpinOk = manager.setThreadPinned("thread-new-pin", false);
  assert.equal(unpinOk, true);
  assert.equal(manager.loadState().pinnedThreadIds.includes("thread-new-pin"), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("DesktopStateManager toggles project pinned status correctly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-proj-pin-"));
  const tmpFile = path.join(tmpDir, "state.json");
  fs.writeFileSync(tmpFile, JSON.stringify(mockState), "utf-8");

  const manager = new DesktopStateManager({ stateFilePath: tmpFile });
  assert.equal(manager.loadState().projects[0].id, "proj-remote");

  // Pin proj-2 to top
  const pinOk = manager.setProjectPinned("proj-2", true);
  assert.equal(pinOk, true);
  const reloaded = manager.loadState();
  assert.equal(reloaded.projects[0].id, "proj-2");
  assert.equal(reloaded.pinnedProjectIds.includes("proj-2"), true);

  // Unpin proj-2
  const unpinOk = manager.setProjectPinned("proj-2", false);
  assert.equal(unpinOk, true);
  assert.equal(manager.loadState().pinnedProjectIds.includes("proj-2"), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
