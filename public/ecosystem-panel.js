/**
 * Ecosystem panel utilities for Codex WebUI.
 * Pure ESM module with no Node built-in dependencies (browser and Node compatible).
 */

export function normalizeSkillsCatalog(response) {
  if (!response) return [];
  const entries = Array.isArray(response.data)
    ? response.data
    : (Array.isArray(response) ? response : []);

  const skillMap = new Map();

  for (const item of entries) {
    if (!item) continue;
    // Check if item is a group with skills array or a skill directly
    const groupCwd = String(item.cwd || "");
    const rawSkills = Array.isArray(item.skills) ? item.skills : [item];

    for (const skill of rawSkills) {
      if (!skill) continue;
      const name = String(skill.name || "");
      const pathStr = String(skill.path || "");
      if (!name && !pathStr) continue;

      const key = pathStr || name;
      if (!skillMap.has(key)) {
        skillMap.set(key, {
          name: name || pathStr.split(/[\\/]/).pop() || "unknown",
          description: String(skill.description || skill.shortDescription || ""),
          path: pathStr,
          scope: String(skill.scope || "user"),
          enabled: skill.enabled !== false,
          pluginId: skill.pluginId ? String(skill.pluginId) : null,
          cwd: String(skill.cwd || groupCwd)
        });
      }
    }
  }

  const result = Array.from(skillMap.values());
  result.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return result;
}

export function buildSkillToggleParams(skill, enabled) {
  return {
    ...(skill?.path ? { path: skill.path } : {}),
    ...(skill?.name ? { name: skill.name } : {}),
    enabled: Boolean(enabled)
  };
}

export function normalizeMcpServerList(response) {
  if (!response) return [];
  const rawList = Array.isArray(response.data)
    ? response.data
    : (Array.isArray(response) ? response : []);

  const servers = [];
  for (const s of rawList) {
    if (!s) continue;
    const name = String(s.name || "");
    if (!name) continue;

    const status = String(s.runtimeStatus || s.status || "disconnected");
    const authStatus = String(s.authStatus || "none");
    const pluginId = s.pluginId ? String(s.pluginId) : null;
    const error = String(s.toolsError || s.error || "");

    let toolCount = 0;
    const toolNames = [];
    if (Array.isArray(s.tools)) {
      toolCount = s.tools.length;
      for (const t of s.tools) {
        if (t?.name) toolNames.push(String(t.name));
        else if (typeof t === "string") toolNames.push(t);
      }
    } else if (s.tools && typeof s.tools === "object") {
      const keys = Object.keys(s.tools);
      toolCount = keys.length;
      for (const k of keys) {
        const t = s.tools[k];
        toolNames.push(t?.name ? String(t.name) : k);
      }
    }

    let resourceCount = 0;
    if (Array.isArray(s.resources)) resourceCount += s.resources.length;
    else if (s.resources && typeof s.resources === "object") resourceCount += Object.keys(s.resources).length;
    if (Array.isArray(s.resourceTemplates)) resourceCount += s.resourceTemplates.length;
    else if (s.resourceTemplates && typeof s.resourceTemplates === "object") resourceCount += Object.keys(s.resourceTemplates).length;

    servers.push({
      name,
      status,
      authStatus,
      toolCount,
      toolNames,
      resourceCount,
      error,
      pluginId
    });
  }

  servers.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return servers;
}

export function normalizePluginCatalog(response) {
  if (!response) return [];
  const plugins = [];

  if (Array.isArray(response.marketplaces)) {
    for (const mp of response.marketplaces) {
      const mpName = String(mp?.name || "default");
      if (Array.isArray(mp?.plugins)) {
        for (const p of mp.plugins) {
          if (!p) continue;
          plugins.push({
            id: String(p.id || p.name || ""),
            name: String(p.name || p.id || ""),
            marketplace: mpName,
            version: String(p.version || p.localVersion || ""),
            installed: Boolean(p.installed),
            enabled: Boolean(p.enabled)
          });
        }
      }
    }
  } else if (Array.isArray(response.plugins)) {
    for (const p of response.plugins) {
      if (!p) continue;
      plugins.push({
        id: String(p.id || p.name || ""),
        name: String(p.name || p.id || ""),
        marketplace: "default",
        version: String(p.version || p.localVersion || ""),
        installed: Boolean(p.installed),
        enabled: Boolean(p.enabled)
      });
    }
  } else if (Array.isArray(response)) {
    for (const p of response) {
      if (!p) continue;
      plugins.push({
        id: String(p.id || p.name || ""),
        name: String(p.name || p.id || ""),
        marketplace: String(p.marketplace || "default"),
        version: String(p.version || p.localVersion || ""),
        installed: Boolean(p.installed),
        enabled: Boolean(p.enabled)
      });
    }
  }

  plugins.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return plugins;
}

export function extractSubagentsAndLoadedThreads({ loadedResult, threads = [], currentThreadId = "", messages = [] } = {}) {
  const loadedIds = new Set(
    Array.isArray(loadedResult?.data)
      ? loadedResult.data
      : (Array.isArray(loadedResult) ? loadedResult : [])
  );

  const threadList = Array.isArray(threads) ? threads : [];
  const seenIds = new Set();
  const result = [];

  for (const t of threadList) {
    if (!t) continue;
    const tid = String(t.id || "");
    if (!tid) continue;
    seenIds.add(tid);
    const isLoaded = loadedIds.has(tid);
    const isCurrent = tid === currentThreadId;
    result.push({
      threadId: tid,
      name: String(t.name || t.title || tid),
      cwd: String(t.cwd || ""),
      status: String(t.status || (isLoaded ? "active" : "idle")),
      isLoaded,
      isCurrent
    });
  }

  for (const lid of loadedIds) {
    if (!seenIds.has(lid)) {
      seenIds.add(lid);
      result.push({
        threadId: lid,
        name: lid,
        cwd: "",
        status: "active",
        isLoaded: true,
        isCurrent: lid === currentThreadId
      });
    }
  }

  return result;
}

export function normalizeThreadGoal(goalPayload) {
  const goal = goalPayload?.goal || goalPayload;
  if (!goal || typeof goal !== "object" || !goal.objective) {
    return {
      active: false,
      objective: "",
      status: "none",
      tokenBudget: null,
      tokensUsed: 0,
      progressPercent: null
    };
  }

  const objective = String(goal.objective || "");
  const status = String(goal.status || "active");
  const tokenBudget = typeof goal.tokenBudget === "number" ? goal.tokenBudget : null;
  const tokensUsed = Number(goal.tokensUsed) || 0;
  const progressPercent = (tokenBudget && tokenBudget > 0)
    ? Math.min(100, Math.round((tokensUsed / tokenBudget) * 100))
    : null;
  const active = Boolean(objective && status !== "completed" && status !== "stopped" && status !== "paused");

  return {
    active,
    objective,
    status,
    tokenBudget,
    tokensUsed,
    progressPercent
  };
}
