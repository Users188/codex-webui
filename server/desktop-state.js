import { existsSync, readFileSync, statSync, watch, writeFileSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveCodexGlobalStatePath() {
  if (process.env.CODEX_GLOBAL_STATE_PATH && existsSync(process.env.CODEX_GLOBAL_STATE_PATH)) {
    return process.env.CODEX_GLOBAL_STATE_PATH;
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, ".codex", ".codex-global-state.json"),
    "C:\\Users\\CJH\\.codex\\.codex-global-state.json",
    "/mnt/c/Users/CJH/.codex/.codex-global-state.json",
    "\\\\wsl.localhost\\Ubuntu\\home\\cjh\\.codex\\.codex-global-state.json"
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function extractRemoteThreads(stateJson, remoteProjects = []) {
  if (!stateJson || typeof stateJson !== "object") return [];
  const assignments = stateJson["thread-project-assignments"] || {};
  const atomState = stateJson["electron-persisted-atom-state"] || {};
  const promptHistory = atomState["prompt-history"] || {};
  const threadDescriptions = atomState["thread-descriptions-v1"] || {};
  const remoteProjectsById = new Map((remoteProjects || []).map((p) => [p.id, p]));

  const threads = [];
  for (const [threadId, rawAssign] of Object.entries(assignments)) {
    const projectId = typeof rawAssign === "string" ? rawAssign : rawAssign?.projectId;
    const projectKind = typeof rawAssign === "object" ? rawAssign?.projectKind : null;
    const hostId = typeof rawAssign === "object" ? rawAssign?.hostId : null;

    const proj = remoteProjectsById.get(projectId);
    if (!proj && projectKind !== "remote") continue;

    let createdAtSec = Math.floor(Date.now() / 1000);
    const hexTime = String(threadId || "").replace(/-/g, "").slice(0, 12);
    const ms = parseInt(hexTime, 16);
    if (Number.isFinite(ms) && ms > 1500000000000 && ms < 3000000000000) {
      createdAtSec = Math.floor(ms / 1000);
    }

    const prompts = promptHistory[threadId];
    const firstPrompt = Array.isArray(prompts)
      ? (typeof prompts[0] === "string" ? prompts[0] : prompts[0]?.markdown || "")
      : "";
    const description = threadDescriptions[threadId] || "";

    const title = description || firstPrompt || proj?.name || "远程会话";
    const preview = firstPrompt || description || title;

    threads.push({
      id: threadId,
      name: title,
      title,
      preview,
      cwd: proj?.primaryPath || proj?.remotePath || "",
      hostId: hostId || proj?.hostId || "remote",
      hostDisplayName: proj?.hostDisplayName || null,
      projectId: projectId || proj?.id,
      projectKind: "remote",
      status: { type: "idle" },
      createdAt: createdAtSec,
      updatedAt: createdAtSec,
      recencyAt: createdAtSec,
      source: "remote",
      isRemote: true
    });
  }

  threads.sort((a, b) => (b.recencyAt || b.createdAt) - (a.recencyAt || a.createdAt));
  return threads;
}

export function parseDesktopState(stateJson) {
  if (!stateJson || typeof stateJson !== "object") {
    return {
      projects: [],
      assignments: {},
      projectlessThreadIds: [],
      pinnedThreadIds: [],
      pinnedProjectIds: [],
      remoteThreads: []
    };
  }

  const localProjects = stateJson["local-projects"] || {};
  const remoteProjects = Array.isArray(stateJson["remote-projects"]) ? stateJson["remote-projects"] : [];
  const projectOrder = Array.isArray(stateJson["project-order"]) ? stateJson["project-order"] : [];
  const threadAssignments = stateJson["thread-project-assignments"] || {};
  const projectlessThreadIds = Array.isArray(stateJson["projectless-thread-ids"]) ? stateJson["projectless-thread-ids"] : [];
  const pinnedThreadIds = Array.isArray(stateJson["pinned-thread-ids"]) ? stateJson["pinned-thread-ids"] : [];
  const pinnedProjectIds = Array.isArray(stateJson["pinned-project-ids"]) ? stateJson["pinned-project-ids"] : [];
  const remoteConnections = Array.isArray(stateJson["codex-managed-remote-connections"]) ? stateJson["codex-managed-remote-connections"] : [];

  const hostMap = new Map();
  for (const conn of remoteConnections) {
    if (conn?.hostId) {
      hostMap.set(conn.hostId, conn.displayName || conn.alias || conn.hostId.replace(/^remote-ssh-(?:discovered:)?/, ""));
    }
  }

  const projectMap = new Map();

  for (const [id, raw] of Object.entries(localProjects)) {
    if (!raw || typeof raw !== "object") continue;
    const name = String(raw.name || raw.label || "").trim();
    const rootPaths = Array.isArray(raw.rootPaths)
      ? raw.rootPaths.filter((p) => typeof p === "string" && p.trim())
      : [];
    if (!id || !name) continue;

    projectMap.set(id, {
      id,
      name,
      projectKind: "local",
      hostId: "local",
      hostDisplayName: null,
      rootPaths,
      primaryPath: rootPaths[0] || "",
      isGitRepository: Boolean(raw.isGitRepository)
    });
  }

  for (const raw of remoteProjects) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id || "").trim();
    const name = String(raw.label || raw.name || "").trim();
    const remotePath = String(raw.remotePath || "").trim();
    const hostId = String(raw.hostId || "").trim();
    if (!id || !name) continue;

    const hostDisplayName = hostMap.get(hostId) || hostId.replace(/^remote-ssh-(?:discovered:)?/, "") || hostId;
    projectMap.set(id, {
      id,
      name,
      projectKind: "remote",
      hostId,
      hostDisplayName,
      rootPaths: remotePath ? [remotePath] : [],
      primaryPath: remotePath,
      isGitRepository: Boolean(raw.isGitRepository)
    });
  }

  const orderedProjects = [];
  const seenIds = new Set();
  for (const id of projectOrder) {
    if (projectMap.has(id) && !seenIds.has(id)) {
      orderedProjects.push(projectMap.get(id));
      seenIds.add(id);
    }
  }
  for (const [id, proj] of projectMap.entries()) {
    if (!seenIds.has(id)) {
      orderedProjects.push(proj);
      seenIds.add(id);
    }
  }

  return {
    projects: orderedProjects,
    assignments: threadAssignments,
    projectlessThreadIds,
    pinnedThreadIds,
    pinnedProjectIds,
    remoteThreads: extractRemoteThreads(stateJson, Array.from(projectMap.values()).filter((p) => p.projectKind === "remote"))
  };
}

