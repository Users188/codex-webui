import { activityPriority, createThreadActivity } from "./thread-activity.js";

export function sortProjectGroupsByActivity(groups, activityByThread = new Map()) {
  return [...(groups || [])].sort((left, right) => {
    const leftRank = projectGroupRank(left, activityByThread);
    const rightRank = projectGroupRank(right, activityByThread);
    if (leftRank.attention !== rightRank.attention) return leftRank.attention - rightRank.attention;
    if (leftRank.updatedAt !== rightRank.updatedAt) return rightRank.updatedAt - leftRank.updatedAt;
    return String(left?.name || "").localeCompare(String(right?.name || ""));
  });
}

export function projectGroupRank(group, activityByThread = new Map()) {
  const threads = group?.threads || [];
  return {
    attention: Math.min(4, ...threads.map((thread) =>
      activityPriority(activityByThread.get(thread?.id) || createThreadActivity())
    )),
    updatedAt: Math.max(0, ...threads.map(threadTimestampMs))
  };
}

export function projectOverflowAction({ collapsed, totalCount, visibleCount, expanded }) {
  if (collapsed) return "none";
  if (Number(totalCount) > Number(visibleCount)) return "expand";
  if (expanded && Number(totalCount) > 6) return "collapse";
  return "none";
}

export function normalizeProjectPath(value) {
  return String(value || "")
    .replace(/[\\/]+$/, "")
    .replaceAll("\\", "/")
    .toLowerCase();
}

export function isPathInside(childPath, parentPath) {
  const child = normalizeProjectPath(childPath);
  const parent = normalizeProjectPath(parentPath);
  if (!child || !parent) return false;
  return child === parent || child.startsWith(`${parent}/`);
}

export function findProjectForThread(thread, desktopProjects = [], assignments = {}, projectlessIds = []) {
  if (!thread) return null;
  const projects = Array.isArray(desktopProjects) ? desktopProjects : [];

  // 1. Explicit assignment
  const assign = assignments?.[thread.id];
  const assignedProjId = typeof assign === "string" ? assign : (assign?.projectId || thread.projectId);
  if (assignedProjId) {
    const matched = projects.find((p) => p.id === assignedProjId);
    if (matched) return matched;
  }

  // 2. Explicitly projectless
  if (Array.isArray(projectlessIds) && projectlessIds.includes(thread.id)) {
    return null;
  }

  // 3. Multi-root matching
  if (thread.cwd) {
    for (const proj of projects) {
      for (const root of proj.rootPaths || []) {
        if (isPathInside(thread.cwd, root)) {
          return proj;
        }
      }
    }
  }

  return null;
}

export function groupThreadsByDesktopProjects({
  threads = [],
  desktopProjects = [],
  assignments = {},
  projectlessIds = [],
  rankingThreads = threads,
  activityByThread = new Map()
}) {
  const projectGroups = new Map();
  const directThreads = [];

  // Initialize all desktop projects in their exact configured order
  for (const proj of desktopProjects) {
    projectGroups.set(proj.id, {
      key: `project:${proj.id}`,
      id: proj.id,
      name: proj.name,
      projectKind: proj.projectKind || "local",
      hostId: proj.hostId || "local",
      hostDisplayName: proj.hostDisplayName || null,
      primaryPath: proj.primaryPath || proj.rootPaths?.[0] || "",
      cwd: proj.primaryPath || proj.rootPaths?.[0] || "",
      rootPaths: proj.rootPaths || [],
      isGitRepository: Boolean(proj.isGitRepository),
      threads: []
    });
  }

  // Group threads
  for (const thread of threads) {
    const proj = findProjectForThread(thread, desktopProjects, assignments, projectlessIds);
    if (proj && projectGroups.has(proj.id)) {
      projectGroups.get(proj.id).threads.push(thread);
    } else {
      directThreads.push(thread);
    }
  }

  // Calculate ranking thread count
  const rankingCounts = new Map();
  for (const thread of rankingThreads) {
    const proj = findProjectForThread(thread, desktopProjects, assignments, projectlessIds);
    if (proj) {
      rankingCounts.set(proj.id, (rankingCounts.get(proj.id) || 0) + 1);
    }
  }

  // Sort threads inside each project by recency
  for (const group of projectGroups.values()) {
    group.threads.sort((a, b) => threadTimestampMs(b) - threadTimestampMs(a));
    group.totalCount = rankingCounts.get(group.id) ?? group.threads.length;
  }

  // Sort direct threads by recency
  directThreads.sort((a, b) => threadTimestampMs(b) - threadTimestampMs(a));

  return {
    projects: Array.from(projectGroups.values()),
    directThreads
  };
}

function threadTimestampMs(thread) {
  const value = thread?.recencyAt || thread?.updatedAt || thread?.createdAt || 0;
  if (typeof value === "number") return value < 100000000000 ? value * 1000 : value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 100000000000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function mergeRemoteThreads(localThreads = [], remoteThreads = []) {
  const list = [...(localThreads || [])];
  const seen = new Set(list.map((t) => t.id).filter(Boolean));
  for (const remote of remoteThreads || []) {
    if (remote?.id && !seen.has(remote.id)) {
      list.push(remote);
      seen.add(remote.id);
    }
  }
  return list;
}