export class DesktopStateManager {
  constructor({ stateFilePath = null } = {}) {
    this.customPath = stateFilePath;
    this.cachedState = null;
    this.lastMtime = 0;
    this.listeners = new Set();
    this.watcher = null;
  }

  getStatePath() {
    return this.customPath || resolveCodexGlobalStatePath();
  }

  loadState() {
    const p = this.getStatePath();
    if (!p || !existsSync(p)) {
      return {
        projects: [],
        assignments: {},
        projectlessThreadIds: [],
        pinnedThreadIds: [],
      pinnedProjectIds: [],
        remoteThreads: []
      };
    }
    try {
      const stat = statSync(p);
      if (this.cachedState && stat.mtimeMs === this.lastMtime) {
        return this.cachedState;
      }
      const raw = readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw);
      this.cachedState = parseDesktopState(parsed);
      this.lastMtime = stat.mtimeMs;
      this.ensureWatcher(p);
      return this.cachedState;
    } catch {
      return this.cachedState || {
        projects: [],
        assignments: {},
        projectlessThreadIds: [],
        pinnedThreadIds: [],
      pinnedProjectIds: [],
        remoteThreads: []
      };
    }
  }

  ensureWatcher(filePath) {
    if (this.watcher) return;
    try {
      this.watcher = watch(filePath, () => {
        this.reloadAndNotify();
      });
      this.watcher.unref?.();
    } catch {}
  }

  reloadAndNotify() {
    this.lastMtime = 0;
    const next = this.loadState();
    for (const listener of this.listeners) {
      try { listener(next); } catch {}
    }
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setThreadPinned(threadId, pinned) {
    if (!threadId) return false;
    const p = this.getStatePath();
    if (!p || !existsSync(p)) return false;

    try {
      const raw = readFileSync(p, "utf-8");
      const data = JSON.parse(raw);
      let list = Array.isArray(data["pinned-thread-ids"]) ? [...data["pinned-thread-ids"]] : [];

      if (pinned) {
        if (!list.includes(threadId)) {
          list.unshift(threadId);
        }
      } else {
        list = list.filter((id) => id !== threadId);
      }

      data["pinned-thread-ids"] = list;

      const tmpPath = p + "." + Date.now() + "." + Math.random().toString(36).slice(2) + ".tmp";
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      renameSync(tmpPath, p);

      this.reloadAndNotify();
      return true;
    } catch (err) {
      console.warn("[desktop-state] Failed to set thread pinned:", err.message);
      return false;
    }
  }

  setProjectPinned(projectId, pinned) {
    if (!projectId) return false;
    const p = this.getStatePath();
    if (!p || !existsSync(p)) return false;

    try {
      const raw = readFileSync(p, "utf-8");
      const data = JSON.parse(raw);
      let order = Array.isArray(data["project-order"]) ? [...data["project-order"]] : [];
      let pinnedList = Array.isArray(data["pinned-project-ids"]) ? [...data["pinned-project-ids"]] : [];

      if (pinned) {
        order = [projectId, ...order.filter((id) => id !== projectId)];
        if (!pinnedList.includes(projectId)) {
          pinnedList.unshift(projectId);
        }
      } else {
        pinnedList = pinnedList.filter((id) => id !== projectId);
      }

      data["project-order"] = order;
      data["pinned-project-ids"] = pinnedList;

      const tmpPath = p + "." + Date.now() + "." + Math.random().toString(36).slice(2) + ".tmp";
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      renameSync(tmpPath, p);

      this.reloadAndNotify();
      return true;
    } catch (err) {
      console.warn("[desktop-state] Failed to set project pinned:", err.message);
      return false;
    }
  }

  assignThreadToProject(threadId, projectId) {
    if (!threadId || !projectId) return false;
    const p = this.getStatePath();
    if (!p || !existsSync(p)) return false;

    try {
      const raw = readFileSync(p, "utf-8");
      const data = JSON.parse(raw);
      const state = parseDesktopState(data);
      const targetProj = state.projects.find((pr) => pr.id === projectId);
      if (!targetProj) return false;

      if (!data["thread-project-assignments"]) {
        data["thread-project-assignments"] = {};
      }
      data["thread-project-assignments"][threadId] = {
        projectKind: targetProj.projectKind,
        projectId: targetProj.id,
        ...(targetProj.projectKind === "remote" ? { hostId: targetProj.hostId } : {})
      };

      if (!data["thread-project-membership-host-ids"]) {
        data["thread-project-membership-host-ids"] = {};
      }
      data["thread-project-membership-host-ids"][threadId] = targetProj.projectKind === "remote" ? targetProj.hostId : "local";

      if (Array.isArray(data["projectless-thread-ids"])) {
        data["projectless-thread-ids"] = data["projectless-thread-ids"].filter((id) => id !== threadId);
      }

      const tmpPath = `${p}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      renameSync(tmpPath, p);

      this.reloadAndNotify();
      return true;
    } catch (err) {
      console.warn("[desktop-state] Failed to assign thread to project:", err.message);
      return false;
    }
  }
}
