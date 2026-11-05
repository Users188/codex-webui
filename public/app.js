import {
  encodeTerminalInputBase64,
  decodeTerminalOutputBase64,
  stripAnsiCodes,
  buildTerminalStartParams,
  buildTerminalWriteParams,
  buildTerminalResizeParams,
  buildTerminalTerminateParams
} from "./terminal-pane.js";
import {
  normalizeSkillsCatalog,
  buildSkillToggleParams,
  normalizeMcpServerList,
  normalizePluginCatalog,
  extractSubagentsAndLoadedThreads,
  normalizeThreadGoal
} from "./ecosystem-panel.js";
import {
  parseUnifiedDiff,
  buildSplitDiffRows,
  diffFromFileChangeItem,
  validatePatchPaths
} from "./diff-review.js";
import {
  detectFileMentionTrigger,
  insertFileMention,
  normalizeFileTreeEntries,
  classifyFilePreviewKind
} from "./file-explorer.js";
import { currentLocale, initI18n, t } from "./i18n.js";
import {
  extractProposedPlan,
  normalizePlanSteps,
  buildApprovalDecisions,
  collectQuestionAnswers,
  formatTokenUsageSummary
} from "./plan-mode.js";
import { authenticatedUrl, authenticationAccepted, webSocketUrl } from "./access-auth.js";
import { isWebUserApproval } from "./approval-policy.js";
import {
  buildInterruptRequest,
  buildPromptRequest,
  shouldAdvanceQueueAfterTurn,
  waitForPendingImageUploads
} from "./follow-up.js";
import { formatResetTime, normalizeRateLimits, rateLimitWindowLabel } from "./rate-limits.js";
import {
  findProjectForThread,
  groupThreadsByDesktopProjects,
  isPathInside,
  mergeRemoteThreads,
  projectGroupRank,
  projectOverflowAction,
  sortProjectGroupsByActivity
} from "./sidebar-projects.js";
import {
  ACTIVE_THREAD_SYNC_MS,
  IDLE_THREAD_SYNC_MS,
  activeTurnIdFromLatest,
  anchoredHistoryScrollTop,
  createLatestFrameBatcher,
  createReadinessGate,
  createRecentThreadCache,
  disclosureIdentity,
  findTransientMessageAliasIndex,
  initialThreadCandidates,
  liveFollowState,
  mergeRecentMessages,
  restoreFirstUsableThread,
  selectThreadCachePrewarmIds,
  shouldAutoLoadOlderTurns,
  shouldRefreshCachedThread,
  shouldRenderThreadLoadOverlay,
  threadSyncDelay,
  turnLifecycle,
  updateDisclosureState
} from "./thread-sync.js";
import {
  THREAD_ACTIVITY,
  activityPriority,
  completionNotificationKey,
  createThreadActivity,
  reduceThreadActivity,
  shouldNotifyCompletion
} from "./thread-activity.js";
import {
  availablePermissionModes,
  buildSharedThreadStart,
  buildThreadSettingsUpdate,
  permissionModeFromSettings,
  threadSettingsFromNotification,
  threadSettingsFromResume
} from "./thread-settings.js";
const byteEncoder = new TextEncoder();
const TURN_PAGE_LIMIT = 6;
const TURN_ITEMS_VIEW = "full";
const THEME_STORAGE_KEY = "codex-webui-theme";
const LAST_THREAD_STORAGE_KEY = "codex-webui-last-thread-id";
const TOKEN_STORAGE_KEY = "codex-webui-access-token";
const THREAD_URL_PARAM = "thread";
const COLLAPSED_PROJECTS_STORAGE_KEY = "codex-webui-collapsed-projects";
const IMAGE_UPLOAD_TARGET_BYTES = 1400 * 1024;
const IMAGE_UPLOAD_MAX_EDGE = 1800;
const IMAGE_UPLOAD_MAX_PIXELS = 2400000;
const IMAGE_UPLOAD_JPEG_QUALITIES = [0.84, 0.74, 0.64];
const RECENT_THREAD_CACHE_LIMIT = 16;
const BACKGROUND_CACHE_CONCURRENCY = 2;
const BACKGROUND_CACHE_NOTIFICATION_METHODS = new Set([
  "item/agentMessage/delta",
  "item/started",
  "item/completed",
  "turn/started",
  "turn/completed"
]);

const state = {
  ws: null,
  collaborationMode: "default",
  serviceTier: "",
  showArchivedThreads: false,
  tokenUsage: null,
  tokenRole: "",
  activePlan: null,
  sidePanelOpen: false,
  activeSideTab: "review",
  diffViewMode: "unified",
  currentDiff: "",
  currentFileTreePath: "",
  fileTreeEntries: [],
  activePreviewFilePath: "",
  fileMentionTrigger: null,
  fileMentionItems: [],
  fileMentionSelectedIndex: 0,
  terminalPaneOpen: false,
  terminals: new Map(),
  activeTerminalId: null,
  nextTerminalId: 1,
  ecosystemModalOpen: false,
  activeEcoTab: "skills",
  ecoSkills: [],
  ecoMcpServers: [],
  ecoPlugins: [],
  currentThreadGoal: null,
  activeSubagents: [],
  token: null,
  authMode: "",
  nextRequestId: 1,
  pending: new Map(),
  threads: [],
  expandedProjects: new Set(),
  collapsedProjects: storedCollapsedProjects(),
  pendingImages: [],
  skills: [],
  skillsByCwd: new Map(),
  pendingSkills: [],
  skillMenuOpen: false,
  skillMenuIndex: 0,
  skillMenuItems: [],
  skillTrigger: null,
  currentThread: null,
  lastMessageAt: null,
  loadingThreadId: null,
  threadContentGate: null,
  sendingThreadId: null,
  interruptingTurnId: null,
  initialThreadRestorePending: true,
  threadLoadSeq: 0,
  threadLoadStats: null,
  lastLoadStats: null,
  turnCursor: null,
  hasOlderTurns: false,
  loadingOlderTurns: false,
  historyAutoLoadArmed: false,
  followLiveOutput: true,
  openDisclosures: new Set(),
  resumingThreadId: null,
  loadedTurnIds: new Set(),
  recentThreadCache: createRecentThreadCache(RECENT_THREAD_CACHE_LIMIT),
  threadSettingsCache: createRecentThreadCache(RECENT_THREAD_CACHE_LIMIT),
  backgroundCacheQueue: [],
  backgroundCacheQueued: new Set(),
  backgroundCacheInFlight: new Set(),
  backgroundCacheTimers: new Map(),
  activeTurns: new Map(),
  queueStartingThreadIds: new Set(),
  threadActivity: new Map(),
  pendingRequestThreads: new Map(),
  notificationKeys: new Set(),
  replyProgressThreadIds: new Set(),
  turnDiagnostics: new Map(),
  messages: [],
  models: [],
  permissionProfiles: [],
  permissionModes: [],
  configRequirements: null,
  currentThreadSettings: null,
  applyingThreadSettings: false,
  settingsSaving: false,
  pendingSettingsSelection: null,
  threadSettingsAvailable: false,
  workspaceBrowserAvailable: false,
  config: null,
  threadFilterCwds: [],
  connected: false,
  account: null,
  rateLimits: { windows: [], planType: "", credits: null },
  rateLimitsError: "",
  urlThreadId: "",
  desktopBridgeConnected: true,
  desktopBridgeReconnecting: false,
  threadLockConflict: false,
  forkingThreadId: null,
  threadSyncTimer: null,
  threadSyncInFlight: false,
  threadListSyncInFlight: false,
  lastThreadListSyncAt: 0,
  desktopProjects: [],
  desktopAssignments: {},
  pinnedThreadIds: [],
  pinnedProjectIds: [],
  projectlessThreadIds: [],
  desktopRemoteThreads: []
};

let threadTitleScrollFrame = null;
let threadTitleScrollTimer = null;
let threadTitleBeforeEdit = "";
let threadTitleSaving = false;
let backGuardSerial = 0;
let backGuardBaseUrl = "";
let backGuardHandling = false;
let backGuardArmedAt = 0;
let backSentinels = [];
let backSentinelReopening = false;
const BACK_GUARD_HASH_PREFIX = "codex-webui-stay-";
const BACK_SENTINEL_COUNT = 4;

const els = {
  connection: document.querySelector("#connection"),
  connectionBanner: document.querySelector("#connectionBanner"),
  threadList: document.querySelector("#threadList"),
  searchThreads: document.querySelector("#searchThreads"),
  newThread: document.querySelector("#newThread"),
  refreshThreads: document.querySelector("#refreshThreads"),
  openSidebar: document.querySelector("#openSidebar"),
  closeSidebar: document.querySelector("#closeSidebar"),
  sidebar: document.querySelector("#sidebar"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  promptInput: document.querySelector("#promptInput"),
  followUpMenu: document.querySelector("#followUpMenu"),
  skillMenu: document.querySelector("#skillMenu"),
  sendButton: document.querySelector("#sendButton"),
  chatPane: document.querySelector(".chat-pane"),
  setupBand: document.querySelector("#setupBand"),
  settingsToggle: null,
  imageInput: null,
  imageTray: null,
  cwdInput: document.querySelector("#cwdInput"),
  projectSelect: document.querySelector("#projectSelect"),
  contextSettingLabel: document.querySelector("#contextSettingLabel"),
  currentConversationSummary: document.querySelector("#currentConversationSummary"),
  workspaceSettingControls: document.querySelector("#workspaceSettingControls"),
  modelSelect: document.querySelector("#modelSelect"),
  reasoningSelect: document.querySelector("#reasoningSelect"),
  permissionSelect: document.querySelector("#permissionSelect"),
  browseWorkspace: document.querySelector("#browseWorkspace"),
  workspacePicker: document.querySelector("#workspacePicker"),
  workspacePickerBackdrop: document.querySelector("#workspacePickerBackdrop"),
  workspacePickerClose: document.querySelector("#workspacePickerClose"),
  workspaceCurrentPath: document.querySelector("#workspaceCurrentPath"),
  workspaceRoots: document.querySelector("#workspaceRoots"),
  workspaceParent: document.querySelector("#workspaceParent"),
  workspaceUseCurrent: document.querySelector("#workspaceUseCurrent"),
  workspaceDirectoryList: document.querySelector("#workspaceDirectoryList"),
  workspaceCreateForm: document.querySelector("#workspaceCreateForm"),
  workspaceName: document.querySelector("#workspaceName"),
  workspaceError: document.querySelector("#workspaceError"),
  threadTitle: document.querySelector("#threadTitle"),
  threadMeta: document.querySelector("#threadMeta"),
  resumeStatus: document.querySelector("#resumeStatus"),
  threadLockBanner: document.querySelector("#threadLockBanner"),
  lockRetryBtn: document.querySelector("#lockRetryBtn"),
  lockForkBtn: document.querySelector("#lockForkBtn"),
  fullscreenToggle: document.querySelector("#fullscreenToggle"),
  imageViewer: document.querySelector("#imageViewer"),
  imageViewerImg: document.querySelector("#imageViewerImg"),
  imageViewerBackdrop: document.querySelector("#imageViewerBackdrop"),
  imageViewerClose: document.querySelector("#imageViewerClose"),
  themeSelect: document.querySelector("#themeSelect"),
  trafficSummary: document.querySelector("#trafficSummary"),
  collaborationModeSelect: document.querySelector("#collaborationModeSelect"),
  serviceTierSelect: document.querySelector("#serviceTierSelect"),
  composerMetaRow: document.querySelector("#composerMetaRow"),
  composerToolbar: document.querySelector("#composerToolbar"),
  planModeToggle: document.querySelector("#planModeToggle"),
  planPanel: document.querySelector("#planPanel"),
  tokenUsageBadge: document.querySelector("#tokenUsageBadge"),
  compactThreadBtn: document.querySelector("#compactThreadBtn"),
  archiveThreadBtn: document.querySelector("#archiveThreadBtn"),
  deleteThreadBtn: document.querySelector("#deleteThreadBtn"),
  toggleArchivedThreads: document.querySelector("#toggleArchivedThreads"),
  startReviewBtn: document.querySelector("#startReviewBtn"),
  toggleSidePanel: document.querySelector("#toggleSidePanel"),
  diffCountBadge: document.querySelector("#diffCountBadge"),
  taskSidePanel: document.querySelector("#taskSidePanel"),
  sidePanelResizer: document.querySelector("#sidePanelResizer"),
  sideTabReview: document.querySelector("#sideTabReview"),
  sideTabFiles: document.querySelector("#sideTabFiles"),
  sideTabAgents: document.querySelector("#sideTabAgents"),
  closeSidePanel: document.querySelector("#closeSidePanel"),
  sidePanelReview: document.querySelector("#sidePanelReview"),
  diffViewModeBtn: document.querySelector("#diffViewModeBtn"),
  diffViewModeLabel: document.querySelector("#diffViewModeLabel"),
  refreshGitDiffBtn: document.querySelector("#refreshGitDiffBtn"),
  undoPatchBtn: document.querySelector("#undoPatchBtn"),
  reapplyPatchBtn: document.querySelector("#reapplyPatchBtn"),
  diffViewerContainer: document.querySelector("#diffViewerContainer"),
  sidePanelFiles: document.querySelector("#sidePanelFiles"),
  fileTreeUpBtn: document.querySelector("#fileTreeUpBtn"),
  fileTreeRefreshBtn: document.querySelector("#fileTreeRefreshBtn"),
  fileTreeBreadcrumb: document.querySelector("#fileTreeBreadcrumb"),
  fileTreeList: document.querySelector("#fileTreeList"),
  filePreviewContainer: document.querySelector("#filePreviewContainer"),
  sidePanelAgents: document.querySelector("#sidePanelAgents"),
  agentsPanelContent: document.querySelector("#agentsPanelContent"),
  fileMentionMenu: document.querySelector("#fileMentionMenu"),
  toggleTerminalBtn: document.querySelector("#toggleTerminalBtn"),
  openEcosystemBtn: document.querySelector("#openEcosystemBtn"),
  terminalPane: document.querySelector("#terminalPane"),
  terminalTabList: document.querySelector("#terminalTabList"),
  newTerminalTabBtn: document.querySelector("#newTerminalTabBtn"),
  terminalShellSelect: document.querySelector("#terminalShellSelect"),
  clearTerminalBtn: document.querySelector("#clearTerminalBtn"),
  terminalSigintBtn: document.querySelector("#terminalSigintBtn"),
  killTerminalBtn: document.querySelector("#killTerminalBtn"),
  closeTerminalPaneBtn: document.querySelector("#closeTerminalPaneBtn"),
  terminalOutputViewport: document.querySelector("#terminalOutputViewport"),
  terminalInputForm: document.querySelector("#terminalInputForm"),
  terminalStdinInput: document.querySelector("#terminalStdinInput"),
  terminalSendBtn: document.querySelector("#terminalSendBtn"),
  ecosystemModal: document.querySelector("#ecosystemModal"),
  ecosystemModalBackdrop: document.querySelector("#ecosystemModalBackdrop"),
  closeEcosystemModal: document.querySelector("#closeEcosystemModal"),
  ecoTabSkills: document.querySelector("#ecoTabSkills"),
  ecoTabMcp: document.querySelector("#ecoTabMcp"),
  ecoTabPlugins: document.querySelector("#ecoTabPlugins"),
  ecoPanelSkills: document.querySelector("#ecoPanelSkills"),
  ecoSkillSearch: document.querySelector("#ecoSkillSearch"),
  refreshSkillsBtn: document.querySelector("#refreshSkillsBtn"),
  ecoSkillsList: document.querySelector("#ecoSkillsList"),
  ecoPanelMcp: document.querySelector("#ecoPanelMcp"),
  reloadMcpBtn: document.querySelector("#reloadMcpBtn"),
  refreshMcpBtn: document.querySelector("#refreshMcpBtn"),
  ecoMcpList: document.querySelector("#ecoMcpList"),
  ecoPanelPlugins: document.querySelector("#ecoPanelPlugins"),
  refreshPluginsBtn: document.querySelector("#refreshPluginsBtn"),
  ecoPluginsList: document.querySelector("#ecoPluginsList"),
  goalCurrentStatus: document.querySelector("#goalCurrentStatus"),
  goalForm: document.querySelector("#goalForm"),
  goalObjectiveInput: document.querySelector("#goalObjectiveInput"),
  goalBudgetInput: document.querySelector("#goalBudgetInput"),
  saveGoalBtn: document.querySelector("#saveGoalBtn"),
  clearGoalBtn: document.querySelector("#clearGoalBtn"),
  refreshAgentsBtn: document.querySelector("#refreshAgentsBtn"),
  activeAgentsList: document.querySelector("#activeAgentsList"),
  authPanel: document.querySelector("#authPanel"),
  authText: document.querySelector("#authText"),
  deviceLogin: document.querySelector("#deviceLogin"),
  approvalPanel: document.querySelector("#approvalPanel"),
  usageCard: document.querySelector("#usageCard"),
  usagePlan: document.querySelector("#usagePlan"),
  usageWindows: document.querySelector("#usageWindows"),
  usageRefresh: document.querySelector("#usageRefresh"),
  toastRegion: document.querySelector("#toastRegion")
};

const streamingRenderBatcher = createLatestFrameBatcher({
  scheduleFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  render: ({ threadId, itemId, scroll }) => {
    if (state.currentThread?.id !== threadId) return;
    const message = state.messages.find((entry) => entry.id === itemId);
    if (!patchStreamingMessage(message, scroll)) renderMessages(scroll);
  }
});

boot();

async function boot() {
  initI18n();
  window.addEventListener("languagechange", () => window.location.reload());
  const url = new URL(window.location.href);
  const urlToken = tokenFromUrl(url);
  if (urlToken) rememberAccessToken(urlToken);
  state.token = urlToken || storedAccessToken();
  state.urlThreadId = url.searchParams.get(THREAD_URL_PARAM) || "";

  const infoUrl = state.token ? `/api/info?token=${encodeURIComponent(state.token)}` : "/api/info";
  const info = await fetch(infoUrl).then((res) => res.json()).catch(() => null);
  const projectsUrl = state.token ? `/api/projects?token=${encodeURIComponent(state.token)}` : "/api/projects";
  fetch(projectsUrl).then((res) => (res.ok ? res.json() : null)).then((projectsData) => {
    if (projectsData) applyDesktopState(projectsData);
  }).catch(() => {});
  state.authMode = String(info?.authMode || "");
  state.desktopBridgeConnected = null;
  state.threadSettingsAvailable = Boolean(info?.capabilities?.threadSettings);
  state.workspaceBrowserAvailable = Boolean(info?.capabilities?.workspaceBrowser);
  state.threadFilterCwds = scopeCwdsFrom(info);
  if (info?.defaultCwd) {
    els.cwdInput.value = info.defaultCwd;
  }

  setupTheme();
  bindUi();
  applyBridgeModeUi();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCurrentThreadSync();
    else {
      scheduleCurrentThreadSync(0);
      refreshThreadManifestIfDue();
    }
  });
  window.addEventListener("focus", () => {
    scheduleCurrentThreadSync(0);
    refreshThreadManifestIfDue();
  });

  if (!authenticationAccepted(info)) {
    setConnection("connection.missingToken");
    renderEmpty(t("connection.tokenRequiredTitle"), t("connection.tokenRequiredDescription"));
    return;
  }

  connect();
}

function tokenFromHash(hash) {
  const value = String(hash || "");
  const match = /[#&]token=([^&]+)/.exec(value);
  return match ? decodeURIComponent(match[1]) : "";
}

function tokenFromUrl(url) {
  return url.searchParams.get("token") || tokenFromHash(url.hash);
}

function storedAccessToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function rememberAccessToken(token) {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Some private browsing modes can disable localStorage.
  }
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socketUrl = webSocketUrl(window.location, state.token);
  const ws = new WebSocket(socketUrl);
  state.ws = ws;
  let opened = false;
  const startedAt = performance.now();
  console.info("[codex-webui:ws]", {
    event: "connecting",
    url: state.token
      ? `${protocol}//${window.location.host}/ws?token=[redacted]`
      : `${protocol}//${window.location.host}/ws`,
    page: window.location.href
  });
  setConnection("connection.connecting");

  ws.addEventListener("open", () => {
    opened = true;
    state.connected = true;
    console.info("[codex-webui:ws]", {
      event: "open",
      elapsedMs: Math.round(performance.now() - startedAt)
    });
    setConnection("connection.connected");
    initialLoad().finally(() => scheduleCurrentThreadSync(0));
  });

  ws.addEventListener("message", (event) => {
    const raw = typeof event.data === "string" ? event.data : "";
    try {
      handleMessage(JSON.parse(event.data), raw ? byteLengthText(raw) : 0);
    } catch (error) {
      addSystemMessage(error.message || t("connection.parseError"));
    }
  });
  ws.addEventListener("close", () => {
    state.connected = false;
    stopCurrentThreadSync();
    console.warn("[codex-webui:ws]", {
      event: "close",
      opened,
      pendingRequests: state.pending.size,
      elapsedMs: Math.round(performance.now() - startedAt),
      online: navigator.onLine
    });
    rejectPendingRequests(new Error(t("connection.disconnected")));
    if (!opened) {
      if (state.authMode === "cloudflare-access") {
        setConnection("connection.accessSessionInvalid");
        renderEmpty(t("connection.accessSessionInvalidTitle"), t("connection.accessSessionInvalidDescription"));
      } else {
        state.token = null;
        setConnection("connection.invalidToken");
        renderEmpty(t("connection.invalidToken"), t("connection.invalidTokenDescription"));
      }
      return;
    }
    setConnection("connection.reconnecting");
    setTimeout(connect, 3000);
  });
  ws.addEventListener("error", () => {
    console.warn("[codex-webui:ws]", {
      event: "error",
      opened,
      readyState: ws.readyState,
      online: navigator.onLine
    });
    setConnection("connection.error");
  });
}

async function initialLoad() {
  try {
    const results = await Promise.allSettled([
      loadModels(),
      loadConfig(),
      loadPermissionModes(),
      loadAccount(),
      loadThreads(),
      loadRateLimits(),
      loadSkills()
    ]);
    const threadsLoaded = results[4]?.status === "fulfilled";
    for (const result of results) {
      if (result.status === "rejected") addSystemMessage(result.reason?.message || t("error.initialize"));
    }
    applyConfigDefaults();
    if (threadsLoaded) await restoreInitialThread();
  } finally {
    state.initialThreadRestorePending = false;
    els.sendButton.disabled = isSendBlocked();
  }
}

function bindUi() {
  setupImageComposer();
  setupMobileViewport();
  setupBackButtonGuard();
  updateFullscreenToggle();
  initSidebarResizer();
  els.newThread.addEventListener("click", () => {
    createThread();
    if (state.workspaceBrowserAvailable) openWorkspacePicker();
  });
  els.refreshThreads?.addEventListener("click", refreshAll);
  els.lockRetryBtn?.addEventListener("click", () => retryCurrentThreadResume());
  els.lockForkBtn?.addEventListener("click", () => forkCurrentThread());
  els.resumeStatus?.addEventListener("click", async () => {
    try {
      if (state.desktopBridgeConnected === false) {
        await reconnectDesktopBridge();
        return;
      }
      await resumeCurrentThread();
    } catch {
      // resumeCurrentThread already reports the visible error.
    }
  });
  els.searchThreads.addEventListener("input", renderThreads);
  els.openSidebar.addEventListener("click", () => els.sidebar.classList.add("open"));
  els.closeSidebar.addEventListener("click", () => els.sidebar.classList.remove("open"));
  els.deviceLogin.addEventListener("click", startDeviceLogin);
  els.usageRefresh?.addEventListener("click", loadRateLimits);
  els.themeSelect.addEventListener("change", () => setThemePreference(els.themeSelect.value));
  els.fullscreenToggle?.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenToggle);
  document.addEventListener("webkitfullscreenchange", updateFullscreenToggle);
  function onProjectSelectChanged() {
    const proj = getSelectedProject();
    updateProjectInputState(proj);
    if (state.currentThread?.draft) {
      state.currentThread.cwd = proj ? proj.primaryPath : (els.projectSelect.value || preferredScopedCwd());
      state.currentThread.selectedProjectId = proj?.id || null;
      state.currentThread.selectedHostId = proj?.hostId || null;
      loadPermissionModes(state.currentThread.cwd).catch((error) => addSystemMessage(error.message));
      loadSkills(state.currentThread.cwd).catch(() => {});
      updateThreadHeader();
      renderEmpty(
        t("thread.new"),
        proj
          ? (proj.projectKind === "remote"
              ? t("empty.newThreadRemote", { project: `${proj.name} (${proj.hostDisplayName || proj.hostId})` })
              : t("empty.newThreadProject", { project: proj.name }))
          : (state.currentThread.cwd ? t("empty.newThreadProject", { project: projectFromCwd(state.currentThread.cwd).name }) : t("empty.noProject"))
      );
    }
  }
  els.projectSelect.addEventListener("change", onProjectSelectChanged);
  els.projectSelect.addEventListener("input", onProjectSelectChanged);
  els.modelSelect.addEventListener("change", () => {
    updateReasoningOptions("", { useModelDefault: true });
    persistSelectedThreadSettings();
  });
  els.reasoningSelect.addEventListener("change", persistSelectedThreadSettings);
  els.permissionSelect.addEventListener("change", async () => {
    if (
      els.permissionSelect.value === "full-access"
      && !window.confirm(t("permission.fullAccessConfirm"))
    ) {
      applyAuthoritativeThreadSettings();
      return;
    }
    await persistSelectedThreadSettings();
  });
  els.collaborationModeSelect?.addEventListener("change", async () => {
    state.collaborationMode = els.collaborationModeSelect.value;
    els.planModeToggle?.classList.toggle("active", state.collaborationMode === "plan");
    await persistSelectedThreadSettings();
  });
  els.serviceTierSelect?.addEventListener("change", async () => {
    state.serviceTier = els.serviceTierSelect.value;
    await persistSelectedThreadSettings();
  });
  els.planModeToggle?.addEventListener("click", async () => {
    state.collaborationMode = state.collaborationMode === "plan" ? "default" : "plan";
    if (els.collaborationModeSelect) els.collaborationModeSelect.value = state.collaborationMode;
    els.planModeToggle.classList.toggle("active", state.collaborationMode === "plan");
    await persistSelectedThreadSettings();
  });
  els.toggleArchivedThreads?.addEventListener("click", () => {
    state.showArchivedThreads = !state.showArchivedThreads;
    els.toggleArchivedThreads.classList.toggle("active", state.showArchivedThreads);
    loadThreads();
  });
  els.archiveThreadBtn?.addEventListener("click", async () => {
    if (!state.currentThread?.id) return;
    const threadId = state.currentThread.id;
    const isArchived = Boolean(state.currentThread.archived);
    try {
      if (isArchived) {
        await rpc("thread/unarchive", { threadId });
        state.currentThread.archived = false;
        showToast({ kind: "completed", title: t("thread.unarchive") });
      } else {
        await rpc("thread/archive", { threadId });
        state.currentThread.archived = true;
        showToast({ kind: "completed", title: t("thread.archive") });
      }
      updateThreadHeader();
      await loadThreads();
    } catch (err) {
      showToast({ kind: "failed", title: err.message || t("common.failed") });
    }
  });
  els.compactThreadBtn?.addEventListener("click", async () => {
    if (!state.currentThread?.id) return;
    try {
      await rpc("thread/compact/start", { threadId: state.currentThread.id });
      showToast({ kind: "completed", title: t("thread.compact") });
    } catch (err) {
      showToast({ kind: "failed", title: err.message || t("common.failed") });
    }
  });
  // Terminal Pane Listeners
  els.toggleTerminalBtn?.addEventListener("click", () => toggleTerminalPane());
  els.closeTerminalPaneBtn?.addEventListener("click", () => toggleTerminalPane(false));
  els.newTerminalTabBtn?.addEventListener("click", () => createNewTerminalTab());
  els.clearTerminalBtn?.addEventListener("click", () => clearCurrentTerminal());
  els.terminalSigintBtn?.addEventListener("click", () => sendTerminalSigint());
  els.killTerminalBtn?.addEventListener("click", () => killTerminalProcess());
  els.terminalInputForm?.addEventListener("submit", (e) => sendTerminalInput(e));

  // Ecosystem Modal Listeners
  els.openEcosystemBtn?.addEventListener("click", () => toggleEcosystemModal(true));
  els.closeEcosystemModal?.addEventListener("click", () => toggleEcosystemModal(false));
  els.ecosystemModalBackdrop?.addEventListener("click", () => toggleEcosystemModal(false));
  els.ecoTabSkills?.addEventListener("click", () => switchEcoTab("skills"));
  els.ecoTabMcp?.addEventListener("click", () => switchEcoTab("mcp"));
  els.ecoTabPlugins?.addEventListener("click", () => switchEcoTab("plugins"));
  els.ecoSkillSearch?.addEventListener("input", () => renderEcosystemSkills());
  els.refreshSkillsBtn?.addEventListener("click", () => loadEcosystemSkills());
  els.reloadMcpBtn?.addEventListener("click", () => reloadAllMcpServers());
  els.refreshMcpBtn?.addEventListener("click", () => loadEcosystemMcp());
  els.refreshPluginsBtn?.addEventListener("click", () => loadEcosystemPlugins());

  // Side Panel Goal Listeners
  els.goalForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveThreadGoal();
  });
  els.clearGoalBtn?.addEventListener("click", () => clearThreadGoal());
  els.refreshAgentsBtn?.addEventListener("click", () => loadActiveSubagents());

  els.toggleSidePanel?.addEventListener("click", () => toggleSidePanel());
  els.closeSidePanel?.addEventListener("click", () => toggleSidePanel(false));
  els.sideTabReview?.addEventListener("click", () => switchSideTab("review"));
  els.sideTabFiles?.addEventListener("click", () => switchSideTab("files"));
  els.sideTabAgents?.addEventListener("click", () => switchSideTab("agents"));
  els.startReviewBtn?.addEventListener("click", startCodeReview);
  els.diffViewModeBtn?.addEventListener("click", () => {
    state.diffViewMode = state.diffViewMode === "unified" ? "split" : "unified";
    if (els.diffViewModeLabel) {
      els.diffViewModeLabel.textContent = t(state.diffViewMode === "unified" ? "diff.viewUnified" : "diff.viewSplit");
    }
    renderDiffViewer(state.currentDiff);
  });
  els.refreshGitDiffBtn?.addEventListener("click", refreshGitDiff);
  els.undoPatchBtn?.addEventListener("click", undoGitPatch);
  els.reapplyPatchBtn?.addEventListener("click", reapplyGitPatch);
  els.fileTreeUpBtn?.addEventListener("click", () => {
    if (!state.currentFileTreePath) return;
    const parts = state.currentFileTreePath.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      loadFileDirectory(parts.join("/"));
    }
  });
  els.fileTreeRefreshBtn?.addEventListener("click", () => {
    loadFileDirectory(state.currentFileTreePath);
  });
  setupSidePanelResizer();

  els.promptInput?.addEventListener("input", handlePromptInputMention);
  els.promptInput?.addEventListener("keydown", (event) => {
    if (els.fileMentionMenu && !els.fileMentionMenu.classList.contains("hidden") && state.fileMentionItems.length) {
      if (event.key === "ArrowDown") {
        state.fileMentionSelectedIndex = (state.fileMentionSelectedIndex + 1) % Math.min(state.fileMentionItems.length, 8);
        renderFileMentionMenu();
        event.preventDefault();
      } else if (event.key === "ArrowUp") {
        state.fileMentionSelectedIndex = (state.fileMentionSelectedIndex - 1 + Math.min(state.fileMentionItems.length, 8)) % Math.min(state.fileMentionItems.length, 8);
        renderFileMentionMenu();
        event.preventDefault();
      } else if (event.key === "Enter" || event.key === "Tab") {
        const item = state.fileMentionItems[state.fileMentionSelectedIndex];
        if (item) {
          applyFileMention(item.path || item.name || "");
          event.preventDefault();
        }
      } else if (event.key === "Escape") {
        els.fileMentionMenu.classList.add("hidden");
        state.fileMentionTrigger = null;
      }
    }
  });

  els.deleteThreadBtn?.addEventListener("click", async () => {
    if (!state.currentThread?.id) return;
    if (!window.confirm(t("thread.deleteConfirm"))) return;
    const threadId = state.currentThread.id;
    try {
      await rpc("thread/delete", { threadId });
      showToast({ kind: "completed", title: t("thread.delete") });
      state.currentThread = null;
      updateThreadHeader();
      await loadThreads();
    } catch (err) {
      showToast({ kind: "failed", title: err.message || t("common.failed") });
    }
  });
  els.browseWorkspace.addEventListener("click", openWorkspacePicker);
  els.workspacePickerBackdrop.addEventListener("click", closeWorkspacePicker);
  els.workspacePickerClose.addEventListener("click", closeWorkspacePicker);
  els.workspaceRoots.addEventListener("click", () => loadWorkspaceDirectory(""));
  els.workspaceParent.addEventListener("click", () => {
    const parent = els.workspaceParent.dataset.path || "";
    loadWorkspaceDirectory(parent);
  });
  els.workspaceUseCurrent.addEventListener("click", useCurrentWorkspace);
  els.workspaceCreateForm.addEventListener("submit", createAndUseWorkspace);
  els.messages.addEventListener("scroll", () => {
    state.followLiveOutput = liveFollowState({
      current: state.followLiveOutput,
      userReading: false,
      nearBottom: isMessagesNearBottom(40)
    });
    if (shouldAutoLoadOlderTurns({
      armed: state.historyAutoLoadArmed,
      scrollTop: els.messages.scrollTop,
      hasCursor: Boolean(state.turnCursor),
      loading: state.loadingOlderTurns
    })) {
      loadOlderTurns();
    }
  });
  els.messages.addEventListener("wheel", (event) => {
    if (event.deltaY < 0) {
      state.historyAutoLoadArmed = true;
      state.followLiveOutput = liveFollowState({ current: state.followLiveOutput, userReading: true, nearBottom: false });
    }
  }, { passive: true });
  els.messages.addEventListener("touchstart", () => {
    state.historyAutoLoadArmed = true;
    state.followLiveOutput = liveFollowState({ current: state.followLiveOutput, userReading: true, nearBottom: false });
  }, { passive: true });
  els.messages.addEventListener("pointerdown", () => {
    state.historyAutoLoadArmed = true;
    state.followLiveOutput = liveFollowState({ current: state.followLiveOutput, userReading: true, nearBottom: false });
  }, { passive: true });
  els.messages.addEventListener("keydown", (event) => {
    if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
      state.historyAutoLoadArmed = true;
      state.followLiveOutput = liveFollowState({ current: state.followLiveOutput, userReading: true, nearBottom: false });
    }
  });

  els.threadTitle.addEventListener("focus", () => {
    threadTitleBeforeEdit = els.threadTitle.value;
    stopThreadTitleMarquee(true);
  });
  els.threadTitle.addEventListener("keydown", async (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      await commitThreadTitle();
      els.threadTitle.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelThreadTitleEdit();
      els.threadTitle.blur();
    }
  });
  els.threadTitle.addEventListener("blur", async () => {
    await commitThreadTitle();
    scrollThreadTitleToEnd();
  });
  window.addEventListener("resize", scrollThreadTitleToEnd);

  els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.desktopBridgeConnected !== true) {
      addSystemMessage(t("error.desktopBridgeOffline"));
      return;
    }
    const threadId = state.currentThread?.id;
    if (threadId && state.activeTurns.has(threadId)) {
      setFollowUpMenuOpen(true);
      return;
    }
    const text = els.promptInput.value.trim();
    if (!text && !state.pendingImages.length && !state.pendingSkills.length) return;
    try {
      await sendTurn(text);
    } catch (error) {
      if (!isLockConflictError(error)) {
        addSystemMessage(error.message || t("error.send"));
      }
    }
  });

  els.followUpMenu?.addEventListener("click", async (event) => {
    const option = event.target.closest("[data-follow-up-mode]");
    if (!option) return;
    if (state.desktopBridgeConnected !== true) {
      addSystemMessage(t("error.desktopBridgeOffline"));
      return;
    }
    const mode = option.dataset.followUpMode;
    if (mode === "stop") {
      setFollowUpMenuOpen(false);
      await interruptActiveTurn();
      return;
    }
    const text = els.promptInput.value.trim();
    if (!text && !state.pendingImages.length && !state.pendingSkills.length) return;
    const queue = mode === "queue";
    const expectedActiveTurnId = state.activeTurns.get(state.currentThread?.id) || null;
    setFollowUpMenuOpen(false);
    try {
      await sendTurn(text, { queue, expectedActiveTurnId });
    } catch (error) {
      if (!isLockConflictError(error)) {
        addSystemMessage(error.message || t("error.send"));
      }
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (els.skillMenu && !els.skillMenu.classList.contains("hidden")) {
      if (!els.skillMenu.contains(event.target) && event.target !== els.promptInput) {
        closeSkillMenu();
      }
    }
    if (els.followUpMenu?.classList.contains("hidden")) return;
    if (els.followUpMenu.contains(event.target) || els.sendButton.contains(event.target)) return;
    setFollowUpMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setFollowUpMenuOpen(false);
      closeSkillMenu();
    }
  });

  els.promptInput.addEventListener("input", () => {
    syncPendingSkillsWithPrompt();
    resizePromptInput();
    updateFollowUpOptions();
    updateSkillMenu();
  });
  els.promptInput.addEventListener("click", () => {
    updateSkillMenu();
  });
  els.promptInput.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (state.skillMenuOpen && state.skillMenuItems.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        state.skillMenuIndex = (state.skillMenuIndex + 1) % state.skillMenuItems.length;
        renderSkillMenuItems();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        state.skillMenuIndex = (state.skillMenuIndex - 1 + state.skillMenuItems.length) % state.skillMenuItems.length;
        renderSkillMenuItems();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = state.skillMenuItems[state.skillMenuIndex];
        if (selected) applySkillSelection(selected);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeSkillMenu();
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitComposer();
  });
  els.promptInput.addEventListener("paste", async (event) => {
    const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    await addImages(files);
  });
  els.composer.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.composer.classList.add("dragging");
  });
  els.composer.addEventListener("dragleave", () => {
    els.composer.classList.remove("dragging");
  });
  els.composer.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.composer.classList.remove("dragging");
    await addImages([...(event.dataTransfer?.files || [])]);
  });
  els.imageViewerBackdrop?.addEventListener("click", closeImageViewer);
  els.imageViewerClose?.addEventListener("click", closeImageViewer);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeImageViewer();
  });
}

async function toggleFullscreen() {
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  try {
    if (fullscreenElement) {
      await exitFullscreen();
    } else {
      const target = document.documentElement;
      if (target.requestFullscreen) {
        try {
          await target.requestFullscreen({ navigationUI: "hide" });
        } catch (error) {
          if (error instanceof TypeError) await target.requestFullscreen();
          else throw error;
        }
      } else if (target.webkitRequestFullscreen) {
        await target.webkitRequestFullscreen();
      }
    }
  } catch (error) {
    addSystemMessage(error.message || t("fullscreen.error"));
  } finally {
    updateFullscreenToggle();
  }
}

function updateFullscreenToggle() {
  if (!els.fullscreenToggle) return;
  const canFullscreen = Boolean(
    document.fullscreenEnabled
    || document.webkitFullscreenEnabled
    || document.documentElement.requestFullscreen
    || document.documentElement.webkitRequestFullscreen
  );
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  document.documentElement.classList.toggle("fullscreen-active", Boolean(fullscreenElement));
  els.fullscreenToggle.disabled = !canFullscreen;
  els.fullscreenToggle.classList.toggle("active", Boolean(fullscreenElement));
  els.fullscreenToggle.title = t(fullscreenElement ? "fullscreen.exit" : "fullscreen.enter");
  els.fullscreenToggle.setAttribute("aria-label", t(fullscreenElement ? "fullscreen.exit" : "fullscreen.enter"));
}

function setupMobileViewport() {
  let largestVisualHeight = window.visualViewport?.height || window.innerHeight;
  let largestInnerHeight = window.innerHeight;
  let lastViewportLog = "";
  let pendingBottomDistance = null;

  const captureBottomDistance = () => {
    if (!els.messages || pendingBottomDistance !== null) return;
    pendingBottomDistance = Math.max(
      0,
      els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight
    );
  };

  const restoreBottomDistance = () => {
    if (!els.messages || pendingBottomDistance === null) return;
    const distance = pendingBottomDistance;
    pendingBottomDistance = null;
    const maxScrollTop = Math.max(0, els.messages.scrollHeight - els.messages.clientHeight);
    els.messages.scrollTop = Math.max(0, maxScrollTop - distance);
  };

  const syncViewport = () => {
    const viewport = window.visualViewport;
    const visualHeight = viewport?.height || window.innerHeight;
    const visualOffsetTop = viewport?.offsetTop || 0;
    const visualBottom = visualOffsetTop + visualHeight;
    const promptFocused = document.activeElement === els.promptInput;
    if (!promptFocused) {
      largestVisualHeight = Math.max(largestVisualHeight, visualHeight);
      largestInnerHeight = Math.max(largestInnerHeight, window.innerHeight);
    }
    const layoutViewportResized = promptFocused && largestInnerHeight - window.innerHeight > 80;
    const viewportBottom = layoutViewportResized ? window.innerHeight : visualBottom;
    const inferredKeyboardInset = Math.max(0, window.innerHeight - viewportBottom);

    updateMobileChromeMetrics();
    document.documentElement.style.setProperty("--visual-viewport-height", `${viewportBottom}px`);
    document.documentElement.style.setProperty("--visual-viewport-offset-top", `${visualOffsetTop}px`);
    document.documentElement.style.setProperty("--keyboard-inset", `${inferredKeyboardInset}px`);

    const composerBottom = els.composer?.getBoundingClientRect().bottom || viewportBottom;
    const fixedBottomAtZero = composerBottom + inferredKeyboardInset;
    const keyboardInset = Math.max(0, Math.round(fixedBottomAtZero - viewportBottom));
    const keyboardOpen = promptFocused
      && (layoutViewportResized || largestVisualHeight - visualHeight > 80 || inferredKeyboardInset > 80);
    document.documentElement.style.setProperty("--keyboard-inset", `${keyboardInset}px`);
    document.documentElement.classList.toggle("keyboard-open", keyboardOpen);

    const viewportLog = [
      Math.round(window.innerHeight),
      Math.round(visualHeight),
      Math.round(visualOffsetTop),
      keyboardInset,
      keyboardOpen
    ].join(":");
    if (viewportLog !== lastViewportLog) {
      lastViewportLog = viewportLog;
      console.debug("[codex-webui:viewport]", {
        innerHeight: Math.round(window.innerHeight),
        visualHeight: Math.round(visualHeight),
        visualOffsetTop: Math.round(visualOffsetTop),
        visualBottom: Math.round(visualBottom),
        viewportBottom: Math.round(viewportBottom),
        layoutViewportResized,
        inferredKeyboardInset: Math.round(inferredKeyboardInset),
        keyboardInset,
        keyboardOpen
      });
    }
  };

  let frame = 0;
  const scheduleSync = () => {
    captureBottomDistance();
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      syncViewport();
      restoreBottomDistance();
    });
  };

  syncViewport();
  const resizeObserver = window.ResizeObserver
    ? new ResizeObserver(scheduleSync)
    : null;
  resizeObserver?.observe(els.composer);
  resizeObserver?.observe(els.chatPane.querySelector(".topbar"));
  window.addEventListener("resize", scheduleSync);
  window.addEventListener("orientationchange", scheduleSync);
  window.visualViewport?.addEventListener("resize", scheduleSync);
  window.visualViewport?.addEventListener("scroll", scheduleSync);
  els.promptInput.addEventListener("focus", () => {
    document.documentElement.classList.add("input-focused");
    scheduleSync();
    window.setTimeout(scheduleSync, 120);
    window.setTimeout(scheduleSync, 360);
  });
  els.promptInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      document.documentElement.classList.remove("input-focused");
      scheduleSync();
    }, 120);
    window.setTimeout(scheduleSync, 360);
  });
}

function updateMobileChromeMetrics() {
  const topbarHeight = Math.ceil(els.chatPane?.querySelector(".topbar")?.getBoundingClientRect().height || 78);
  const composerHeight = Math.ceil(els.composer?.getBoundingClientRect().height || 70);
  const target = els.chatPane || document.documentElement;
  target.style.setProperty("--mobile-topbar-height", `${topbarHeight}px`);
  target.style.setProperty("--mobile-composer-height", `${composerHeight}px`);
}

function setupTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) || "system";
  els.themeSelect.value = ["system", "light", "dark"].includes(saved) ? saved : "system";
  applyThemePreference(els.themeSelect.value);
}

function setThemePreference(value) {
  const next = ["system", "light", "dark"].includes(value) ? value : "system";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyThemePreference(next);
}

function applyThemePreference(value) {
  if (value === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = value;
  }
}

function setupBackButtonGuard() {
  if (!window.history?.pushState || window.__codexWebUIBackGuard) return;
  window.__codexWebUIBackGuard = true;
  setupBackSentinel();
  backGuardBaseUrl = cleanBackGuardUrl(window.location.href);
  window.history.replaceState({ ...(window.history.state || {}), codexWebUIPage: true }, "", backGuardBaseUrl);
  armBackButtonGuard();
  window.addEventListener("popstate", handleBackNavigation);
  window.addEventListener("hashchange", handleBackNavigation);
  window.addEventListener("pointerdown", armBackButtonGuardFromUserGesture, { capture: true, passive: true });
  window.addEventListener("touchstart", armBackButtonGuardFromUserGesture, { capture: true, passive: true });
  window.addEventListener("keydown", armBackButtonGuardFromUserGesture, { capture: true });
}

function setupBackSentinel() {
  if (!HTMLElement.prototype.showPopover || backSentinels.length) return;
  backSentinels = Array.from({ length: BACK_SENTINEL_COUNT }, () => {
    const sentinel = document.createElement("div");
    sentinel.className = "back-sentinel";
    sentinel.popover = "manual";
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.addEventListener("beforetoggle", (event) => {
      if (event.newState !== "closed" || backSentinelReopening) return;
      if (event.cancelable) event.preventDefault();
      handleBackButton();
      window.setTimeout(openBackSentinels, 0);
    });
    sentinel.addEventListener("toggle", (event) => {
      if (event.newState !== "closed" || backSentinelReopening) return;
      handleBackButton();
      window.setTimeout(openBackSentinels, 0);
    });
    document.body.append(sentinel);
    return sentinel;
  });
  openBackSentinels();
}

function openBackSentinels() {
  if (!backSentinels.length) return;
  try {
    backSentinelReopening = true;
    for (const sentinel of backSentinels) {
      if (!sentinel.matches(":popover-open")) sentinel.showPopover();
    }
  } catch {
    // Older browsers may expose partial Popover API support.
  } finally {
    backSentinelReopening = false;
  }
}

function handleBackNavigation() {
  if (backGuardHandling) return;
  backGuardHandling = true;
  handleBackButton();
  window.setTimeout(() => {
    armBackButtonGuard();
    backGuardHandling = false;
  }, 0);
}

function armBackButtonGuardFromUserGesture() {
  const now = Date.now();
  if (now - backGuardArmedAt < 1200) return;
  armBackButtonGuard();
}

function armBackButtonGuard() {
  if (!backGuardBaseUrl) backGuardBaseUrl = cleanBackGuardUrl(window.location.href);
  backGuardArmedAt = Date.now();
  pushBackGuardState();
  pushBackGuardState();
}

function cleanBackGuardUrl(url) {
  const next = new URL(url);
  if (next.hash.startsWith(`#${BACK_GUARD_HASH_PREFIX}`)) {
    next.hash = "";
  }
  return next.toString();
}

function pushBackGuardState() {
  const url = new URL(backGuardBaseUrl || window.location.href);
  backGuardSerial += 1;
  url.hash = `${BACK_GUARD_HASH_PREFIX}${backGuardSerial}`;
  window.history.pushState({ codexWebUIGuard: true, serial: backGuardSerial }, "", url.toString());
}

function handleBackButton() {
  if (closeImageViewer()) return;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    exitFullscreen();
    return;
  }
  if (els.sidebar?.classList.contains("open")) {
    els.sidebar.classList.remove("open");
    return;
  }
  if (els.setupBand?.classList.contains("open")) {
    setSetupBandOpen(false);
    return;
  }
  if (document.activeElement === els.promptInput) {
    els.promptInput.blur();
  }
}

async function exitFullscreen() {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
  } catch (error) {
    addSystemMessage(error.message || t("fullscreen.exitError"));
  } finally {
    updateFullscreenToggle();
  }
}

function setSetupBandOpen(open) {
  els.setupBand?.classList.toggle("open", open);
  els.settingsToggle?.classList.toggle("active", open);
  els.settingsToggle?.setAttribute("aria-expanded", String(open));
  els.settingsToggle?.setAttribute("aria-label", t(open ? "settings.collapse" : "settings.expand"));
}

async function refreshAll() {
  const currentThread = state.currentThread;
  const currentId = currentThread?.id;
  state.lastLoadStats = null;
  state.threadLoadStats = null;
  updateTrafficSummary();
  if (currentId) {
    const loadSeq = ++state.threadLoadSeq;
    state.loadingThreadId = currentId;
    state.currentThread = currentThread;
    state.messages = [];
    resetTurnPaging();
    els.sendButton.disabled = true;
    updateThreadHeader();
    renderThreadLoading(currentThread, createThreadLoadStats(currentId, currentThread, loadSeq));
    renderThreads();
  }
  await Promise.all([loadConfig(), loadThreads(), loadRateLimits()]);
  applyConfigDefaults();
  if (currentId) {
    const thread = state.threads.find((entry) => entry.id === currentId) || currentId;
    await openThread(thread);
  }
}

function setupImageComposer() {
  const settingsButton = document.createElement("button");
  settingsButton.className = "settings-toggle";
  settingsButton.type = "button";
  settingsButton.innerHTML = settingsIcon();
  settingsButton.title = t("settings.panel");
  settingsButton.setAttribute("aria-label", t("settings.expand"));
  settingsButton.setAttribute("aria-expanded", "false");

  const attachButton = document.createElement("label");
  attachButton.className = "attach-button";
  attachButton.textContent = "+";
  attachButton.title = t("image.add");

  const imageInput = document.createElement("input");
  imageInput.id = "imageInput";
  imageInput.type = "file";
  imageInput.accept = "image/*";
  imageInput.multiple = true;
  imageInput.hidden = true;
  attachButton.htmlFor = imageInput.id;

  const tray = document.createElement("div");
  tray.className = "image-tray hidden";

  const targetToolbar = document.querySelector("#composerToolbar") || els.composerToolbar || els.composerMetaRow || els.composer;
  targetToolbar.append(settingsButton, attachButton, imageInput);
  if (els.composerInputRow && els.composerInputRow.parentNode === els.composer) {
    els.composer.insertBefore(tray, els.composerInputRow);
  } else if (els.promptInput && els.promptInput.parentNode === els.composer) {
    els.composer.insertBefore(tray, els.promptInput);
  } else {
    els.composer.appendChild(tray);
  }
  els.settingsToggle = settingsButton;
  els.imageInput = imageInput;
  els.imageTray = tray;

  settingsButton.addEventListener("click", () => {
    setSetupBandOpen(!els.setupBand.classList.contains("open"));
  });

  imageInput.addEventListener("change", async () => {
    const files = [...imageInput.files];
    await addImages(files);
    imageInput.value = "";
  });
}

async function addImages(files) {
  const imageFiles = files.filter(isImageFile);
  if (!imageFiles.length && files.length) {
    addSystemMessage(t("image.noneFound"));
  }
  const uploads = imageFiles.map((file) => {
    const previewUrl = URL.createObjectURL(file);
    const item = {
      id: createClientId(),
      name: file.name,
      previewUrl,
      status: "preparing",
      originalSize: file.size,
      uploadSize: file.size,
      path: null
    };
    state.pendingImages.push(item);
    item.readyPromise = (async () => {
      try {
        const upload = await prepareImageForUpload(file);
        item.uploadSize = upload.size;
        item.compressed = upload.compressed;
        item.detail = imageUploadDetail(file, upload);
        item.status = "uploading";
        renderImageTray();

        const result = await uploadImage(upload, (progress) => {
          item.progress = progress;
          renderImageTray();
        });
        item.path = result.path;
        item.status = "ready";
      } catch (error) {
        item.status = "failed";
        item.error = error.message;
      }
      renderImageTray();
    })();
    return item.readyPromise;
  });

  renderImageTray();
  await Promise.allSettled(uploads);
}

function uploadImage(upload, onProgress = null) {
  const blob = upload.blob || upload;
  const uploadName = upload.name || blob.name || "image";
  const contentType = upload.type || imageMimeForFile(blob) || "application/octet-stream";
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", authenticatedUrl("/api/upload-image", state.token));
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-file-name", encodeURIComponent(uploadName));
    xhr.timeout = 90000;
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener("load", () => {
      const result = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(result);
      } else {
        reject(new Error(result?.error || `Image upload failed (${xhr.status})`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error(t("image.networkError"))));
    xhr.addEventListener("timeout", () => reject(new Error(t("image.timeout"))));
    xhr.send(blob);
  });
}

async function prepareImageForUpload(file) {
  const original = originalImageUpload(file);
  if (!canCompressImage(file)) return original;

  try {
    const image = await withTimeout(loadImageElement(file), 10000, "Image decode timed out");
    const scale = Math.min(
      1,
      IMAGE_UPLOAD_MAX_EDGE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1),
      Math.sqrt(IMAGE_UPLOAD_MAX_PIXELS / Math.max(1, (image.naturalWidth || 1) * (image.naturalHeight || 1)))
    );

    if (scale >= 1 && file.size <= IMAGE_UPLOAD_TARGET_BYTES) {
      return original;
    }

    const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
    const blob = await withTimeout(drawImageToJpegBlob(image, width, height), 12000, "Image compression timed out");
    if (!blob || (blob.size >= file.size && scale >= 1)) return original;

    return {
      blob,
      name: fileNameWithExtension(file.name, "jpg"),
      type: blob.type || "image/jpeg",
      size: blob.size,
      originalSize: file.size,
      compressed: blob.size < file.size || scale < 1
    };
  } catch {
    return original;
  }
}

function originalImageUpload(file) {
  return {
    blob: file,
    name: file.name || "image",
    type: imageMimeForFile(file) || file.type || "application/octet-stream",
    size: file.size || 0,
    originalSize: file.size || 0,
    compressed: false
  };
}

function canCompressImage(file) {
  const mime = imageMimeForFile(file);
  return mime.startsWith("image/") && mime !== "image/gif" && mime !== "image/svg+xml";
}

function loadImageElement(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("image.decodeFailed")));
    };
    img.src = url;
  });
}

function withTimeout(promise, ms, message) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

async function drawImageToJpegBlob(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return null;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  let best = null;
  for (const quality of IMAGE_UPLOAD_JPEG_QUALITIES) {
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (!blob) continue;
    best = blob;
    if (blob.size <= IMAGE_UPLOAD_TARGET_BYTES) break;
  }
  return best;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (!canvas.toBlob) {
      resolve(null);
      return;
    }
    canvas.toBlob(resolve, type, quality);
  });
}

function fileNameWithExtension(name, extension) {
  const fallback = "image";
  const base = String(name || fallback).replace(/\.[^./\\]+$/, "") || fallback;
  return `${base}.${extension}`;
}

function imageUploadDetail(original, upload) {
  if (!upload.compressed) return `${original.name || t("image.defaultName")} · ${formatBytes(upload.size)}`;
  return `${original.name || t("image.defaultName")} · ${formatBytes(original.size)} -> ${formatBytes(upload.size)}`;
}

function parseJson(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

function createClientId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const random = window.crypto?.getRandomValues
    ? Array.from(window.crypto.getRandomValues(new Uint32Array(2)), (value) => value.toString(36)).join("")
    : Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}`;
}

function isImageFile(file) {
  return Boolean(imageMimeForFile(file));
}

function imageMimeForFile(file) {
  const type = String(file?.type || "").toLowerCase();
  if (type.startsWith("image/")) return type;
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return "";
}

function renderImageTray() {
  if (!els.imageTray) return;
  els.imageTray.innerHTML = "";
  const hasTray = Boolean(state.pendingImages.length || state.pendingSkills.length);
  els.imageTray.classList.toggle("hidden", !hasTray);
  els.composer?.classList.toggle("has-image-tray", hasTray);

  for (const skill of state.pendingSkills) {
    const chip = document.createElement("div");
    chip.className = "skill-chip";
    chip.title = skill.description || skill.displayName || skill.name;
    chip.innerHTML = `
      <span>${escapeHtml(skill.name)}</span>
      <button type="button" aria-label="${escapeHtml(t("skill.remove"))}">×</button>
    `;
    chip.querySelector("button").addEventListener("click", () => {
      removePendingSkill(skill.name);
    });
    els.imageTray.append(chip);
  }

  for (const image of state.pendingImages) {
    const item = document.createElement("div");
    item.className = `image-chip ${image.status}`;
    const label = imageTrayLabel(image);
    if (image.detail) item.title = image.detail;
    item.innerHTML = `
      <img src="${image.previewUrl}" alt="">
      <span>${escapeHtml(label)}</span>
      <button type="button" aria-label="${escapeHtml(t("image.remove"))}">×</button>
    `;
    item.querySelector("button").addEventListener("click", () => {
      URL.revokeObjectURL(image.previewUrl);
      state.pendingImages = state.pendingImages.filter((entry) => entry.id !== image.id);
      renderImageTray();
    });
    els.imageTray.append(item);
  }
  updateFollowUpOptions();
  updateMobileChromeMetrics();
}

function imageTrayLabel(image) {
  if (image.status === "preparing") return t("image.preparing");
  if (image.status === "uploading") return t("image.uploading", { progress: image.progress ? ` ${image.progress}%` : "" });
  if (image.status === "failed") return image.error || t("image.failed");
  if (image.compressed) return `${formatBytes(image.originalSize)} -> ${formatBytes(image.uploadSize)}`;
  return image.name;
}

function revokeImagePreviews(images) {
  for (const image of images || []) {
    if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
  }
}

function currentEffectiveCwd() {
  return String(
    state.currentThread?.cwd
    || getSelectedCwd()
    || els.cwdInput?.value
    || ""
  ).trim();
}

async function loadSkills(cwd = currentEffectiveCwd(), { forceReload = false } = {}) {
  const normalizedCwd = String(cwd || "").trim();
  const params = {};
  if (normalizedCwd) params.cwds = [normalizedCwd];
  if (forceReload) params.forceReload = true;
  const result = await rpc("skills/list", params);
  const entries = Array.isArray(result?.data) ? result.data : [];
  const byName = new Map();
  for (const entry of entries) {
    for (const skill of entry?.skills || []) {
      if (!skill?.name || skill.enabled === false) continue;
      if (!byName.has(skill.name)) {
        byName.set(skill.name, skill);
      }
    }
  }
  const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  state.skills = list;
  if (normalizedCwd) state.skillsByCwd.set(normalizedCwd, list);
  if (state.skillMenuOpen) updateSkillMenu();
  return list;
}

function detectSkillTrigger(textarea) {
  if (!textarea) return null;
  const value = String(textarea.value || "");
  const caret = typeof textarea.selectionStart === "number" ? textarea.selectionStart : value.length;
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|\s)([$/])([a-zA-Z0-9_.:-]*)$/.exec(beforeCaret);
  if (!match) return null;
  const prefix = match[1];
  const query = match[2] || "";
  const tokenLength = 1 + query.length;
  const start = caret - tokenLength;
  return { prefix, query, start, end: caret };
}

function matchSkillsByQuery(query) {
  const q = String(query || "").trim().toLowerCase();
  const skills = state.skills || [];
  if (!q) return skills.slice(0, 30);
  return skills
    .map((skill) => {
      const name = String(skill.name || "").toLowerCase();
      const displayName = String(skill.interface?.displayName || "").toLowerCase();
      const shortDesc = String(skill.interface?.shortDescription || skill.shortDescription || "").toLowerCase();
      const desc = String(skill.description || "").toLowerCase();
      let score = 0;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (displayName.startsWith(q)) score = 70;
      else if (name.includes(q)) score = 60;
      else if (displayName.includes(q)) score = 50;
      else if (shortDesc.includes(q) || desc.includes(q)) score = 30;
      return { skill, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, 20)
    .map((entry) => entry.skill);
}

function updateSkillMenu() {
  if (!els.skillMenu) return;
  const trigger = detectSkillTrigger(els.promptInput);
  if (!trigger || !state.skills.length) {
    closeSkillMenu();
    return;
  }
  const matches = matchSkillsByQuery(trigger.query);
  if (!matches.length) {
    closeSkillMenu();
    return;
  }
  state.skillTrigger = trigger;
  state.skillMenuItems = matches;
  if (state.skillMenuIndex >= matches.length || state.skillMenuIndex < 0) {
    state.skillMenuIndex = 0;
  }
  state.skillMenuOpen = true;
  els.skillMenu.classList.remove("hidden");
  renderSkillMenuItems();
}

function renderSkillMenuItems() {
  if (!els.skillMenu) return;
  els.skillMenu.innerHTML = "";
  state.skillMenuItems.forEach((skill, idx) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "option";
    button.className = `skill-option${idx === state.skillMenuIndex ? " active" : ""}`;
    button.setAttribute("aria-selected", String(idx === state.skillMenuIndex));
    const displayName = skill.interface?.displayName || "";
    const desc = skill.interface?.shortDescription || skill.shortDescription || skill.description || "";
    const scopeKey = `skill.scope.${skill.scope || "user"}`;
    const scopeLabel = t(scopeKey);
    button.innerHTML = `
      <div class="skill-option-head">
        <div class="skill-option-title">
          <span class="skill-option-name">${escapeHtml(skill.name)}</span>
          ${displayName && displayName.toLowerCase() !== skill.name.toLowerCase() ? `<span class="skill-option-display">${escapeHtml(displayName)}</span>` : ""}
        </div>
        ${scopeLabel && scopeLabel !== scopeKey ? `<span class="skill-option-badge">${escapeHtml(scopeLabel)}</span>` : ""}
      </div>
      ${desc ? `<div class="skill-option-desc">${escapeHtml(desc)}</div>` : ""}
    `;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      applySkillSelection(skill);
    });
    els.skillMenu.append(button);
  });
  const activeEl = els.skillMenu.querySelector(".skill-option.active");
  activeEl?.scrollIntoView({ block: "nearest" });
}

function closeSkillMenu() {
  state.skillMenuOpen = false;
  state.skillMenuItems = [];
  state.skillMenuIndex = 0;
  state.skillTrigger = null;
  els.skillMenu?.classList.add("hidden");
}

function applySkillSelection(skill) {
  if (!skill?.name || !els.promptInput) return;
  const trigger = state.skillTrigger || detectSkillTrigger(els.promptInput);
  const value = String(els.promptInput.value || "");
  const tokenText = `${skill.name} `;
  let nextCursor = tokenText.length;
  if (trigger) {
    const before = value.slice(0, trigger.start);
    const after = value.slice(trigger.end).replace(/^\s+/, "");
    els.promptInput.value = `${before}${tokenText}${after}`;
    nextCursor = before.length + tokenText.length;
  } else {
    const prefix = value && !/\s$/.test(value) ? `${value} ` : value;
    els.promptInput.value = `${prefix}${tokenText}`;
    nextCursor = els.promptInput.value.length;
  }
  if (!state.pendingSkills.some((item) => item.name === skill.name)) {
    state.pendingSkills.push({
      name: skill.name,
      path: skill.path || "",
      displayName: skill.interface?.displayName || skill.name,
      description: skill.interface?.shortDescription || skill.shortDescription || skill.description || ""
    });
  }
  closeSkillMenu();
  els.promptInput.focus();
  els.promptInput.setSelectionRange(nextCursor, nextCursor);
  resizePromptInput();
  renderImageTray();
  updateFollowUpOptions();
}

function removePendingSkill(skillName) {
  state.pendingSkills = state.pendingSkills.filter((item) => item.name !== skillName);
  if (els.promptInput) {
    const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, "\\async function loadModels() {");
    const regex = new RegExp(`(?:^|\\s)\\${escaped}(?=\\s|$)`, "g");
    els.promptInput.value = els.promptInput.value.replace(regex, " ").replace(/^\s+/, "");
    resizePromptInput();
  }
  renderImageTray();
  updateFollowUpOptions();
}

function syncPendingSkillsWithPrompt() {
  const text = String(els.promptInput?.value || "");
  const mentioned = new Set();
  const regex = /(?:^|\s)\$([a-zA-Z0-9_.:-]+)(?=\s|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    mentioned.add(match[1]);
  }
  let changed = false;
  for (const name of mentioned) {
    if (!state.pendingSkills.some((item) => item.name === name)) {
      const found = state.skills.find((s) => s.name === name);
      if (found) {
        state.pendingSkills.push({
          name: found.name,
          path: found.path || "",
          displayName: found.interface?.displayName || found.name,
          description: found.interface?.shortDescription || found.shortDescription || found.description || ""
        });
        changed = true;
      }
    }
  }
  if (changed) renderImageTray();
}

function resolveTurnSkillsAndText(rawText, pendingSkills = []) {
  const text = String(rawText || "").trim();
  const byName = new Map();
  for (const skill of pendingSkills || []) {
    if (skill?.name) byName.set(skill.name, skill);
  }
  const regex = /(?:^|\s)\$([a-zA-Z0-9_.:-]+)(?=\s|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    if (!byName.has(name)) {
      const found = state.skills.find((s) => s.name === name);
      if (found) {
        byName.set(found.name, {
          name: found.name,
          path: found.path || "",
          displayName: found.interface?.displayName || found.name
        });
      }
    }
  }
  const selectedSkills = [...byName.values()];
  if (!selectedSkills.length) {
    return { displayText: text, wireText: text, skillInputs: [] };
  }
  let wireText = text;
  const missingTokens = [];
  for (const skill of selectedSkills) {
    const escaped = skill.name.replace(/[.*+?^${}()|[\]\\]/g, "\\async function loadModels() {");
    const tokenRegex = new RegExp(`(^|\\s)\\${escaped}(?=\\s|$)`, "g");
    const replacementLink = skill.path ? `[${skill.name}](${skill.path})` : `${skill.name}`;
    if (tokenRegex.test(wireText)) {
      wireText = wireText.replace(tokenRegex, `$1${replacementLink}`);
    } else {
      missingTokens.push(replacementLink);
    }
  }
  if (missingTokens.length) {
    wireText = [missingTokens.join(" "), wireText].filter(Boolean).join(" ").trim();
  }
  const displayTokens = selectedSkills
    .filter((skill) => {
      const escaped = skill.name.replace(/[.*+?^${}()|[\]\\]/g, "\\async function loadModels() {");
      return !new RegExp(`(?:^|\\s)\\${escaped}(?=\\s|$)`).test(text);
    })
    .map((skill) => `${skill.name}`);
  const displayText = [displayTokens.join(" "), text].filter(Boolean).join(" ").trim();
  const skillInputs = selectedSkills
    .filter((skill) => Boolean(skill.path))
    .map((skill) => ({ type: "skill", name: skill.name, path: skill.path }));
  return { displayText, wireText, skillInputs };
}

async function loadModels() {
  const result = await rpc("model/list", { limit: 50, includeHidden: false });
  state.models = result?.data || [];
  els.modelSelect.innerHTML = "";
  for (const model of state.models) {
    const option = document.createElement("option");
    option.value = model.model || model.id;
    option.textContent = model.displayName || model.model || model.id;
    if (model.isDefault) option.selected = true;
    els.modelSelect.append(option);
  }
  if (!state.models.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("model.default");
    els.modelSelect.append(option);
  }
  updateReasoningOptions("", { useModelDefault: true });
}

async function loadPermissionModes(cwd = "") {
  if (!state.threadSettingsAvailable) {
    applyPermissionModeFallback();
    return;
  }
  try {
    const [profileResult, requirementsResult] = await Promise.all([
      rpc("permissionProfile/list", { limit: 50, cwd: cwd || els.projectSelect.value || preferredScopedCwd() || null }),
      rpc("configRequirements/read", {})
    ]);
    state.permissionProfiles = profileResult?.data || [];
    state.configRequirements = requirementsResult?.requirements || null;
    state.permissionModes = availablePermissionModes(state.permissionProfiles, state.configRequirements);
    renderPermissionModes();
  } catch {
    state.threadSettingsAvailable = false;
    applyPermissionModeFallback();
    applyBridgeModeUi();
  }
}

function builtInPermissionProfiles() {
  return [":read-only", ":workspace", ":danger-full-access"]
    .map((id) => ({ id, allowed: true, description: null }));
}

function applyPermissionModeFallback() {
  state.permissionProfiles = builtInPermissionProfiles();
  state.configRequirements = null;
  state.permissionModes = availablePermissionModes(state.permissionProfiles, null);
  renderPermissionModes();
}

function renderPermissionModes(preferredValue = "") {
  const previous = preferredValue || els.permissionSelect.value;
  els.permissionSelect.innerHTML = "";
  for (const mode of state.permissionModes) {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.label || t(mode.labelKey);
    option.title = mode.description || t(mode.descriptionKey);
    els.permissionSelect.append(option);
  }
  if (previous && [...els.permissionSelect.options].some((option) => option.value === previous)) {
    els.permissionSelect.value = previous;
  } else if (state.permissionModes.length) {
    els.permissionSelect.value = state.permissionModes.some((mode) => mode.id === "request-approval")
      ? "request-approval"
      : state.permissionModes[0].id;
  }
}

async function loadConfig() {
  const result = await rpc("config/read", {});
  state.config = result?.config || null;
}

function applyConfigDefaults() {
  const config = state.config || {};
  const effort = configReasoningEffort(config);
  if (config.model) {
    setModelValue(config.model, effort);
  } else {
    updateReasoningOptions(effort, { useModelDefault: true });
  }
}

async function loadAccount() {
  const result = await rpc("account/read", { refreshToken: false });
  state.account = result;
  if (result?.requiresOpenaiAuth && !result?.account) {
    els.authPanel.classList.remove("hidden");
    els.authText.textContent = t("auth.notLoggedIn");
  } else {
    els.authPanel.classList.add("hidden");
  }
}

function storedCollapsedProjects() {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_PROJECTS_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set();
  }
}

function persistCollapsedProjects() {
  try {
    localStorage.setItem(COLLAPSED_PROJECTS_STORAGE_KEY, JSON.stringify([...state.collapsedProjects]));
  } catch {
    // Private browsing can disable localStorage; collapsing still works for this page lifetime.
  }
}

async function loadRateLimits() {
  if (!els.usageWindows) return;
  els.usageCard?.classList.add("loading");
  try {
    const result = await rpc("account/rateLimits/read", {});
    state.rateLimits = normalizeRateLimits(result);
    state.rateLimitsError = "";
  } catch (error) {
    state.rateLimits = { windows: [], planType: "", credits: null };
    state.rateLimitsError = error?.message || t("usage.unavailable");
  } finally {
    els.usageCard?.classList.remove("loading");
    renderRateLimits();
  }
}

function renderRateLimits() {
  if (!els.usageWindows) return;
  const { windows, planType } = state.rateLimits || {};
  els.usagePlan.textContent = planType ? String(planType).toUpperCase() : "";
  els.usageWindows.innerHTML = "";

  if (!windows?.length) {
    const empty = document.createElement("div");
    empty.className = "usage-empty";
    empty.textContent = state.rateLimitsError || t("usage.unavailable");
    els.usageWindows.append(empty);
    return;
  }

  for (const window of windows) {
    const item = document.createElement("div");
    item.className = `usage-window ${window.remainingPercent <= 15 ? "critical" : window.remainingPercent <= 35 ? "warning" : ""}`;
    const durationLabel = rateLimitWindowLabel(window, t);
    const scopeLabel = window.limitName || (window.limitId && window.limitId !== "codex" ? window.limitId : "Codex");
    const label = `${scopeLabel} · ${durationLabel}`;
    const reset = formatResetTime(window.resetsAt, currentLocale());
    item.innerHTML = `
      <div class="usage-row">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(t("usage.remaining", { percent: Math.round(window.remainingPercent) }))}</strong>
      </div>
      <div class="usage-track" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(window.usedPercent)}">
        <span style="width:${window.usedPercent}%"></span>
      </div>
      <div class="usage-reset">${escapeHtml(reset ? t("usage.resets", { time: reset }) : t("usage.resetUnknown"))}</div>
    `;
    els.usageWindows.append(item);
  }
}

async function startDeviceLogin() {
  const result = await rpc("account/login/start", { type: "chatgptDeviceCode" });
  if (result?.verificationUrl && result?.userCode) {
    els.authPanel.classList.remove("hidden");
    const url = escapeHtml(result.verificationUrl);
    const code = escapeHtml(result.userCode);
    els.authText.innerHTML = t("auth.instructions", {
      url: `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`,
      code: `<strong>${code}</strong>`
    });
  }
}

async function loadThreads() {
  if (state.threadListSyncInFlight) return;
  state.threadListSyncInFlight = true;
  try {
    const result = await rpc("thread/list", {
      limit: 100,
      archived: Boolean(state.showArchivedThreads),
      sortKey: "recency_at",
      sortDirection: "desc"
    });
    const combined = mergeRemoteThreads(result?.data || [], state.desktopRemoteThreads);
    state.threads = mergeCurrentThreadIntoList(combined);
    for (const thread of state.threads) {
      if (!thread?.id) continue;
      const activity = setThreadActivity(thread.id, {
        type: "thread-snapshot",
        status: thread.status,
        updatedAt: thread.updatedAt || thread.createdAt
      }, false);
      const cached = state.recentThreadCache.get(thread.id);
      const cacheIsStale = Boolean(
        cached
        && thread.id !== state.currentThread?.id
        && ![THREAD_ACTIVITY.RUNNING, THREAD_ACTIVITY.WAITING].includes(activity.state)
        && shouldRefreshCachedThread({
          cachedTimestamp: cached.latestAt,
          threadTimestamp: threadTimestamp(thread),
          working: false
        })
      );
      if (cacheIsStale) {
        setThreadActivity(thread.id, {
          type: "thread-updated",
          status: thread.status,
          updatedAt: thread.updatedAt || thread.createdAt
        }, false);
      }
    }
    state.lastThreadListSyncAt = Date.now();
    renderProjectOptions();
    renderThreads();
    prewarmThreadCaches();
  } finally {
    state.threadListSyncInFlight = false;
  }
}

function refreshThreadManifestIfDue() {
  if (!state.connected || state.threadListSyncInFlight) return;
  if (Date.now() - state.lastThreadListSyncAt < IDLE_THREAD_SYNC_MS) return;
  loadThreads().catch(() => {});
}

function prewarmThreadCaches() {
  const ids = selectThreadCachePrewarmIds({
    threads: state.threads,
    activityByThread: state.threadActivity,
    currentThreadId: state.currentThread?.id,
    limit: RECENT_THREAD_CACHE_LIMIT
  });
  ids.forEach((threadId) => enqueueBackgroundThreadCache(threadId));
}

function scheduleBackgroundThreadCache(threadId, delay = 180) {
  const id = String(threadId || "");
  if (!id || id === state.currentThread?.id) return;
  const existing = state.backgroundCacheTimers.get(id);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    state.backgroundCacheTimers.delete(id);
    enqueueBackgroundThreadCache(id);
  }, Math.max(0, Number(delay) || 0));
  state.backgroundCacheTimers.set(id, timer);
}

function enqueueBackgroundThreadCache(threadId) {
  const id = String(threadId || "");
  if (!id || id === state.currentThread?.id) return;
  if (state.backgroundCacheQueued.has(id) || state.backgroundCacheInFlight.has(id)) return;

  const thread = state.threads.find((entry) => entry.id === id);
  if (!thread || thread.ephemeral) return;
  const activity = activityForThread(id);
  const working = [THREAD_ACTIVITY.RUNNING, THREAD_ACTIVITY.WAITING].includes(activity.state);
  const cached = state.recentThreadCache.get(id);
  if (cached && !shouldRefreshCachedThread({
    cachedTimestamp: cached.latestAt,
    threadTimestamp: threadTimestamp(thread),
    working
  })) return;

  state.backgroundCacheQueued.add(id);
  state.backgroundCacheQueue.push(id);
  pumpBackgroundThreadCache();
}

function pumpBackgroundThreadCache() {
  while (
    state.backgroundCacheInFlight.size < BACKGROUND_CACHE_CONCURRENCY
    && state.backgroundCacheQueue.length
  ) {
    const threadId = state.backgroundCacheQueue.shift();
    state.backgroundCacheQueued.delete(threadId);
    if (!threadId || threadId === state.currentThread?.id) continue;
    state.backgroundCacheInFlight.add(threadId);
    refreshBackgroundThreadCache(threadId)
      .catch(() => {})
      .finally(() => {
        state.backgroundCacheInFlight.delete(threadId);
        pumpBackgroundThreadCache();
      });
  }
}

async function refreshBackgroundThreadCache(threadId) {
  const page = await rpc("thread/turns/list", {
    threadId,
    limit: TURN_PAGE_LIMIT,
    sortDirection: "desc",
    itemsView: TURN_ITEMS_VIEW
  });
  if (threadId === state.currentThread?.id) return;
  const turns = page?.data || [];
  const latestAt = latestTurnTimestamp(turns) || threadTimestamp(
    state.threads.find((entry) => entry.id === threadId)
  );
  cacheRecentThreadPage(threadId, turns, page?.nextCursor, latestAt);
  if (turnLifecycle(turns[0]?.status) === "active") {
    scheduleBackgroundThreadCache(threadId, ACTIVE_THREAD_SYNC_MS);
  }
}

function cancelBackgroundThreadCache(threadId) {
  const id = String(threadId || "");
  const timer = state.backgroundCacheTimers.get(id);
  if (timer) window.clearTimeout(timer);
  state.backgroundCacheTimers.delete(id);
  state.backgroundCacheQueued.delete(id);
  state.backgroundCacheQueue = state.backgroundCacheQueue.filter((entry) => entry !== id);
}

function mergeCurrentThreadIntoList(threads) {
  const current = state.currentThread;
  if (!current?.id) return threads;
  const index = threads.findIndex((thread) => thread.id === current.id);
  if (index < 0) return [current, ...threads];
  const merged = [...threads];
  merged[index] = { ...current, ...merged[index] };
  return merged;
}

function getSelectedProject() {
  const selected = els.projectSelect?.value;
  if (!selected) return null;
  if (state.desktopProjects?.length) {
    const foundById = state.desktopProjects.find((p) => p.id === selected);
    if (foundById) return foundById;
    const foundByPath = state.desktopProjects.find((p) =>
      (p.rootPaths || []).some((r) => isPathInside(selected, r))
    );
    if (foundByPath) return foundByPath;
  }
  return null;
}

function getSelectedCwd() {
  const proj = getSelectedProject();
  if (proj) return proj.primaryPath;
  const opt = els.projectSelect?.selectedOptions?.[0];
  return opt?.dataset?.cwd || els.projectSelect?.value || preferredScopedCwd();
}

function updateProjectInputState(project) {
  const isRemote = project?.projectKind === "remote";
  if (els.browseWorkspace) {
    els.browseWorkspace.disabled = isRemote || state.desktopBridgeConnected !== true || !state.workspaceBrowserAvailable;
    els.browseWorkspace.title = isRemote ? t("workspace.remoteNoBrowse") : "";
    els.browseWorkspace.classList.toggle("disabled", isRemote);
  }
  if (els.cwdInput) {
    els.cwdInput.value = project?.primaryPath || getSelectedCwd() || "";
    els.cwdInput.readOnly = isRemote;
  }
}

function setProjectSelection(target) {
  if (!els.projectSelect) return;
  if (!target) {
    els.projectSelect.value = "";
    updateProjectInputState(null);
    return;
  }

  if (state.desktopProjects && state.desktopProjects.length) {
    let matched = state.desktopProjects.find((p) => p.id === target);
    if (!matched && typeof target === "string") {
      matched = state.desktopProjects.find((p) =>
        (p.rootPaths || []).some((r) => isPathInside(target, r))
      );
    }
    if (matched) {
      els.projectSelect.value = matched.id;
      updateProjectInputState(matched);
      return;
    }
  }

  let value = target || preferredScopedCwd();
  const isScopeRoot = state.threadFilterCwds.some((root) => samePath(root, value));
  if (value && !isScopeRoot && !isProjectGroup(projectFromCwd(value))) {
    els.projectSelect.value = preferredScopedCwd();
    updateProjectInputState(null);
    return;
  }
  if (value && ![...els.projectSelect.options].some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = projectFromCwd(value).name;
    els.projectSelect.append(option);
  }
  els.projectSelect.value = value;
  updateProjectInputState(null);
}

function setProjectSelectionForThread(thread) {
  if (!thread) return;
  if (state.desktopProjects && state.desktopProjects.length) {
    const proj = findProjectForThread(
      thread,
      state.desktopProjects,
      state.desktopAssignments,
      state.projectlessThreadIds
    );
    if (proj) {
      setProjectSelection(proj.id);
      return;
    }
  }
  if (thread.cwd) {
    setProjectSelection(thread.cwd);
  }
}


export function applyDesktopState(desktopState) {
  if (!desktopState) return;
  state.desktopProjects = Array.isArray(desktopState.projects) ? desktopState.projects : [];
  state.desktopAssignments = desktopState.assignments || {};
  state.pinnedThreadIds = Array.isArray(desktopState.pinnedThreadIds) ? desktopState.pinnedThreadIds : [];
  state.pinnedProjectIds = Array.isArray(desktopState.pinnedProjectIds) ? desktopState.pinnedProjectIds : [];
  state.projectlessThreadIds = Array.isArray(desktopState.projectlessThreadIds) ? desktopState.projectlessThreadIds : [];
  state.desktopRemoteThreads = Array.isArray(desktopState.remoteThreads) ? desktopState.remoteThreads : [];
  if (state.desktopRemoteThreads.length > 0) {
    state.threads = mergeRemoteThreads(state.threads, state.desktopRemoteThreads);
  }
  renderProjectOptions();
  renderThreads();
}

function renderProjectOptions() {
  const previous = els.projectSelect.value;
  els.projectSelect.innerHTML = "";

  if (state.desktopProjects && state.desktopProjects.length > 0) {
    if (!hasScopedToken()) {
      const none = document.createElement("option");
      none.value = "";
      none.textContent = t("project.none");
      els.projectSelect.append(none);
    }

    for (const proj of state.desktopProjects) {
      const option = document.createElement("option");
      option.value = proj.id;
      option.dataset.cwd = proj.primaryPath || "";
      option.dataset.projectId = proj.id;
      option.dataset.projectKind = proj.projectKind;
      option.dataset.hostId = proj.hostId || "";

      if (proj.projectKind === "remote") {
        const hostTag = proj.hostDisplayName || proj.hostId;
        option.textContent = `[${t("project.remoteBadge")}] ${proj.name} (${hostTag})`;
      } else {
        option.textContent = proj.name;
      }
      els.projectSelect.append(option);
    }

    if (previous && [...els.projectSelect.options].some((option) => option.value === previous)) {
      els.projectSelect.value = previous;
    } else if (state.currentThread) {
      setProjectSelectionForThread(state.currentThread);
    } else if (hasScopedToken()) {
      setProjectSelection(preferredScopedCwd());
    }
    const currentProj = getSelectedProject();
    updateProjectInputState(currentProj);
    return;
  }

  const groupsByKey = new Map(
    groupThreadsByProject(state.threads)
      .filter(isProjectGroup)
      .map((group) => [group.key, group])
  );
  for (const cwd of state.threadFilterCwds) {
    const project = projectFromCwd(cwd);
    if (!groupsByKey.has(project.key)) groupsByKey.set(project.key, { ...project, threads: [] });
  }
  const groups = sortProjectGroupsByActivity([...groupsByKey.values()], state.threadActivity);

  if (!hasScopedToken()) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = t("project.none");
    els.projectSelect.append(none);
  }

  for (const group of groups) {
    const option = document.createElement("option");
    option.value = group.cwd;
    option.textContent = group.name;
    els.projectSelect.append(option);
  }

  if (previous && [...els.projectSelect.options].some((option) => option.value === previous)) {
    els.projectSelect.value = previous;
  } else if (state.currentThread?.cwd) {
    setProjectSelection(state.currentThread.cwd);
  } else if (hasScopedToken()) {
    setProjectSelection(preferredScopedCwd());
  }
}

function renderThreads() {
  const term = els.searchThreads.value.trim().toLowerCase();
  els.threadList.innerHTML = "";
  const filtered = state.threads.filter((thread) => threadMatchesSearch(thread, term));

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "thread-item";
    empty.innerHTML = `<span class="thread-name">${escapeHtml(t("thread.noThreads"))}</span><span class="thread-time">${escapeHtml(t("thread.new"))}</span>`;
    els.threadList.append(empty);
    return;
  }

  // 1. Pinned threads
  const pinnedIds = new Set(state.pinnedThreadIds || []);
  const pinnedThreads = [];
  if (state.pinnedThreadIds?.length) {
    for (const id of state.pinnedThreadIds) {
      const found = filtered.find((thread) => thread.id === id);
      if (found) pinnedThreads.push(found);
    }
  }

  if (pinnedThreads.length) {
    els.threadList.append(renderSectionTitle(t("thread.pinned")));
    const section = document.createElement("section");
    section.className = "pinned-thread-group";
    for (const thread of pinnedThreads) section.append(renderThreadButton(thread));
    els.threadList.append(section);
  }

  // 2. Active / attention threads (excluding pinned threads)
  const attentionThreads = filtered
    .filter((thread) => !pinnedIds.has(thread.id) && activityPriority(activityForThread(thread.id)) < 4)
    .sort((left, right) => {
      const priority = activityPriority(activityForThread(left.id)) - activityPriority(activityForThread(right.id));
      return priority || threadTimestamp(right) - threadTimestamp(left);
    });
  const regularThreads = filtered.filter((thread) => !attentionThreads.some((active) => active.id === thread.id));

  if (attentionThreads.length) {
    els.threadList.append(renderSectionTitle(t("thread.active")));
    const section = document.createElement("section");
    section.className = "active-thread-group";
    for (const thread of attentionThreads) section.append(renderThreadButton(thread));
    els.threadList.append(section);
  }

  // 3. Projects
  let projects = [];
  let directThreads = [];

  if (state.desktopProjects && state.desktopProjects.length > 0) {
    const grouped = groupThreadsByDesktopProjects({
      threads: regularThreads,
      desktopProjects: state.desktopProjects,
      assignments: state.desktopAssignments,
      projectlessIds: state.projectlessThreadIds,
      rankingThreads: filtered,
      activityByThread: state.threadActivity
    });
    projects = grouped.projects;
    directThreads = grouped.directThreads;
  } else {
    const grouped = splitThreadGroups(groupThreadsByProject(regularThreads, filtered));
    projects = grouped.projects;
    directThreads = grouped.directThreads;
  }

  if (projects.length) {
    els.threadList.append(renderSectionTitle(t("thread.projects")));
    for (const group of projects) {
      if (term && group.threads.length === 0) continue;
      els.threadList.append(renderProjectGroup(group, { forceExpanded: Boolean(term) }));
    }
  }

  // 4. Direct conversations
  if (directThreads.length) {
    const unpinnedDirect = directThreads.filter((t) => !pinnedIds.has(t.id));
    if (unpinnedDirect.length) {
      els.threadList.append(renderSectionTitle(t("thread.conversations")));
      const section = document.createElement("section");
      section.className = "direct-thread-group";
      for (const thread of unpinnedDirect) {
        section.append(renderThreadButton(thread));
      }
      els.threadList.append(section);
    }
  }
}

function threadMatchesSearch(thread, term) {
  if (!term) return true;
  const project = (state.desktopProjects?.length && findProjectForThread(
    thread,
    state.desktopProjects,
    state.desktopAssignments,
    state.projectlessThreadIds
  )) || projectFromCwd(thread.cwd);
  const text = `${thread.name || ""} ${thread.preview || ""} ${thread.cwd || ""} ${project.name}`.toLowerCase();
  return text.includes(term);
}

function renderSectionTitle(title) {
  const node = document.createElement("div");
  node.className = "sidebar-section-title";
  node.textContent = title;
  return node;
}

function createNewThreadInProject(group) {
  if (!group) return;
  setProjectSelection(group.id);
  createThread();
  const proj = getSelectedProject() || group;
  state.currentThread.cwd = proj.primaryPath || proj.cwd;
  state.currentThread.selectedProjectId = proj.id;
  state.currentThread.selectedHostId = proj.hostId;
  updateProjectInputState(proj);
}

function renderProjectGroup(group, options = {}) {
  const section = document.createElement("section");
  const isDefaultCollapsed = state.collapsedProjects === null;
  const isCollapsed = !options.forceExpanded && (
    isDefaultCollapsed ? true : state.collapsedProjects.has(group.key)
  );
  const showAll = state.expandedProjects.has(group.key);
  const visibleThreads = isCollapsed ? [] : showAll ? group.threads : group.threads.slice(0, 6);
  const isRemote = group.projectKind === "remote";
  const isProjectPinned = (state.pinnedProjectIds || []).includes(group.id);
  section.className = `project-group ${isCollapsed ? "collapsed" : ""}`;

  const icon = isRemote ? remoteIcon() : folderIcon();
  const hostTag = isRemote && (group.hostDisplayName || group.hostId)
    ? `<span class="project-host-tag">${escapeHtml(group.hostDisplayName || group.hostId)}</span><span class="project-host-dot" title="${escapeHtml(t("project.remoteReady"))}"></span>`
    : "";
  const titleAttr = `${group.name}${group.hostDisplayName ? ' (' + group.hostDisplayName + ')' : ''} · ${group.cwd || group.primaryPath || ''}`;

  section.innerHTML = `
    <button class="project-heading" type="button" title="${escapeHtml(titleAttr)}" aria-expanded="${String(!isCollapsed)}">
      <span class="project-chevron" aria-hidden="true">›</span>
      ${icon}
      <span class="project-title-wrap">
        <span class="project-name">${escapeHtml(group.name)}</span>
        ${hostTag}
      </span>
      <span class="project-pin-btn ${isProjectPinned ? "is-pinned" : ""}" role="button" tabindex="0" title="${escapeHtml(isProjectPinned ? t("project.unpin") : t("project.pin"))}" aria-label="${escapeHtml(isProjectPinned ? t("project.unpin") : t("project.pin"))}">
        ${pinIcon(isProjectPinned)}
      </span>
      <span class="project-badge">${group.totalCount ?? group.threads.length}</span>
    </button>
  `;

  section.querySelector(".project-heading").addEventListener("click", (e) => {
    if (e.target.closest(".project-pin-btn")) {
      e.stopPropagation();
      e.preventDefault();
      toggleProjectPin(group.id, !isProjectPinned);
      return;
    }
    if (state.collapsedProjects === null) {
      state.collapsedProjects = new Set(
        (state.desktopProjects || []).map((p) => `project:${p.id}`)
      );
      state.collapsedProjects.delete(group.key);
    } else if (state.collapsedProjects.has(group.key)) {
      state.collapsedProjects.delete(group.key);
    } else {
      state.collapsedProjects.add(group.key);
    }
    persistCollapsedProjects();
    renderThreads();
  });

  if (!isCollapsed && group.threads.length === 0) {
    const emptyRow = document.createElement("button");
    emptyRow.className = "project-empty-create";
    emptyRow.type = "button";
    emptyRow.innerHTML = `<span>${escapeHtml(t("project.newThread"))}</span>`;
    emptyRow.addEventListener("click", () => {
      createNewThreadInProject(group);
    });
    section.append(emptyRow);
  }

  for (const thread of visibleThreads) {
    section.append(renderThreadButton(thread));
  }

  const overflowAction = projectOverflowAction({
    collapsed: isCollapsed,
    totalCount: group.threads.length,
    visibleCount: visibleThreads.length,
    expanded: showAll
  });
  if (overflowAction === "expand") {
    const expand = document.createElement("button");
    expand.className = "expand-project";
    expand.type = "button";
    expand.textContent = t("thread.showMore");
    expand.addEventListener("click", () => {
      state.expandedProjects.add(group.key);
      renderThreads();
    });
    section.append(expand);
  } else if (overflowAction === "collapse") {
    const collapse = document.createElement("button");
    collapse.className = "expand-project";
    collapse.type = "button";
    collapse.textContent = t("thread.collapse");
    collapse.addEventListener("click", () => {
      state.expandedProjects.delete(group.key);
      renderThreads();
    });
    section.append(collapse);
  }

  return section;
}


function pinIcon(isPinned) {
  if (isPinned) {
    return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6l.8.8.8-.8v-6H18v-2l-2-2Z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6l.8.8.8-.8v-6H18v-2l-2-2Z"/></svg>`;
}

async function toggleThreadPin(threadId, pinned) {
  if (!threadId) return;
  const current = new Set(state.pinnedThreadIds || []);
  if (pinned) current.add(threadId);
  else current.delete(threadId);
  state.pinnedThreadIds = Array.from(current);
  renderThreads();

  try {
    const url = authenticatedUrl(`/api/threads/${encodeURIComponent(threadId)}/pin`, state.token);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned })
    });
    if (!res.ok) {
      await rpc("thread/pin", { threadId, pinned }).catch(() => {});
    }
  } catch {
    await rpc("thread/pin", { threadId, pinned }).catch(() => {});
  }
}

async function toggleProjectPin(projectId, pinned) {
  if (!projectId) return;
  const current = new Set(state.pinnedProjectIds || []);
  if (pinned) current.add(projectId);
  else current.delete(projectId);
  state.pinnedProjectIds = Array.from(current);

  if (state.desktopProjects?.length) {
    const proj = state.desktopProjects.find((p) => p.id === projectId);
    if (proj && pinned) {
      state.desktopProjects = [proj, ...state.desktopProjects.filter((p) => p.id !== projectId)];
    }
  }
  renderThreads();

  try {
    const url = authenticatedUrl(`/api/projects/${encodeURIComponent(projectId)}/pin`, state.token);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned })
    });
    if (!res.ok) {
      await rpc("project/pin", { projectId, pinned }).catch(() => {});
    }
  } catch {
    await rpc("project/pin", { projectId, pinned }).catch(() => {});
  }
}

function initSidebarResizer() {
  const resizer = document.querySelector("#sidebarResizer");
  const sidebar = els.sidebar;
  if (!resizer || !sidebar) return;

  const STORAGE_KEY = "codex-webui-sidebar-width";
  const DEFAULT_WIDTH = 300;
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 640;

  const savedWidth = parseInt(localStorage.getItem(STORAGE_KEY), 10);
  if (savedWidth && savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH) {
    document.documentElement.style.setProperty("--sidebar-width", `${savedWidth}px`);
  }

  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    resizer.classList.add("is-resizing");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    resizer.setPointerCapture(e.pointerId);
  });

  resizer.addEventListener("pointermove", (e) => {
    if (!resizer.hasPointerCapture(e.pointerId)) return;
    const delta = e.clientX - startX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(startWidth + delta)));
    document.documentElement.style.setProperty("--sidebar-width", `${newWidth}px`);
    localStorage.setItem(STORAGE_KEY, String(newWidth));
  });

  const onPointerUp = (e) => {
    if (resizer.hasPointerCapture(e.pointerId)) {
      resizer.releasePointerCapture(e.pointerId);
    }
    resizer.classList.remove("is-resizing");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  resizer.addEventListener("pointerup", onPointerUp);
  resizer.addEventListener("pointercancel", onPointerUp);

  resizer.addEventListener("dblclick", () => {
    document.documentElement.style.setProperty("--sidebar-width", `${DEFAULT_WIDTH}px`);
    localStorage.removeItem(STORAGE_KEY);
  });
}

function renderThreadButton(thread) {
  const link = document.createElement("a");
  const isActive = state.currentThread?.id === thread.id;
  const isLoading = state.loadingThreadId === thread.id;
  const isPinned = (state.pinnedThreadIds || []).includes(thread.id);
  const activity = activityForThread(thread.id);
  const activityState = activity.state || THREAD_ACTIVITY.IDLE;
  link.className = `thread-item activity-${activityState} ${activity.unread ? "unread" : ""} ${isActive ? "active" : ""} ${isLoading ? "loading" : ""} ${isPinned ? "is-pinned" : ""}`;
  link.href = threadUrl(thread.id);
  link.title = t("thread.openNewTab");
  if (isActive) link.setAttribute("aria-current", "page");
  link.innerHTML = `
    <span class="thread-activity-dot" data-state="${escapeHtml(activityState)}" title="${escapeHtml(activityLabel(activity))}" aria-label="${escapeHtml(activityLabel(activity))}"></span>
    <span class="thread-copy">
      <span class="thread-name">${escapeHtml(thread.name || thread.preview || t("thread.untitled"))}</span>
      <span class="thread-status">${escapeHtml(activityLabel(activity))}</span>
    </span>
    <button type="button" class="thread-pin-btn ${isPinned ? "is-pinned" : ""}" title="${escapeHtml(isPinned ? t("thread.unpin") : t("thread.pin"))}" aria-label="${escapeHtml(isPinned ? t("thread.unpin") : t("thread.pin"))}">
      ${pinIcon(isPinned)}
    </button>
    <span class="thread-time">${formatRelativeTime(thread.updatedAt || thread.createdAt)}</span>
  `;
  link.addEventListener("click", (event) => {
    if (event.target.closest(".thread-pin-btn")) {
      event.preventDefault();
      event.stopPropagation();
      toggleThreadPin(thread.id, !isPinned);
      return;
    }
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openThread(thread);
  });
  return link;
}

function activityForThread(threadId) {
  return state.threadActivity.get(threadId) || createThreadActivity();
}

function setThreadActivity(threadId, event, render = true) {
  if (!threadId) return createThreadActivity();
  const next = reduceThreadActivity(state.threadActivity.get(threadId), event);
  state.threadActivity.set(threadId, next);
  if (render) renderThreads();
  return next;
}

function activityLabel(activity) {
  if (activity?.state === THREAD_ACTIVITY.RUNNING) return t("activity.running");
  if (activity?.state === THREAD_ACTIVITY.WAITING) return t("activity.waiting");
  if (activity?.state === THREAD_ACTIVITY.COMPLETED) return t(activity.unread ? "activity.completedUnread" : "activity.completed");
  if (activity?.state === THREAD_ACTIVITY.FAILED) return t(activity.unread ? "activity.failedUnread" : "activity.failed");
  return t("activity.idle");
}

function threadUrl(threadId) {
  const url = new URL(cleanBackGuardUrl(window.location.href));
  url.hash = "";
  url.searchParams.set(THREAD_URL_PARAM, threadId);
  if (state.token) url.searchParams.set("token", state.token);
  return url.toString();
}

function splitThreadGroups(groups) {
  const projects = [];
  const directThreads = [];
  for (const group of groups) {
    if (isProjectGroup(group)) projects.push(group);
    else directThreads.push(...group.threads);
  }
  directThreads.sort((a, b) => threadTimestamp(b) - threadTimestamp(a));
  return { projects, directThreads };
}

function groupThreadsByProject(threads, rankingThreads = threads) {
  const groups = new Map();
  for (const thread of threads) {
    const project = projectFromCwd(thread.cwd);
    if (!groups.has(project.key)) {
      groups.set(project.key, { ...project, threads: [] });
    }
    groups.get(project.key).threads.push(thread);
  }

  for (const group of groups.values()) {
    group.threads.sort((a, b) => threadTimestamp(b) - threadTimestamp(a));
  }

  const rankingGroups = new Map();
  for (const thread of rankingThreads) {
    const project = projectFromCwd(thread.cwd);
    if (!rankingGroups.has(project.key)) rankingGroups.set(project.key, { ...project, threads: [] });
    rankingGroups.get(project.key).threads.push(thread);
  }

  const projectGroups = Array.from(groups.values());
  for (const group of projectGroups) {
    group.totalCount = (rankingGroups.get(group.key) || group).threads.length;
  }

  return projectGroups.sort((a, b) => {
    const aRankingGroup = rankingGroups.get(a.key) || a;
    const bRankingGroup = rankingGroups.get(b.key) || b;
    const aRank = projectGroupRank(aRankingGroup, state.threadActivity);
    const bRank = projectGroupRank(bRankingGroup, state.threadActivity);
    if (aRank.attention !== bRank.attention) return aRank.attention - bRank.attention;
    if (aRank.updatedAt !== bRank.updatedAt) return bRank.updatedAt - aRank.updatedAt;
    return a.name.localeCompare(b.name, currentLocale());
  });
}

function threadTimestamp(thread) {
  return thread?.recencyAt || thread?.updatedAt || thread?.createdAt || 0;
}

function latestTurnTimestamp(turns) {
  return Math.max(0, ...(turns || []).map(turnTimestamp));
}

function turnTimestamp(turn) {
  return normalizeUnixSeconds(turn?.completedAt || turn?.updatedAt || turn?.startedAt || turn?.createdAt || turn?.timestamp);
}

function itemTimestamp(item) {
  return normalizeUnixSeconds(item?.completedAt || item?.updatedAt || item?.createdAt || item?.timestamp);
}

function currentUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normalizeUnixSeconds(value) {
  if (!value) return 0;
  if (typeof value === "number") return value > 100000000000 ? Math.floor(value / 1000) : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

function createThread() {
  const proj = getSelectedProject();
  const cwd = proj ? proj.primaryPath : getSelectedCwd();
  if (proj) setProjectSelectionForThread({ cwd, projectId: proj.id, hostId: proj.hostId });
  else if (cwd) setProjectSelection(cwd);
  updateThreadUrl("");
  state.currentThread = {
    draft: true,
    name: t("thread.new"),
    preview: t("thread.new"),
    cwd,
    projectId: proj?.id || null,
    hostId: proj?.hostId || "local",
    projectKind: proj?.projectKind || "local",
    status: "draft"
  };
  state.initialThreadRestorePending = false;
  state.messages = [];
  state.currentThreadSettings = null;
  state.threadLockConflict = false;
  updateLockBanner();
  state.lastMessageAt = null;
  state.lastLoadStats = null;
  state.threadLoadStats = null;
  resetTurnPaging();
  if (cwd) loadSkills(cwd).catch(() => {});
  updateThreadHeader();
  updateProjectSelectState();
  updateTrafficSummary();
  renderEmpty(
    t("thread.new"),
    proj
      ? (proj.projectKind === "remote"
          ? t("empty.newThreadRemote", { project: "" + proj.name + " (" + (proj.hostDisplayName || proj.hostId) + ")" })
          : t("empty.newThreadProject", { project: proj.name }))
      : (cwd ? t("empty.newThreadProject", { project: projectFromCwd(cwd).name }) : t("empty.noProject"))
  );
  renderThreads();
  els.sidebar.classList.remove("open");
  els.promptInput.focus();
}

async function createThreadOnServer() {
  const selectedProj = getSelectedProject()
    || (state.currentThread?.selectedProjectId ? state.desktopProjects?.find((p) => p.id === state.currentThread.selectedProjectId) : null)
    || (state.currentThread?.projectId ? state.desktopProjects?.find((p) => p.id === state.currentThread.projectId) : null);
  const isRemote = selectedProj?.projectKind === "remote"
    || (state.currentThread?.selectedHostId && state.currentThread.selectedHostId !== "local")
    || (state.currentThread?.hostId && state.currentThread.hostId !== "local");
  const cwd = isRemote
    ? (selectedProj?.primaryPath || selectedProj?.remotePath || state.currentThread?.cwd)
    : (state.currentThread?.cwd || selectedProj?.primaryPath || getSelectedCwd() || preferredScopedCwd());
  const hostId = isRemote ? (selectedProj?.hostId || state.currentThread?.selectedHostId || state.currentThread?.hostId) : undefined;
  const projectId = selectedProj?.id || state.currentThread?.selectedProjectId || state.currentThread?.projectId || undefined;
  const params = buildSharedThreadStart({
    cwd,
    hostId,
    projectId,
    model: els.modelSelect.value,
    effort: els.reasoningSelect.value,
    permissionMode: els.permissionSelect.value,
    modes: state.permissionModes,
    serviceTier: els.serviceTierSelect ? els.serviceTierSelect.value : state.serviceTier
  });
  const result = await rpc("thread/start", params);
  state.currentThread = result.thread;
  if (state.collaborationMode === "plan" && state.currentThread?.id) {
    try {
      const updateParams = buildThreadSettingsUpdate({
        threadId: state.currentThread.id,
        model: els.modelSelect.value,
        effort: els.reasoningSelect.value,
        permissionMode: els.permissionSelect.value,
        modes: state.permissionModes,
        collaborationMode: "plan",
        serviceTier: state.serviceTier || undefined
      });
      await rpc("thread/settings/update", updateParams);
    } catch (_) {}
  }
  const createdSettings = threadSettingsFromResume(result);
  applyThreadSettings(createdSettings);
  cacheThreadSettings(state.currentThread?.id, createdSettings);
  rememberLastThread(state.currentThread?.id);
  updateThreadUrl(state.currentThread?.id || "");
  state.lastMessageAt = threadTimestamp(state.currentThread) || null;
  setProjectSelection(state.currentThread?.cwd || "");
  state.lastLoadStats = null;
  resetTurnPaging();
  updateThreadHeader();
  updateProjectSelectState();
  updateTrafficSummary();
  await loadThreads();
  els.sidebar.classList.remove("open");
  return state.currentThread;
}

async function ensureThread() {
  if (!state.currentThread?.id) {
    await createThreadOnServer();
  }
}

async function openThread(threadOrId, { showFailure = true } = {}) {
  const threadId = typeof threadOrId === "string" ? threadOrId : threadOrId?.id;
  if (!threadId) return;
  cancelBackgroundThreadCache(threadId);
  const loadSeq = ++state.threadLoadSeq;
  state.initialThreadRestorePending = false;
  const contentGate = createReadinessGate();
  const previewThread = typeof threadOrId === "string"
    ? state.threads.find((thread) => thread.id === threadId)
    : threadOrId;
  const threadHostId = previewThread?.hostId && previewThread.hostId !== "local"
    ? previewThread.hostId
    : undefined;
  const cachedPage = state.recentThreadCache.get(threadId);
  const cachedSettings = state.threadSettingsCache.get(threadId);
  let restoredCachedPage = false;
  let fetchedLatestPage = false;
  let opened = false;

  streamingRenderBatcher.cancel();
  state.loadingThreadId = threadId;
  state.threadContentGate = { threadId, loadSeq, gate: contentGate };
  setThreadActivity(threadId, { type: "opened" }, false);
  state.threadLoadStats = createThreadLoadStats(threadId, previewThread, loadSeq);
  state.lastLoadStats = null;
  state.currentThread = previewThread || { id: threadId };
  state.currentThreadSettings = null;
  state.activePlan = null;
  renderPlanProgressBar(null);
  state.tokenUsage = null;
  renderTokenUsageBadge();
  state.threadLockConflict = false;
  updateLockBanner();
  const restoredCachedSettings = !needsResume(previewThread)
    && restoreThreadSettingsCache(cachedSettings);
  state.lastMessageAt = threadTimestamp(state.currentThread) || null;
  setProjectSelectionForThread(state.currentThread);
  updateProjectSelectState();
  state.messages = [];
  resetTurnPaging();
  if (cachedPage?.turns?.length) {
    const cachedTurns = cachedPage.turns;
    reconcileLatestTurnState(threadId, cachedTurns[0]);
    rememberLoadedTurns(cachedTurns);
    state.turnCursor = cachedPage.nextCursor || null;
    state.hasOlderTurns = Boolean(cachedPage.nextCursor);
    state.messages = flattenTurns(newestFirstToDisplayOrder(cachedTurns));
    state.lastMessageAt = cachedPage.latestAt || state.lastMessageAt;
    restoredCachedPage = true;
    opened = true;
    contentGate.resolve();
  }
  if (state.currentThread?.cwd) loadSkills(state.currentThread.cwd).catch(() => {});
  state.threadLoadStats.showLoading = !restoredCachedPage;
  els.sendButton.disabled = isSendBlocked();
  updateThreadHeader();
  updateTrafficSummary();
  if (restoredCachedPage) renderMessages(true);
  else renderThreadLoading(state.currentThread, state.threadLoadStats);
  renderThreads();
  els.sendButton.disabled = isSendBlocked();
  els.sidebar.classList.remove("open");

  let latestPagePromise = null;
  let latestPageError = null;
  const applyLatestPage = (page) => {
    if (loadSeq !== state.threadLoadSeq || state.currentThread?.id !== threadId) return;
    const stats = state.threadLoadStats;
    const flattenStartedAt = performance.now();
    const turns = page?.data || [];
    reconcileLatestTurnState(threadId, turns[0]);
    fetchedLatestPage = true;
    opened = true;
    rememberLoadedTurns(turns);
    state.turnCursor = page?.nextCursor || null;
    state.hasOlderTurns = Boolean(page?.nextCursor);
    state.messages = flattenTurns(newestFirstToDisplayOrder(turns));
    state.lastMessageAt = latestTurnTimestamp(turns) || threadTimestamp(state.currentThread) || null;
    cacheRecentThreadPage(threadId, turns, page?.nextCursor, state.lastMessageAt);
    if (stats) {
      stats.showLoading = false;
      stats.messageCount = state.messages.length;
      stats.itemCount = countTurnItems(turns);
      stats.renderMs = performance.now() - flattenStartedAt;
      stats.finishedAt = performance.now();
      stats.phase = t("load.done");
      state.lastLoadStats = stats;
    }
    renderMessages(true);
    contentGate.resolve();
  };
  const beginLatestPageRefresh = () => {
    if (latestPagePromise) return latestPagePromise;
    latestPagePromise = rpc(
      "thread/turns/list",
      {
        threadId,
        limit: TURN_PAGE_LIMIT,
        sortDirection: "desc",
        itemsView: TURN_ITEMS_VIEW,
        ...(threadHostId ? { hostId: threadHostId } : {})
      },
      { traffic: state.threadLoadStats, label: t("load.readLatest") }
    )
      .then((page) => {
        applyLatestPage(page);
        return page;
      })
      .catch((error) => {
        latestPageError = error;
        return null;
      });
    return latestPagePromise;
  };
  const previewNeedsRefresh = !restoredCachedPage || shouldRefreshCachedThread({
    cachedTimestamp: cachedPage?.latestAt,
    threadTimestamp: threadTimestamp(previewThread),
    working: state.replyProgressThreadIds.has(threadId) || state.activeTurns.has(threadId)
  });
  if (previewNeedsRefresh) beginLatestPageRefresh();

  try {
    if (!restoredCachedSettings) {
      updateThreadLoadPhase(state.threadLoadStats, t("load.readSettings"));
      const readResult = await rpc(
        "thread/read",
        { threadId, ...(threadHostId ? { hostId: threadHostId } : {}) },
        { traffic: state.threadLoadStats, label: t("load.readSettings") }
      );
      if (loadSeq !== state.threadLoadSeq) return;
      if (readResult?.thread) {
        state.currentThread = { ...state.currentThread, ...readResult.thread };
        setProjectSelection(state.currentThread.cwd || "");
        updateThreadHeader();
        updateProjectSelectState();
      }

      await loadPermissionModes(state.currentThread?.cwd || "");
      const resumeResult = await rpc(
        "thread/resume",
        { threadId, ...(threadHostId ? { hostId: threadHostId } : {}) },
        { traffic: state.threadLoadStats, label: t("load.readSettings") }
      );
      if (loadSeq !== state.threadLoadSeq) return;
      if (resumeResult?.thread) state.currentThread = { ...state.currentThread, ...resumeResult.thread };
      const resumedSettings = threadSettingsFromResume(resumeResult);
      applyThreadSettings(resumedSettings);
      cacheThreadSettings(threadId, resumedSettings);
    }

    const cachedPageNeedsRefresh = !restoredCachedPage || shouldRefreshCachedThread({
      cachedTimestamp: cachedPage?.latestAt,
      threadTimestamp: threadTimestamp(state.currentThread),
      working: state.replyProgressThreadIds.has(threadId) || state.activeTurns.has(threadId)
    });
    if (cachedPageNeedsRefresh && !latestPagePromise) beginLatestPageRefresh();
    if (latestPagePromise) await latestPagePromise;
    if (latestPageError) throw latestPageError;
    if (!latestPagePromise) {
      state.threadLoadStats.messageCount = state.messages.length;
      state.threadLoadStats.itemCount = countTurnItems(cachedPage.turns);
      state.threadLoadStats.finishedAt = performance.now();
      state.threadLoadStats.phase = t("load.done");
      state.lastLoadStats = state.threadLoadStats;
      updateTrafficSummary();
    }
  } catch (error) {
    const isLockConflict = isLockConflictError(error);
    if (isLockConflict) {
      state.threadLockConflict = true;
    }
    if (latestPagePromise && !fetchedLatestPage) await latestPagePromise;
    opened = opened || restoredCachedPage || fetchedLatestPage;
    if (!opened && (previewThread?.isRemote || previewThread?.projectKind === "remote" || threadHostId)) {
      opened = true;
      state.messages = [{
        id: "msg_remote_" + threadId,
        role: "user",
        text: previewThread?.preview || previewThread?.title || t("project.remoteReady"),
        createdAt: threadTimestamp(previewThread)
      }];
      renderMessages(true);
      addSystemMessage(t("project.remoteSessionNotice", {
        host: previewThread?.hostDisplayName || previewThread?.hostId || "100.108.151.113"
      }), false);
      addSystemMessage(t("project.remoteErrorNotice"), false);
    }
    if (loadSeq === state.threadLoadSeq) {
      if (showFailure && !isLockConflict) {
        if (opened) addSystemMessage(error.message || t("load.retry"), false);
        else renderEmpty(t("load.failedTitle"), error.message || t("load.retry"));
      }
    }
  } finally {
    contentGate.resolve();
    if (loadSeq === state.threadLoadSeq) {
      state.loadingThreadId = null;
      if (state.threadContentGate?.loadSeq === loadSeq) state.threadContentGate = null;
      state.threadLoadStats = null;
      els.sendButton.disabled = isSendBlocked();
      updateTrafficSummary();
      renderThreads();
      if (restoredCachedPage && !fetchedLatestPage) scheduleCurrentThreadSync();
      else scheduleCurrentThreadSync(0);
      updateLockBanner();
    }
  }
  if (opened && loadSeq === state.threadLoadSeq && state.currentThread?.id === threadId) {
    rememberLastThread(threadId);
    updateThreadUrl(threadId);
  }
  return opened;
}

function stopCurrentThreadSync() {
  if (state.threadSyncTimer) window.clearTimeout(state.threadSyncTimer);
  state.threadSyncTimer = null;
}

function scheduleCurrentThreadSync(delay = null) {
  stopCurrentThreadSync();
  if (!state.connected || !state.currentThread?.id || document.hidden) return;
  const nextDelay = delay ?? threadSyncDelay({
    visible: !document.hidden,
    working: state.replyProgressThreadIds.has(state.currentThread.id)
  });
  if (nextDelay == null) return;
  state.threadSyncTimer = window.setTimeout(runCurrentThreadSync, Math.max(0, nextDelay));
}

async function runCurrentThreadSync() {
  state.threadSyncTimer = null;
  if (state.threadSyncInFlight || state.loadingThreadId || !state.connected || document.hidden) {
    scheduleCurrentThreadSync();
    return;
  }
  const threadId = state.currentThread?.id;
  if (!threadId) return;
  state.threadSyncInFlight = true;
  try {
    const page = await rpc("thread/turns/list", {
      threadId,
      limit: TURN_PAGE_LIMIT,
      sortDirection: "desc",
      itemsView: TURN_ITEMS_VIEW
    });
    if (state.currentThread?.id !== threadId) return;
    const turns = page?.data || [];
    const latestTurn = turns[0];
    const hadReplyProgress = state.replyProgressThreadIds.has(threadId);
    const lifecycle = reconcileLatestTurnState(threadId, latestTurn);
    rememberLoadedTurns(turns);
    const recent = flattenTurns(newestFirstToDisplayOrder(turns));
    const preserveLiveState = lifecycle === "active" || (lifecycle === "unknown" && hadReplyProgress);
    const reconciled = mergeRecentMessages(state.messages, recent, { preserveLiveState });
    const replyProgressChanged = hadReplyProgress !== state.replyProgressThreadIds.has(threadId);
    const latestAt = latestTurnTimestamp(turns) || state.lastMessageAt;
    cacheRecentThreadPage(threadId, turns, page?.nextCursor, latestAt);
    if (reconciled.changed || replyProgressChanged) {
      const shouldStickToBottom = shouldStickToLiveOutput();
      streamingRenderBatcher.cancel();
      state.messages = reconciled.messages;
      state.lastMessageAt = latestAt;
      renderMessages(shouldStickToBottom);
    }
    if (Date.now() - state.lastThreadListSyncAt >= IDLE_THREAD_SYNC_MS) loadThreads().catch(() => {});
  } catch {
    // Live notifications remain primary; the next bounded sync retries silently.
  } finally {
    state.threadSyncInFlight = false;
    scheduleCurrentThreadSync();
  }
}

function reconcileLatestTurnState(threadId, latestTurn) {
  const lifecycle = turnLifecycle(latestTurn?.status);
  const currentTurnId = state.activeTurns.get(threadId) || null;
  const activeTurnId = activeTurnIdFromLatest(currentTurnId, latestTurn);
  if (activeTurnId) state.activeTurns.set(threadId, activeTurnId);
  else if (lifecycle === "terminal") state.activeTurns.delete(threadId);

  if (lifecycle === "active") startReplyProgress(threadId);
  else if (lifecycle === "terminal") stopReplyProgress(threadId);
  if (threadId === state.currentThread?.id) updateSendMode();
  return lifecycle;
}

async function restoreInitialThread() {
  if (state.currentThread?.id || state.currentThread?.draft) return false;
  const candidates = initialThreadCandidates({
    threads: state.threads,
    urlThreadId: state.urlThreadId,
    lastThreadId: storedLastThreadId()
  });
  const restored = await restoreFirstUsableThread(
    candidates,
    (thread) => openThread(thread, { showFailure: false })
  );
  if (restored) return true;
  clearRememberedThread();
  updateThreadUrl("");
  return false;
}

function rememberLastThread(threadId) {
  if (!threadId) return;
  try {
    localStorage.setItem(LAST_THREAD_STORAGE_KEY, threadId);
  } catch {
    // Private browsing can disable localStorage.
  }
}

function storedLastThreadId() {
  try {
    return localStorage.getItem(LAST_THREAD_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function clearRememberedThread() {
  try {
    localStorage.removeItem(LAST_THREAD_STORAGE_KEY);
  } catch {
    // Private browsing can disable localStorage.
  }
}

function updateThreadUrl(threadId) {
  if (!window.history?.replaceState) return;
  const url = new URL(cleanBackGuardUrl(window.location.href));
  url.searchParams.delete("token");
  if (threadId) {
    url.searchParams.set(THREAD_URL_PARAM, threadId);
    state.urlThreadId = threadId;
  } else {
    url.searchParams.delete(THREAD_URL_PARAM);
    state.urlThreadId = "";
  }
  const nextUrl = url.toString();
  backGuardBaseUrl = nextUrl;
  window.history.replaceState({ ...(window.history.state || {}), codexWebUIPage: true }, "", nextUrl);
  if (window.__codexWebUIBackGuard) window.setTimeout(armBackButtonGuard, 0);
}


async function resumeCurrentThread(options = {}) {
  const showError = options.showError !== false;
  const force = Boolean(options.force || state.threadLockConflict);
  const thread = state.currentThread;
  if (!thread?.id || (!force && !needsResume(thread)) || state.resumingThreadId) return false;

  const threadId = thread.id;
  state.resumingThreadId = threadId;
  updateResumeStatus(thread);
  updateLockBanner();
  els.threadMeta.textContent = `${shortPath(thread.cwd)} · ${t("status.resuming")}`;

  try {
    const result = await rpc("thread/resume", { threadId });
    state.threadLockConflict = false;
    if (state.currentThread?.id === threadId) {
      state.currentThread = result.thread || state.currentThread;
      applyThreadSettings(threadSettingsFromResume(result));
      updateThreadHeader();
    }
    renderThreads();
    return true;
  } catch (error) {
    const isLockConflict = isLockConflictError(error);
    if (isLockConflict) {
      state.threadLockConflict = true;
    }
    if (showError && !isLockConflict) addSystemMessage(error.message || t("error.resume"));
    throw error;
  } finally {
    if (state.resumingThreadId === threadId) {
      state.resumingThreadId = null;
    }
    updateResumeStatus(state.currentThread);
    updateLockBanner();
  }
}

function isLockConflictError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("already has an active writer") ||
    msg.includes("active writer") ||
    msg.includes("is locked by another") ||
    msg.includes("another app")
  );
}

function updateLockBanner() {
  if (!els.threadLockBanner) return;
  const isLocked = Boolean(state.threadLockConflict && state.currentThread?.id && !state.currentThread?.draft);
  els.threadLockBanner.classList.toggle("hidden", !isLocked);
  if (els.composer) {
    els.composer.classList.remove("locked-hidden");
  }
  if (els.lockRetryBtn) {
    els.lockRetryBtn.disabled = Boolean(state.resumingThreadId || state.forkingThreadId);
    els.lockRetryBtn.textContent = state.resumingThreadId ? t("status.resuming") : t("thread.retry");
  }
  if (els.lockForkBtn) {
    els.lockForkBtn.disabled = Boolean(state.resumingThreadId || state.forkingThreadId);
    els.lockForkBtn.textContent = state.forkingThreadId ? t("thread.forking") : t("thread.fork");
  }
}

async function retryCurrentThreadResume() {
  if (state.resumingThreadId || state.forkingThreadId) return;
  const threadId = state.currentThread?.id;
  if (!threadId) return;
  try {
    const success = await resumeCurrentThread({ showError: false, force: true });
    if (success) {
      state.threadLockConflict = false;
      updateLockBanner();
      await openThread(threadId);
    }
  } catch (error) {
    if (isLockConflictError(error)) {
      state.threadLockConflict = true;
      updateLockBanner();
    }
  }
}

async function forkCurrentThread() {
  const current = state.currentThread;
  if (!current?.id || state.forkingThreadId || state.resumingThreadId) return;

  const threadId = current.id;
  state.forkingThreadId = threadId;
  updateLockBanner();

  try {
    const result = await rpc("thread/fork", { threadId });
    const newThread = result?.thread || result;
    if (newThread?.id) {
      state.threadLockConflict = false;
      updateLockBanner();
      await loadThreads();
      await openThread(newThread);
      addSystemMessage(t("thread.forkSuccess"));
    } else {
      throw new Error(t("thread.forkFailed"));
    }
  } catch (error) {
    addSystemMessage(error.message || t("thread.forkFailed"));
  } finally {
    state.forkingThreadId = null;
    updateLockBanner();
  }
}

async function sendTurn(text, { queue = false, expectedActiveTurnId = null } = {}) {
  if (state.sendingThreadId) return;
  const intendedThreadId = state.currentThread?.id || "";
  const sendKey = intendedThreadId || `draft:${Date.now()}`;
  const contentGate = state.threadContentGate?.threadId === intendedThreadId
    ? state.threadContentGate.gate
    : null;
  state.sendingThreadId = sendKey;
  els.sendButton.disabled = true;
  setFollowUpMenuOpen(false);
  try {
    if (contentGate && !contentGate.ready) {
      els.sendButton.textContent = t("composer.waiting");
      await contentGate.promise;
      if (state.currentThread?.id !== intendedThreadId) {
        throw new Error(t("error.threadChangedDuringSend"));
      }
    }

    const wasDraft = !state.currentThread?.id;
    const sendStartedAt = performance.now();
    await ensureThread();
    const threadId = state.currentThread.id;
    const turnDebugId = `${threadId}:${Date.now()}`;
    state.turnDiagnostics.set(threadId, {
      id: turnDebugId,
      threadId,
      startedAt: sendStartedAt,
      textChars: String(text || "").length,
      imageCount: state.pendingImages.length,
      firstDeltaAt: 0,
      turnStartedAt: 0,
      turnStartRpcDoneAt: 0
    });
    logTurnDebug("send-begin", threadId);
    const hasPendingUploads = state.pendingImages.some(
      (image) => image.status === "preparing" || image.status === "uploading"
    );
    if (hasPendingUploads) {
      els.sendButton.textContent = t("composer.waitingImages");
      els.sendButton.setAttribute("aria-label", t("composer.waitingImages"));
      await waitForPendingImageUploads(state.pendingImages);
      if (state.currentThread?.id !== threadId) throw new Error(t("error.threadChangedDuringSend"));
    }
    const images = state.pendingImages.filter((image) => image.status === "ready" && image.path);
    if (state.pendingImages.some((image) => image.status === "preparing" || image.status === "uploading")) {
      addSystemMessage(t("image.pending"));
      logTurnDebug("blocked-images-uploading", threadId);
      return;
    }
    if (state.pendingImages.some((image) => image.status === "failed")) {
      addSystemMessage(t("image.uploadFailed"));
      logTurnDebug("blocked-images-failed", threadId);
      return;
    }
    const activeTurnId = state.activeTurns.get(threadId) || null;
    if (expectedActiveTurnId && activeTurnId !== expectedActiveTurnId) {
      throw new Error(t("error.followUpTurnEnded"));
    }

    const { displayText, wireText, skillInputs } = resolveTurnSkillsAndText(text, state.pendingSkills);
    state.followLiveOutput = true;
    els.promptInput.value = "";
    resizePromptInput();
    state.pendingImages = [];
    state.pendingSkills = [];
    closeSkillMenu();
    renderImageTray();
    revokeImagePreviews(images);
    state.lastMessageAt = currentUnixSeconds();
    const queued = Boolean(queue && activeTurnId);
    const clientUserMessageId = createClientId();
    if (!activeTurnId) startReplyProgress(threadId);
    const automationHeartbeat = parseAutomationHeartbeat(displayText);
    if (!queued) {
      addMessage({
        role: "user",
        kind: automationHeartbeat ? "automationHeartbeat" : undefined,
        text: displayText,
        automationHeartbeat,
        images: images.map((image) => ({ kind: "source", source: image.path })),
        clientUserMessageId,
        pendingLocal: true
      });
      if (!activeTurnId) addPendingReplyMessage(threadId, true);
    }

    if (needsResume(state.currentThread)) {
      try {
        await resumeCurrentThread({ showError: false });
      } catch (err) {
        if (isLockConflictError(err)) {
          state.threadLockConflict = false;
          updateLockBanner();
        } else {
          stopReplyProgress(threadId);
          removePendingReplyMessages(threadId);
          throw err;
        }
      }
    }

    const input = [
      ...(wireText ? [{ type: "text", text: wireText, text_elements: [] }] : []),
      ...skillInputs,
      ...images.map((image) => ({ type: "localImage", path: image.path }))
    ];
    const request = buildPromptRequest({
      threadId,
      activeTurnId,
      input,
      clientUserMessageId,
      queue: queued
    });
    let result;
    try {
      result = await rpc(request.method, request.params);
    } catch (err) {
      if (isLockConflictError(err)) {
        state.threadLockConflict = true;
        updateLockBanner();
      }
      stopReplyProgress(threadId);
      removePendingReplyMessages(threadId);
      throw err;
    }
    if (request.mode === "queue") {
      addSystemMessage(t("composer.queued"));
      return;
    }
    const resultTurnId = result?.turn?.id || result?.turnId;
    if (resultTurnId) state.activeTurns.set(threadId, resultTurnId);
    const diagnostics = state.turnDiagnostics.get(threadId);
    if (diagnostics) diagnostics.turnStartRpcDoneAt = performance.now();
    logTurnDebug(request.mode === "steer" ? "turn-steer-rpc-done" : "turn-start-rpc-done", threadId);
    if (wasDraft) {
      await loadThreads();
      renderThreads();
    }
  } finally {
    if (state.sendingThreadId === sendKey) state.sendingThreadId = null;
    els.sendButton.disabled = isSendBlocked();
    updateSendMode();
  }
}

async function loadOlderTurns() {
  if (!state.currentThread?.id || !state.turnCursor || state.loadingOlderTurns) return;

  const threadId = state.currentThread.id;
  const previousHeight = els.messages.scrollHeight;
  const previousTop = els.messages.scrollTop;
  state.loadingOlderTurns = true;
  renderMessages(false);
  els.messages.scrollTop = previousTop;
  const cursor = state.turnCursor;
  let rendered = false;

  try {
    const page = await rpc(
      "thread/turns/list",
      {
        threadId,
        cursor,
        limit: TURN_PAGE_LIMIT,
        sortDirection: "desc",
        itemsView: TURN_ITEMS_VIEW
      },
      { traffic: state.lastLoadStats, label: t("load.older") }
    );

    if (cursor !== state.turnCursor || threadId !== state.currentThread?.id) return;

    const turns = filterUnloadedTurns(page.data || []);
    rememberLoadedTurns(turns);
    state.turnCursor = page.nextCursor || null;
    state.hasOlderTurns = Boolean(page.nextCursor);
    state.messages = [...flattenTurns(newestFirstToDisplayOrder(turns)), ...state.messages];
    if (state.lastLoadStats) {
      state.lastLoadStats.messageCount = state.messages.length;
      state.lastLoadStats.itemCount += countTurnItems(turns);
      state.lastLoadStats.finishedAt = performance.now();
    }

    state.loadingOlderTurns = false;
    renderMessages(false);
    updateTrafficSummary();
    rendered = true;
    els.messages.scrollTop = anchoredHistoryScrollTop({
      beforeHeight: previousHeight,
      beforeTop: previousTop,
      afterHeight: els.messages.scrollHeight
    });
  } catch (error) {
    state.loadingOlderTurns = false;
    renderMessages(false);
    els.messages.scrollTop = previousTop;
    updateTrafficSummary();
    rendered = true;
    addSystemMessage(error.message || t("load.olderError"), false);
    els.messages.scrollTop = previousTop;
  } finally {
    if (threadId === state.currentThread?.id) {
      state.loadingOlderTurns = false;
      if (!rendered) renderMessages(false);
    }
  }
}

function applyThreadSettings(settings) {
  if (!settings) return;
  state.currentThreadSettings = settings;
  if (state.pendingSettingsSelection?.threadId === state.currentThread?.id) return;
  state.applyingThreadSettings = true;
  renderPermissionModes();
  const effort = settings.effort || "";
  if (settings.model) {
    setModelValue(settings.model, effort);
  } else {
    updateReasoningOptions(effort, { useModelDefault: true });
  }
  const permissionMode = permissionModeFromSettings(settings, state.permissionModes);
  if (permissionMode === "custom") {
    const option = document.createElement("option");
    option.value = "custom";
    option.textContent = t("permission.custom");
    option.disabled = true;
    els.permissionSelect.append(option);
  }
  setSelectValueIfPresent(els.permissionSelect, permissionMode);
  const collaborationMode = settings.collaborationMode || "default";
  state.collaborationMode = collaborationMode;
  if (els.collaborationModeSelect) els.collaborationModeSelect.value = collaborationMode;
  if (els.planModeToggle) els.planModeToggle.classList.toggle("active", collaborationMode === "plan");
  const serviceTier = settings.serviceTier || "";
  state.serviceTier = serviceTier;
  if (els.serviceTierSelect) els.serviceTierSelect.value = serviceTier;
  state.applyingThreadSettings = false;
  applyBridgeModeUi();
}

function applyAuthoritativeThreadSettings() {
  applyThreadSettings(state.currentThreadSettings);
}

async function persistSelectedThreadSettings() {
  if (!state.threadSettingsAvailable || state.applyingThreadSettings || !state.currentThread?.id) return;
  state.pendingSettingsSelection = {
    threadId: state.currentThread.id,
    model: els.modelSelect.value,
    effort: els.reasoningSelect.value,
    permissionMode: els.permissionSelect.value,
    collaborationMode: els.collaborationModeSelect ? els.collaborationModeSelect.value : state.collaborationMode,
    serviceTier: els.serviceTierSelect ? els.serviceTierSelect.value : state.serviceTier
  };
  if (state.settingsSaving) return;
  await flushSelectedThreadSettings();
}

async function flushSelectedThreadSettings() {
  const selection = state.pendingSettingsSelection;
  if (!selection || state.settingsSaving) return;
  state.pendingSettingsSelection = null;
  const previous = state.currentThreadSettings;
  state.settingsSaving = true;
  applyBridgeModeUi();
  try {
    const params = buildThreadSettingsUpdate({
      ...selection,
      modes: state.permissionModes
    });
    await rpc("thread/settings/update", params);
    if (state.currentThread?.id !== selection.threadId) return;
    if (state.activeTurns.has(selection.threadId)) {
      els.threadMeta.textContent = t("settings.nextTurn");
    } else {
      els.threadMeta.textContent = t("settings.saved");
    }
  } catch (error) {
    if (state.currentThread?.id === selection.threadId) {
      state.currentThreadSettings = previous;
      applyAuthoritativeThreadSettings();
    }
    if (state.currentThread?.id === selection.threadId) {
      addSystemMessage(error.message || t("error.request"));
    }
  } finally {
    state.settingsSaving = false;
    applyBridgeModeUi();
    if (state.pendingSettingsSelection) queueMicrotask(flushSelectedThreadSettings);
  }
}

function setSelectValueIfPresent(select, value) {
  if (!select || !value) return;
  if ([...select.options].some((option) => option.value === value)) {
    select.value = value;
  }
}

function setModelValue(value, preferredEffort = "") {
  if (!els.modelSelect || !value) return;
  if (![...els.modelSelect.options].some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    els.modelSelect.append(option);
  }
  els.modelSelect.value = value;
  updateReasoningOptions(preferredEffort, { useModelDefault: true });
}

function updateReasoningOptions(preferredValue = "", { useModelDefault = false } = {}) {
  if (!els.reasoningSelect) return;
  const model = state.models.find((entry) => (entry.model || entry.id) === els.modelSelect.value);
  const supported = model?.supportedReasoningEfforts?.length
    ? model.supportedReasoningEfforts
    : ["low", "medium", "high", "xhigh"].map((reasoningEffort) => ({ reasoningEffort }));
  const previousValue = useModelDefault ? "" : els.reasoningSelect.value;
  const requestedValue = preferredValue || previousValue;

  els.reasoningSelect.innerHTML = "";
  for (const entry of supported) {
    const value = entry.reasoningEffort || entry.effort || entry.id;
    if (!value) continue;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = reasoningEffortLabel(value);
    if (entry.description) option.title = entry.description;
    els.reasoningSelect.append(option);
  }

  const available = [...els.reasoningSelect.options].map((option) => option.value);
  const modelDefault = model?.defaultReasoningEffort || "medium";
  els.reasoningSelect.value = available.includes(requestedValue)
    ? requestedValue
    : available.includes(modelDefault)
      ? modelDefault
      : available[0] || "";
}

function reasoningEffortLabel(value) {
  const key = `reasoning.${value}`;
  const label = t(key);
  return label === key ? value : label;
}

function configReasoningEffort(config) {
  return config?.model_reasoning_effort
    || config?.modelReasoningEffort
    || config?.reasoningEffort
    || config?.effort
    || "";
}

function flattenThread(thread) {
  return flattenTurns(thread?.turns || []);
}

function flattenTurns(turns) {
  const messages = [];
  for (const turn of turns || []) {
    for (const item of turn.items || []) {
      const message = messageFromItem(item);
      if (message) messages.push({ ...message, turnId: turn?.id || "" });
    }
  }
  return messages;
}

function countThreadItems(thread) {
  return countTurnItems(thread?.turns || []);
}

function countTurnItems(turns) {
  return (turns || []).reduce((total, turn) => total + (turn.items?.length || 0), 0);
}

function newestFirstToDisplayOrder(turns) {
  return [...(turns || [])].reverse();
}

function resetTurnPaging() {
  state.turnCursor = null;
  state.hasOlderTurns = false;
  state.loadingOlderTurns = false;
  state.historyAutoLoadArmed = false;
  state.followLiveOutput = true;
  state.openDisclosures = new Set();
  state.loadedTurnIds = new Set();
}

function rememberLoadedTurns(turns) {
  for (const turn of turns || []) {
    if (turn?.id) state.loadedTurnIds.add(turn.id);
  }
}

function cacheRecentThreadPage(threadId, turns, nextCursor, latestAt = null) {
  if (!threadId) return;
  state.recentThreadCache.set(threadId, {
    turns: Array.isArray(turns) ? turns : [],
    nextCursor: nextCursor || null,
    latestAt: latestAt || latestTurnTimestamp(turns) || null
  });
}

function cacheThreadSettings(threadId, settings, { preservePermissions = false } = {}) {
  if (!threadId || !settings) return;
  const existing = state.threadSettingsCache.get(threadId) || {};
  state.threadSettingsCache.set(threadId, {
    ...existing,
    settings,
    complete: preservePermissions ? Boolean(existing.complete) : true,
    permissionProfiles: preservePermissions
      ? [...(existing.permissionProfiles || [])]
      : [...(state.permissionProfiles || [])],
    permissionModes: preservePermissions
      ? [...(existing.permissionModes || [])]
      : [...(state.permissionModes || [])],
    configRequirements: preservePermissions
      ? existing.configRequirements
      : state.configRequirements
  });
}

function restoreThreadSettingsCache(cached) {
  if (!cached?.complete || !cached?.settings) return false;
  state.permissionProfiles = [...(cached.permissionProfiles || state.permissionProfiles || [])];
  state.permissionModes = [...(cached.permissionModes || state.permissionModes || [])];
  state.configRequirements = cached.configRequirements ?? state.configRequirements;
  renderPermissionModes();
  applyThreadSettings(cached.settings);
  return true;
}

function filterUnloadedTurns(turns) {
  return (turns || []).filter((turn) => !turn?.id || !state.loadedTurnIds.has(turn.id));
}

function needsResume(thread) {
  return formatStatus(thread?.status) === "notLoaded";
}

function messageFromItem(item) {
  if (item.type === "userMessage") {
    const content = item.content || [];
    const text = cleanUserText(content.map(inputToText).filter(Boolean).join("\n"));
    const automationHeartbeat = parseAutomationHeartbeat(text);
    return {
      role: "user",
      id: item.id,
      clientUserMessageId: item.clientId || undefined,
      kind: automationHeartbeat ? "automationHeartbeat" : undefined,
      text,
      automationHeartbeat,
      images: content
        .filter((entry) => entry.type === "localImage" || entry.type === "image")
        .map(normalizeImageReference)
        .filter(Boolean)
    };
  }
  if (item.type === "agentMessage") {
    return { role: "assistant", id: item.id, text: cleanAssistantText(item.text) };
  }
  if (item.type === "imageGeneration") {
    const image = normalizeImageReference(item);
    const state = imageGenerationState(item, image);
    return {
      role: "assistant",
      id: item.id,
      text: "",
      images: image ? [image] : [],
      imageGeneration: state
    };
  }
  if (item.type === "plan") {
    return { role: "system", id: item.id, text: item.text || "" };
  }
  if (item.type === "commandExecution") {
    const output = item.aggregatedOutput ? `\n\n${item.aggregatedOutput}` : "";
    return { role: "tool", id: item.id, text: `$ ${item.command}${output}` };
  }
  if (item.type === "fileChange") {
    const changes = item.changes || [];
    const paths = changes.map((change) => change.path).filter(Boolean);
    const detail = paths.length ? `\n${paths.join("\n")}` : "";
    return {
      role: "tool",
      id: item.id,
      text: t("tool.fileChange", { status: formatStatusLabel(item.status || "completed"), detail })
    };
  }
  if (item.type === "mcpToolCall") {
    const name = [item.server, item.tool].filter(Boolean).join("/");
    const output = toolResultText(item.result);
    return {
      role: "tool",
      id: item.id,
      text: t("tool.call", {
        name: name || "tool",
        status: formatStatusLabel(item.status || "completed"),
        output: output ? `\n\n${output}` : ""
      })
    };
  }
  if (item.type === "contextCompaction") {
    return { role: "tool", kind: "contextCompaction", id: item.id, text: t("tool.compacted") };
  }
  if (item.type === "reasoning") {
    const reasoningParts = cleanReasoningParts(item);
    const text = reasoningParts.join("\n\n");
    return text ? { role: "system", kind: "reasoning", id: item.id, text, reasoningParts } : null;
  }
  return null;
}

function cleanReasoningParts(item) {
  return [...(item?.summary || []), ...(item?.content || [])]
    .map((entry) => typeof entry === "string" ? entry : entry?.text || entry?.content || "")
    .map((text) => text
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim())
    .filter(Boolean);
}

function normalizeImageReference(entry) {
  if (entry.inlineImageId) {
    return {
      kind: "inline",
      id: entry.inlineImageId,
      bytes: entry.omittedBytes || 0,
      mimeType: entry.mimeType || "image/*"
    };
  }
  const source = entry.path || entry.savedPath || entry.url;
  return source ? { kind: "source", source } : null;
}

function imageGenerationState(item, image) {
  const rawStatus = String(item?.status || item?.state || "").toLowerCase();
  const rawError = item?.error?.message || item?.error || item?.failureReason || "";
  const failed = Boolean(
    rawError
    || rawStatus.includes("fail")
    || rawStatus.includes("error")
    || rawStatus.includes("cancel")
  );
  const complete = Boolean(
    image
    || rawStatus.includes("complete")
    || rawStatus.includes("done")
    || rawStatus === "succeeded"
  );
  return {
    pending: !complete && !failed,
    failed,
    status: rawStatus || (image ? "completed" : "running"),
    detail: String(rawError || "").trim()
  };
}

function toolResultText(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) => entry?.type === "text" ? entry.text : "")
    .filter(Boolean)
    .join("\n")
    .slice(0, 1200);
}

function cleanUserText(text) {
  let next = String(text || "").trim();
  const inlineSkills = new Set();
  next = next.replace(/\[\$([a-zA-Z0-9_.:-]+)\]\([^)\r\n]+\)/g, (_, name) => {
    inlineSkills.add(name);
    return `${name}`;
  });
  next = next.replace(/# Files mentioned by the user:[\s\S]*?(?=\n## My request for Codex:|$)/g, "").trim();
  next = next.replace(/# Browser comments:[\s\S]*?(?=\n# In app browser:|\n## My request for Codex:|$)/g, "").trim();
  next = next.replace(/# In app browser:\s*(?:\n- .*)*\s*/g, "").trim();
  next = next.replace(/^## My request for Codex:\s*/m, "").trim();
  next = next
    .split(/\r?\n/)
    .filter((line) => {
      const value = line.trim();
      if (value.startsWith("$") && inlineSkills.has(value.slice(1))) return false;
      return value !== "In app browser:"
        && !value.startsWith("- The user has the in-app browser open.")
        && !value.startsWith("- Current URL:")
        && !value.startsWith("The user has the in-app browser open.")
        && !value.startsWith("Current URL:")
        && value !== "My request for Codex:";
    })
    .join("\n")
    .trim();
  return next;
}

function cleanAssistantText(text) {
  const source = String(text || "").trim();
  const heartbeatResult = parseAutomationHeartbeatResult(source);
  if (!heartbeatResult) return source;
  return heartbeatResult.visibleText || heartbeatResult.message;
}

function parseAutomationHeartbeatResult(text) {
  const source = String(text || "").trim();
  const match = source.match(/(?:^|\n)[ \t]*(<heartbeat(?:\s[^>]*)?>[\s\S]*?<\/heartbeat>)[ \t]*$/i);
  if (!match) return null;

  const documentNode = new DOMParser().parseFromString(match[1], "application/xml");
  if (documentNode.querySelector("parsererror")) return null;
  const root = documentNode.documentElement;
  if (root?.localName?.toLowerCase() !== "heartbeat") return null;

  const children = [...root.children];
  const childText = (name) => children
    .find((child) => child.localName?.toLowerCase() === name)
    ?.textContent?.trim() || "";
  const automationId = childText("automation_id");
  const decision = childText("decision");
  if (!automationId || !decision) return null;

  return {
    automationId,
    decision,
    message: childText("message"),
    visibleText: source.slice(0, match.index).trim()
  };
}

function parseAutomationHeartbeat(text) {
  const source = String(text || "").trim();
  if (!/^<heartbeat[>\s]/i.test(source)) return null;

  const documentNode = new DOMParser().parseFromString(source, "application/xml");
  if (documentNode.querySelector("parsererror")) return null;
  const root = documentNode.documentElement;
  if (root?.localName?.toLowerCase() !== "heartbeat") return null;

  const automationId = root.querySelector("automation_id")?.textContent?.trim() || "";
  const currentTimeIso = root.querySelector("current_time_iso")?.textContent?.trim() || "";
  const instructions = root.querySelector("instructions")?.textContent?.trim() || "";
  if (!automationId && !currentTimeIso && !instructions) return null;
  return { automationId, currentTimeIso, instructions };
}

function inputToText(item) {
  if (item.type === "text") return item.text;
  if (item.type === "image" || item.type === "localImage") return "";
  if (item.type === "skill") return `$${item.name}`;
  if (item.type === "mention") return `$${item.name}`;
  return "";
}

function handleMessage(message, rawBytes = 0) {
  if (message.type === "hello") {
    state.tokenRole = message.role || "";
    applyTokenRoleUi();
    state.threadSettingsAvailable = Boolean(message.capabilities?.threadSettings);
    state.workspaceBrowserAvailable = Boolean(message.capabilities?.workspaceBrowser);
    setDesktopBridgeStatus(Boolean(message.desktopBridgeConnected));
    state.threadFilterCwds = scopeCwdsFrom(message);
    if (message.desktopState) {
      applyDesktopState(message.desktopState);
    }
    if (!els.cwdInput.value) els.cwdInput.value = message.defaultCwd || "";
    renderProjectOptions();
    reconcileRequestActivities(message.pendingServerRequests || []);
    reconcileApprovals(message.pendingServerRequests || []);
    return;
  }
  if (message.type === "desktop-state-updated") {
    if (message.state) {
      applyDesktopState(message.state);
    }
    return;
  }
  if (message.type === "rpc-result") {
    settleRequest(message.requestId, null, message.result, rawBytes || encodedJsonBytes(message));
    return;
  }
  if (message.type === "rpc-error") {
    settleRequest(
      message.requestId,
      new Error(message.error || t("error.request")),
      null,
      rawBytes || encodedJsonBytes(message)
    );
    return;
  }
  if (message.type === "codex-notification") {
    handleNotification(message.notification);
    return;
  }
  if (message.type === "server-request") {
    trackServerRequest(message.request);
    renderApprovals([message.request]);
    return;
  }
  if (message.type === "server-request-resolved") {
    resolveServerRequestActivity(message.id);
    removeApproval(message.id);
    return;
  }
  if (message.type === "desktop-bridge-status") {
    setDesktopBridgeStatus(Boolean(message.connected));
    return;
  }
  if (message.type === "bridge-error") {
    setDesktopBridgeStatus(false);
    return;
  }
}

function handleNotification(notification) {
  const { method, params } = notification || {};
  if (!method) return;
  const notificationThreadId = String(params?.threadId || params?.thread_id || "");
  if (
    notificationThreadId
    && notificationThreadId !== state.currentThread?.id
    && BACKGROUND_CACHE_NOTIFICATION_METHODS.has(method)
  ) {
    scheduleBackgroundThreadCache(
      notificationThreadId,
      method === "item/agentMessage/delta" ? 220 : 0
    );
  }

  if (method === "error") {
    if (params.threadId !== state.currentThread?.id) {
      if (!params.willRetry && params.threadId) {
        setThreadActivity(params.threadId, {
          type: "turn-completed",
          status: "failed",
          unread: true
        });
      }
      return;
    }
    const shouldStickToBottom = shouldStickToLiveOutput();
    const message = retryErrorText(params.error);
    const willRetry = Boolean(params.willRetry);
    replaceOrAppendMessage({
      role: "tool",
      kind: willRetry ? "retrying" : "retryFailed",
      id: retryStatusId(params.turnId),
      text: t(willRetry ? "retry.retrying" : "retry.failed", { message })
    });
    if (willRetry) ensureReplyProgressIndicator(params.threadId, shouldStickToBottom);
    renderMessages(shouldStickToBottom);
    return;
  }

  if (method === "skills/changed") {
    loadSkills(currentEffectiveCwd(), { forceReload: true }).catch(() => {});
    return;
  }

  if (method === "thread/started") {
    loadThreads();
    return;
  }

  if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
    if (params.threadId !== state.currentThread?.id) return;
    markRetryRecovered(params.turnId);
    const shouldStickToBottom = shouldStickToLiveOutput();
    let message = state.messages.find((entry) => entry.id === params.itemId);
    if (!message) {
      message = {
        role: "system",
        kind: "reasoning",
        id: params.itemId,
        text: "",
        reasoningParts: [""],
        turnId: params.turnId || ""
      };
      message.liveNotification = true;
      state.messages.push(message);
    }
    const delta = params.delta || params.text || "";
    message.text = (message.text || "") + delta;
    if (!message.reasoningParts) message.reasoningParts = [""];
    message.reasoningParts[0] = (message.reasoningParts[0] || "") + delta;
    state.lastMessageAt = currentUnixSeconds();
    streamingRenderBatcher.schedule({
      threadId: params.threadId,
      itemId: params.itemId,
      scroll: shouldStickToBottom
    });
    return;
  }

  if (method === "item/commandExecution/outputDelta" || method === "item/fileChange/outputDelta") {
    if (params.threadId !== state.currentThread?.id) return;
    markRetryRecovered(params.turnId);
    const shouldStickToBottom = shouldStickToLiveOutput();
    let message = state.messages.find((entry) => entry.id === params.itemId);
    if (!message) {
      message = {
        role: "tool",
        id: params.itemId,
        text: "",
        turnId: params.turnId || ""
      };
      message.liveNotification = true;
      state.messages.push(message);
    }
    const delta = params.delta || params.output || "";
    message.text = (message.text || "") + delta;
    state.lastMessageAt = currentUnixSeconds();
    streamingRenderBatcher.schedule({
      threadId: params.threadId,
      itemId: params.itemId,
      scroll: shouldStickToBottom
    });
    return;
  }

  if (method === "item/mcpToolCall/progress") {
    if (params.threadId !== state.currentThread?.id) return;
    const shouldStickToBottom = shouldStickToLiveOutput();
    let message = state.messages.find((entry) => entry.id === params.itemId);
    if (message) {
      const progressText = params.progress != null ? " (" + Math.round(params.progress * 100) + "%)" : "";
      const stepText = params.step || params.message || "";
      if (progressText || stepText) {
        message.text = message.text.split("\n[Progress:")[0] + "\n[Progress: " + stepText + progressText + "]";
      }
      streamingRenderBatcher.schedule({
        threadId: params.threadId,
        itemId: params.itemId,
        scroll: shouldStickToBottom
      });
    }
    return;
  }

  if (method === "command/exec/outputDelta" || method === "process/outputDelta" || method === "item/commandExecution/outputDelta" || method === "commandExecution/outputDelta") {
    const rawDelta = params.deltaBase64
      ? (decodeTerminalOutputBase64 ? decodeTerminalOutputBase64(params.deltaBase64) : atob(params.deltaBase64))
      : (params.delta || params.output || "");
    const cleanDelta = stripAnsiCodes ? stripAnsiCodes(rawDelta) : rawDelta;
    const procId = params.processId || params.id;
    for (const term of state.terminals.values()) {
      if (term.processId === procId || (!term.processId && procId) || (!procId && state.terminals.size === 1) || (!procId && state.activeTerminalId === term.id)) {
        if (!term.processId) term.processId = procId;
        term.output += cleanDelta;
        if (state.activeTerminalId === term.id) {
          renderTerminalOutput();
        }
        break;
      }
    }
    return;
  }

  if (method === "process/exited") {
    const procId = params.processId || params.id;
    for (const term of state.terminals.values()) {
      if (term.processId === procId) {
        term.output += t("terminal.exited", { code: params.exitCode ?? 0 });
        if (state.activeTerminalId === term.id) {
          renderTerminalOutput();
        }
        break;
      }
    }
    return;
  }

  if (method === "thread/goal/updated" || method === "thread/goal/cleared") {
    if (params.threadId === state.currentThread?.id) {
      loadThreadGoal();
    }
    return;
  }

  if (method === "mcpServer/startupStatus/updated" || method === "app/list/updated") {
    if (state.ecosystemModalOpen && state.activeEcoTab === "mcp") {
      loadEcosystemMcp().catch(() => {});
    }
    return;
  }

  if (method === "turn/diff/updated") {
    state.currentDiff = params.diff || "";
    renderDiffViewer(state.currentDiff);
    return;
  }

  if (method === "item/fileChange/patchUpdated") {
    const patch = params.patch || (diffFromFileChangeItem ? diffFromFileChangeItem(params) : "");
    if (patch) {
      state.currentDiff = (state.currentDiff ? state.currentDiff + "\n" : "") + patch;
      renderDiffViewer(state.currentDiff);
    }
    return;
  }

  if (method === "turn/plan/updated") {
    if (params.threadId !== state.currentThread?.id) return;
    const normalized = normalizePlanSteps({ explanation: params.explanation, plan: params.plan });
    state.activePlan = normalized;
    renderPlanProgressBar(normalized);
    return;
  }

  if (method === "item/plan/delta") {
    if (params.threadId !== state.currentThread?.id) return;
    markRetryRecovered(params.turnId);
    const shouldStickToBottom = shouldStickToLiveOutput();
    let message = state.messages.find((entry) => entry.id === params.itemId);
    if (!message) {
      message = {
        role: "assistant",
        id: params.itemId,
        text: "",
        turnId: params.turnId || ""
      };
      message.liveNotification = true;
      state.messages.push(message);
    }
    message.text = (message.text || "") + (params.delta || "");
    state.lastMessageAt = currentUnixSeconds();
    streamingRenderBatcher.schedule({
      threadId: params.threadId,
      itemId: params.itemId,
      scroll: shouldStickToBottom
    });
    return;
  }

  if (method === "thread/tokenUsage/updated") {
    if (params.threadId === state.currentThread?.id) {
      state.tokenUsage = params.usage || params.tokenUsage || params;
      renderTokenUsageBadge();
    }
    return;
  }

  if (method === "thread/archived") {
    const threadId = params.threadId || params.thread_id;
    if (threadId && threadId === state.currentThread?.id) {
      if (state.currentThread) state.currentThread.archived = true;
      updateThreadHeader();
    }
    loadThreads();
    return;
  }

  if (method === "thread/unarchived") {
    const threadId = params.threadId || params.thread_id;
    if (threadId && threadId === state.currentThread?.id) {
      if (state.currentThread) state.currentThread.archived = false;
      updateThreadHeader();
    }
    loadThreads();
    return;
  }

  if (method === "thread/deleted") {
    const threadId = params.threadId || params.thread_id;
    if (threadId && threadId === state.currentThread?.id) {
      state.currentThread = null;
      updateThreadHeader();
    }
    loadThreads();
    return;
  }

  if (method === "thread/name/updated") {
    const threadId = params.threadId || params.thread_id;
    const name = params.name || params.title || "";
    if (threadId === state.currentThread?.id) {
      if (state.currentThread) state.currentThread.name = name;
      els.threadTitle.value = name;
    }
    const thread = state.threads.find((t) => t.id === threadId);
    if (thread) thread.name = name;
    renderThreads();
    return;
  }

  if (method === "thread/settings/updated") {
    const settings = threadSettingsFromNotification(params);
    if (params.threadId && settings) {
      cacheThreadSettings(params.threadId, settings, { preservePermissions: true });
    }
    if (params.threadId !== state.currentThread?.id) return;
    applyThreadSettings(settings);
    if (state.activeTurns.has(params.threadId)) {
      els.threadMeta.textContent = t("settings.nextTurn");
    }
    return;
  }

  if (method === "item/agentMessage/delta") {
    if (params.threadId !== state.currentThread?.id) return;
    markRetryRecovered(params.turnId);
    const diagnostics = state.turnDiagnostics.get(params.threadId);
    if (diagnostics && !diagnostics.firstDeltaAt) {
      diagnostics.firstDeltaAt = performance.now();
      logTurnDebug("first-delta", params.threadId, { itemId: params.itemId });
    }
    const shouldStickToBottom = shouldStickToLiveOutput();
    let message = state.messages.find((entry) => entry.id === params.itemId);
    if (!message) {
      message = takePendingReplyMessage(params.threadId, params.itemId)
        || { role: "assistant", id: params.itemId, text: "" };
      message.liveNotification = true;
      state.messages.push(message);
    }
    if (!message.turnId) message.turnId = params.turnId || "";
    message.text += params.delta || "";
    message.pendingReply = false;
    message.streamingReply = true;
    state.lastMessageAt = currentUnixSeconds();
    streamingRenderBatcher.schedule({
      threadId: params.threadId,
      itemId: params.itemId,
      scroll: shouldStickToBottom
    });
    return;
  }

  if (method === "item/started") {
    if (params.threadId !== state.currentThread?.id) return;
    markRetryRecovered(params.turnId);
    const shouldStickToBottom = shouldStickToLiveOutput();
    const item = params.item;
    if (item?.type === "commandExecution") {
      ensureReplyProgressIndicator(params.threadId, shouldStickToBottom);
      addMessage({ role: "tool", id: item.id, text: `$ ${item.command}` }, shouldStickToBottom);
    } else if (item?.type === "fileChange") {
      ensureReplyProgressIndicator(params.threadId, shouldStickToBottom);
      addMessage({ role: "tool", id: item.id, text: t("tool.preparingFileChange") }, shouldStickToBottom);
    } else if (item?.type === "contextCompaction") {
      ensureReplyProgressIndicator(params.threadId, shouldStickToBottom);
      addMessage({
        role: "tool",
        kind: "contextCompaction",
        id: item.id,
        text: t("tool.compacting")
      }, shouldStickToBottom);
    } else if (item?.type === "imageGeneration") {
      removePendingReplyMessages(params.threadId);
      const message = messageFromItem(item);
      if (message) {
        replaceOrAppendMessage(message);
        state.lastMessageAt = currentUnixSeconds();
        renderMessages(shouldStickToBottom);
      }
    }
    return;
  }

  if (method === "item/completed") {
    if (params.threadId !== state.currentThread?.id) return;
    streamingRenderBatcher.cancel();
    const shouldStickToBottom = shouldStickToLiveOutput();
    const message = messageFromItem(params.item);
    if (!message) return;
    message.turnId = params.turnId || "";
    message.liveNotification = true;
    if (message.role === "user") {
      clearMatchingPendingUserMessage(message.text, message.images || []);
    } else if (message.role === "assistant") {
      removePendingReplyMessages(params.threadId);
      clearStreamingReply(message.id);
    } else {
      ensureReplyProgressIndicator(params.threadId, shouldStickToBottom);
    }
    replaceOrAppendMessage(message);
    state.lastMessageAt = itemTimestamp(params.item) || currentUnixSeconds();
    renderMessages(shouldStickToBottom);
    scheduleCurrentThreadSync();
    return;
  }

  if (method === "turn/started") {
    const turnId = params.turn?.id || params.turnId;
    if (params.threadId) {
      if (turnId) state.activeTurns.set(params.threadId, turnId);
      setThreadActivity(params.threadId, { type: "turn-started", turnId });
    }
    if (params.threadId === state.currentThread?.id) {
      streamingRenderBatcher.cancel();
      updateSendMode();
      const diagnostics = state.turnDiagnostics.get(params.threadId);
      if (diagnostics && !diagnostics.turnStartedAt) {
        diagnostics.turnStartedAt = performance.now();
        logTurnDebug("turn-started", params.threadId);
      }
      startReplyProgress(params.threadId);
      els.threadMeta.textContent = t("turn.working");
      addPendingReplyMessage(params.threadId, shouldStickToLiveOutput());
    }
    return;
  }

  if (method === "turn/completed") {
    const turnId = params.turn?.id || params.turnId;
    const status = params.turn?.status || "completed";
    if (
      params.threadId === state.currentThread?.id
      && state.interruptingTurnId
      && (!turnId || state.interruptingTurnId === turnId)
    ) {
      state.interruptingTurnId = null;
    }
    if (params.threadId) {
      state.activeTurns.delete(params.threadId);
      setThreadActivity(params.threadId, {
        type: "turn-completed",
        status,
        turnId,
        unread: params.threadId !== state.currentThread?.id,
        updatedAt: turnTimestamp(params.turn)
      });
      notifyTurnCompletion(params.threadId, turnId, status);
    }
    if (params.threadId === state.currentThread?.id) {
      streamingRenderBatcher.cancel();
      updateSendMode();
      if (formatStatus(params.turn?.status) === "completed") markRetryRecovered(params.turnId);
      logTurnDebug("turn-completed", params.threadId, {
        status: params.turn?.status || "done",
        turnTimestamp: turnTimestamp(params.turn)
      });
      stopReplyProgress(params.threadId);
      removePendingReplyMessages(params.threadId);
      clearStreamingReplies();
      els.threadMeta.textContent = t("turn.completed", {
        status: formatStatusLabel(params.turn?.status || "done")
      });
      state.lastMessageAt = turnTimestamp(params.turn) || state.lastMessageAt || currentUnixSeconds();
      renderMessages(shouldStickToLiveOutput());
    }
    loadThreads();
    if (params.threadId && shouldAdvanceQueueAfterTurn(status)) {
      startNextQueuedSubmission(params.threadId).catch(() => {});
    }
    return;
  }

  if (method === "account/updated" || method === "account/login/completed") {
    Promise.all([loadAccount(), loadRateLimits()]);
    return;
  }

  if (method === "account/rateLimits/updated") {
    if (params?.rateLimits || params?.rate_limits) {
      state.rateLimits = normalizeRateLimits(params);
      state.rateLimitsError = "";
      renderRateLimits();
    } else {
      loadRateLimits();
    }
    return;
  }

  if (method === "serverRequest/resolved") {
    resolveServerRequestActivity(params?.requestId);
    removeApproval(params?.requestId);
  }
}

function trackServerRequest(request, render = true) {
  if (!request?.id || (!isWebUserApproval(request?.method) && request?.method !== "mcpServer/elicitation/request")) return;
  const threadId = requestThreadId(request);
  if (!threadId) return;
  state.pendingRequestThreads.set(String(request.id), threadId);
  setThreadActivity(threadId, { type: "waiting-started" }, render);
}

function resolveServerRequestActivity(requestId, render = true) {
  const key = String(requestId || "");
  const threadId = state.pendingRequestThreads.get(key);
  if (!threadId) return;
  state.pendingRequestThreads.delete(key);
  setThreadActivity(threadId, { type: "waiting-resolved" }, render);
}

function reconcileRequestActivities(requests) {
  const incoming = new Map();
  for (const request of requests || []) {
    if (!request?.id || (!isWebUserApproval(request?.method) && request?.method !== "mcpServer/elicitation/request")) continue;
    const threadId = requestThreadId(request);
    if (threadId) incoming.set(String(request.id), threadId);
  }
  for (const requestId of [...state.pendingRequestThreads.keys()]) {
    if (!incoming.has(requestId)) resolveServerRequestActivity(requestId, false);
  }
  for (const [requestId, threadId] of incoming) {
    if (state.pendingRequestThreads.has(requestId)) continue;
    state.pendingRequestThreads.set(requestId, threadId);
    setThreadActivity(threadId, { type: "waiting-started" }, false);
  }
  renderThreads();
}

function requestThreadId(request) {
  return String(
    request?.params?.threadId
    || request?.params?.thread_id
    || request?.threadId
    || state.currentThread?.id
    || ""
  );
}

function notifyTurnCompletion(threadId, turnId, status) {
  if (!shouldNotifyCompletion({
    threadId,
    currentThreadId: state.currentThread?.id,
    turnId,
    status,
    seenKeys: state.notificationKeys
  })) return;

  const key = completionNotificationKey(threadId, turnId, status);
  state.notificationKeys.add(key);
  if (state.notificationKeys.size > 200) {
    state.notificationKeys.delete(state.notificationKeys.values().next().value);
  }
  const thread = state.threads.find((entry) => entry.id === threadId) || { id: threadId };
  const failed = !["completed", "complete", "done", "success", "succeeded"]
    .includes(String(status || "").toLowerCase());
  showToast({
    thread,
    kind: failed ? "failed" : "completed",
    title: thread.name || thread.preview || t("thread.untitled")
  });
}

let toastTimer = null;

function showToast({ thread, kind, title }) {
  if (!els.toastRegion) return;
  if (toastTimer) clearTimeout(toastTimer);
  els.toastRegion.innerHTML = "";
  const button = document.createElement("button");
  button.className = `toast-card ${kind}`;
  button.type = "button";
  button.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${kind === "failed" ? "!" : "✓"}</span>
    <span class="toast-copy">
      <strong>${escapeHtml(t(kind === "failed" ? "notification.failed" : "notification.completed"))}</strong>
      <span>${escapeHtml(title)}</span>
    </span>
    <span class="toast-action">${escapeHtml(t("notification.open"))}</span>
  `;
  button.addEventListener("click", () => {
    els.toastRegion.innerHTML = "";
    openThread(thread);
  });
  els.toastRegion.append(button);
  toastTimer = setTimeout(() => {
    button.classList.add("leaving");
    setTimeout(() => button.remove(), 220);
  }, 6000);
}

function retryStatusId(turnId) {
  return `retry-status:${turnId || "current"}`;
}

function retryErrorText(error) {
  const value = String(error?.message || error?.additionalDetails || t("retry.unknown"))
    .replace(/\s+/g, " ")
    .trim();
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function markRetryRecovered(turnId) {
  const message = state.messages.find((entry) => entry.id === retryStatusId(turnId));
  if (!message || message.kind !== "retrying") return false;
  message.kind = "retryRecovered";
  message.text = t("retry.recovered");
  return true;
}

function renderTokenUsageBadge() {
  if (!els.tokenUsageBadge) return;
  const summary = formatTokenUsageSummary(state.tokenUsage);
  if (summary && state.currentThread) {
    els.tokenUsageBadge.textContent = summary;
    els.tokenUsageBadge.classList.remove("hidden");
  } else {
    els.tokenUsageBadge.classList.add("hidden");
  }
}

function renderPlanProgressBar(planData) {
  if (!els.planPanel) return;
  if (!planData || !planData.steps || planData.steps.length === 0) {
    els.planPanel.classList.add("hidden");
    els.planPanel.innerHTML = "";
    return;
  }
  els.planPanel.classList.remove("hidden");
  const pct = planData.totalCount > 0
    ? Math.round((planData.completedCount / planData.totalCount) * 100)
    : 0;

  const stepsHtml = (planData.steps || []).map((step) => {
    let icon = "○";
    if (step.status === "completed") icon = "✓";
    else if (step.status === "in_progress") icon = "●";
    return `
      <li class="plan-step-item ${escapeHtml(step.status)}">
        <span class="plan-step-icon">${icon}</span>
        <span class="plan-step-text">${escapeHtml(step.step)}</span>
      </li>
    `;
  }).join("");

  els.planPanel.innerHTML = `
    <div class="plan-progress-header">
      <span>${escapeHtml(t("plan.progress", { completed: planData.completedCount, total: planData.totalCount }))}</span>
      <span>${pct}%</span>
    </div>
    <div class="plan-progress-track">
      <div class="plan-progress-fill" style="width: ${pct}%;"></div>
    </div>
    ${planData.explanation ? `<p class="plan-explanation" style="font-size: 12.5px; color: var(--muted); margin-bottom: 8px;">${escapeHtml(planData.explanation)}</p>` : ""}
    <ul class="plan-steps-list">
      ${stepsHtml}
    </ul>
  `;
}

function toggleSidePanel(force) {
  if (!els.taskSidePanel) return;
  state.sidePanelOpen = typeof force === "boolean" ? force : !state.sidePanelOpen;
  els.taskSidePanel.classList.toggle("hidden", !state.sidePanelOpen);
  if (els.toggleSidePanel) {
    els.toggleSidePanel.classList.toggle("active", state.sidePanelOpen);
  }
  if (state.sidePanelOpen) {
    if (state.activeSideTab === "review") {
      refreshSidePanelReview();
    } else if (state.activeSideTab === "files") {
      loadFileDirectory(state.currentFileTreePath || currentEffectiveCwd());
    } else if (state.activeSideTab === "agents") {
      renderSidePanelAgents();
    }
  }
}

function switchSideTab(tabName) {
  state.activeSideTab = tabName;
  const tabs = [
    { name: "review", btn: els.sideTabReview, panel: els.sidePanelReview },
    { name: "files", btn: els.sideTabFiles, panel: els.sidePanelFiles },
    { name: "agents", btn: els.sideTabAgents, panel: els.sidePanelAgents }
  ];
  for (const tab of tabs) {
    const isActive = tab.name === tabName;
    if (tab.btn) {
      tab.btn.classList.toggle("active", isActive);
      tab.btn.setAttribute("aria-selected", isActive ? "true" : "false");
    }
    if (tab.panel) {
      tab.panel.classList.toggle("hidden", !isActive);
    }
  }
  if (tabName === "review") {
    refreshSidePanelReview();
  } else if (tabName === "files") {
    if (!state.fileTreeEntries.length) {
      loadFileDirectory(state.currentFileTreePath || currentEffectiveCwd());
    }
  } else if (tabName === "agents") {
    renderSidePanelAgents();
  }
}

function refreshSidePanelReview() {
  if (state.currentDiff) {
    renderDiffViewer(state.currentDiff);
  } else {
    refreshGitDiff().catch(() => {});
  }
}

function renderDiffViewer(diffText) {
  state.currentDiff = diffText || "";
  if (!els.diffViewerContainer) return;
  let files = [];
  try {
    files = parseUnifiedDiff(state.currentDiff) || [];
  } catch (_) {
    files = [];
  }

  const count = files.length;
  if (els.diffCountBadge) {
    els.diffCountBadge.textContent = String(count);
    els.diffCountBadge.classList.toggle("hidden", count === 0);
  }

  if (count === 0) {
    els.diffViewerContainer.innerHTML = `<div class="side-panel-empty">${escapeHtml(t("diff.empty"))}</div>`;
    return;
  }

  els.diffViewerContainer.innerHTML = "";
  for (const file of files) {
    const card = document.createElement("div");
    card.className = "diff-file-card";
    const filePath = file.path || file.newPath || file.oldPath || "unknown";
    const addedCount = typeof file.additions === "number" ? file.additions : 0;
    const delCount = typeof file.deletions === "number" ? file.deletions : 0;

    const header = document.createElement("div");
    header.className = "diff-file-header";
    header.innerHTML = `
      <div class="diff-file-path">
        <span>📄</span>
        <span>${escapeHtml(filePath)}</span>
      </div>
      <div class="diff-file-stats">
        <span class="diff-stat-add">+${addedCount}</span>
        <span class="diff-stat-del">-${delCount}</span>
      </div>
    `;

    const body = document.createElement("div");
    body.className = "diff-file-body";

    if (state.diffViewMode === "split") {
      const table = document.createElement("table");
      table.className = "diff-split-table";
      const tbody = document.createElement("tbody");

      for (const hunk of file.hunks || []) {
        const hunkTr = document.createElement("tr");
        hunkTr.className = "diff-row hunk";
        hunkTr.innerHTML = `
          <td class="diff-split-cell hunk" colspan="2">
            <span class="diff-line-content">${escapeHtml(hunk.header || "")}</span>
          </td>
        `;
        tbody.append(hunkTr);

        let splitRows = [];
        try {
          splitRows = buildSplitDiffRows(hunk) || [];
        } catch (_) {
          splitRows = [];
        }

        for (const row of splitRows) {
          const tr = document.createElement("tr");
          tr.className = "diff-row";
          const leftTd = document.createElement("td");
          leftTd.className = `diff-split-cell ${row.left?.type || ""}`;
          leftTd.innerHTML = `
            <span class="diff-line-num">${row.left?.line ?? ""}</span>
            <span class="diff-line-content">${escapeHtml(row.left?.content ?? "")}</span>
          `;
          const rightTd = document.createElement("td");
          rightTd.className = `diff-split-cell ${row.right?.type || ""}`;
          rightTd.innerHTML = `
            <span class="diff-line-num">${row.right?.line ?? ""}</span>
            <span class="diff-line-content">${escapeHtml(row.right?.content ?? "")}</span>
          `;
          tr.append(leftTd, rightTd);
          tbody.append(tr);
        }
      }
      table.append(tbody);
      body.append(table);
    } else {
      const table = document.createElement("table");
      table.className = "diff-table";
      const tbody = document.createElement("tbody");

      for (const hunk of file.hunks || []) {
        const hunkTr = document.createElement("tr");
        hunkTr.className = "diff-row hunk";
        hunkTr.innerHTML = `
          <td class="diff-line-num">...</td>
          <td class="diff-line-content">${escapeHtml(hunk.header || "")}</td>
        `;
        tbody.append(hunkTr);

        for (const line of hunk.lines || []) {
          const tr = document.createElement("tr");
          tr.className = `diff-row ${line.type || "context"}`;
          const lineNum = line.type === "del" ? (line.oldLine ?? "") : (line.newLine ?? "");
          tr.innerHTML = `
            <td class="diff-line-num">${lineNum}</td>
            <td class="diff-line-content">${escapeHtml(line.content || "")}</td>
          `;
          tbody.append(tr);
        }
      }
      table.append(tbody);
      body.append(table);
    }

    header.addEventListener("click", () => {
      body.classList.toggle("hidden");
    });

    card.append(header, body);
    els.diffViewerContainer.append(card);
  }
}

async function refreshGitDiff() {
  const cwd = currentEffectiveCwd();
  if (!cwd) return;
  try {
    const result = await rpc("gitDiffToRemote", { cwd });
    const diff = result?.diff || (typeof result === "string" ? result : "");
    if (diff) {
      renderDiffViewer(diff);
    }
  } catch (_) {}
}

async function undoGitPatch() {
  const cwd = currentEffectiveCwd();
  if (!state.currentDiff) return;
  try {
    const res = await fetch(authenticatedUrl("/api/git/apply", state.token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cwd,
        patch: state.currentDiff,
        mode: "undo",
        threadId: state.currentThread?.id || ""
      })
    });
    if (res.ok) {
      showToast({ kind: "completed", title: t("diff.undoSuccess") });
      await refreshGitDiff();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast({ kind: "failed", title: err.error || t("diff.undoFailed") });
    }
  } catch (e) {
    showToast({ kind: "failed", title: e.message || t("diff.undoFailed") });
  }
}

async function reapplyGitPatch() {
  const cwd = currentEffectiveCwd();
  if (!state.currentDiff) return;
  try {
    const res = await fetch(authenticatedUrl("/api/git/apply", state.token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cwd,
        patch: state.currentDiff,
        mode: "apply",
        threadId: state.currentThread?.id || ""
      })
    });
    if (res.ok) {
      showToast({ kind: "completed", title: t("diff.reapplySuccess") });
      await refreshGitDiff();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast({ kind: "failed", title: err.error || t("diff.reapplyFailed") });
    }
  } catch (e) {
    showToast({ kind: "failed", title: e.message || t("diff.reapplyFailed") });
  }
}

async function startCodeReview() {
  if (!state.currentThread?.id) return;
  try {
    await rpc("review/start", {
      threadId: state.currentThread.id,
      target: { type: "uncommittedChanges" }
    });
    toggleSidePanel(true);
    switchSideTab("review");
    showToast({ kind: "completed", title: t("review.startTitle") });
  } catch (e) {
    showToast({ kind: "failed", title: e.message || t("common.failed") });
  }
}

async function loadFileDirectory(dirPath) {
  state.currentFileTreePath = dirPath || currentEffectiveCwd();
  if (els.fileTreeBreadcrumb) {
    els.fileTreeBreadcrumb.textContent = shortPath(state.currentFileTreePath);
    els.fileTreeBreadcrumb.title = state.currentFileTreePath;
  }
  if (!els.fileTreeList) return;
  els.fileTreeList.innerHTML = `<div class="side-panel-empty">${escapeHtml(t("load.opening"))}</div>`;

  try {
    const result = await rpc("fs/readDirectory", { path: state.currentFileTreePath });
    const rawEntries = result?.entries || (Array.isArray(result) ? result : []);
    const mapped = rawEntries.map((e) => ({
      name: e.fileName || e.name || "",
      isDirectory: Boolean(e.isDirectory || e.type === "directory" || e.kind === "directory"),
      ...e
    }));
    const entries = normalizeFileTreeEntries
      ? normalizeFileTreeEntries(mapped, state.currentFileTreePath)
      : mapped;
    state.fileTreeEntries = entries;
    renderFileTreeList(entries);
  } catch (err) {
    els.fileTreeList.innerHTML = `<div class="side-panel-empty">${escapeHtml(t("files.loadFailed"))}</div>`;
  }
}

function renderFileTreeList(entries) {
  if (!els.fileTreeList) return;
  els.fileTreeList.innerHTML = "";
  if (!entries || entries.length === 0) {
    els.fileTreeList.innerHTML = `<div class="side-panel-empty">${escapeHtml(t("files.empty"))}</div>`;
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = "file-tree-item";
    const isDir = entry.isDirectory || entry.type === "directory";
    item.innerHTML = `
      <span class="file-tree-icon">${isDir ? "📁" : "📄"}</span>
      <span class="file-tree-name" title="${escapeHtml(entry.path || entry.name)}">${escapeHtml(entry.name || entry.path)}</span>
    `;
    item.addEventListener("click", () => {
      if (isDir) {
        loadFileDirectory(entry.path);
      } else {
        loadFilePreview(entry.path);
      }
    });
    els.fileTreeList.append(item);
  }
}

async function loadFilePreview(filePath) {
  state.activePreviewFilePath = filePath;
  if (!els.filePreviewContainer) return;
  els.filePreviewContainer.classList.remove("hidden");
  els.filePreviewContainer.innerHTML = `
    <header class="file-preview-header">
      <span class="file-preview-name">${escapeHtml(shortPath(filePath))}</span>
      <div class="field-action-row">
        <button class="secondary-action compact-action" id="insertMentionBtn" type="button" title="${escapeHtml(t("files.insertMention"))}">
          @
        </button>
        <button class="icon-button" id="closePreviewBtn" type="button">×</button>
      </div>
    </header>
    <div class="file-preview-body">${escapeHtml(t("load.opening"))}</div>
  `;

  els.filePreviewContainer.querySelector("#insertMentionBtn")?.addEventListener("click", () => {
    insertFilePathToComposer(filePath);
  });
  els.filePreviewContainer.querySelector("#closePreviewBtn")?.addEventListener("click", () => {
    els.filePreviewContainer.classList.add("hidden");
  });

  try {
    const result = await rpc("fs/readFile", { path: filePath });
    const previewKind = classifyFilePreviewKind(filePath);
    const body = els.filePreviewContainer.querySelector(".file-preview-body");
    if (!body) return;

    let textContent = "";
    if (result?.dataBase64) {
      if (previewKind.kind === "image") {
        const mimeSub = previewKind.language === "svg" ? "svg+xml" : (previewKind.language || "png");
        body.innerHTML = `<img class="file-preview-image" src="data:image/${escapeHtml(mimeSub)};base64,${escapeHtml(result.dataBase64)}" alt="${escapeHtml(filePath)}" />`;
        return;
      }
      try {
        const binStr = atob(result.dataBase64);
        const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
        textContent = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      } catch (_) {
        textContent = result.dataBase64;
      }
    } else {
      textContent = result?.content ?? result?.data ?? result?.text ?? "";
    }

    if (previewKind.kind === "markdown") {
      body.innerHTML = renderMarkdown(textContent);
    } else {
      body.innerHTML = `<code>${escapeHtml(textContent)}</code>`;
    }
  } catch (e) {
    const body = els.filePreviewContainer.querySelector(".file-preview-body");
    if (body) body.textContent = t("files.loadFailed");
  }
}

function insertFilePathToComposer(filePath) {
  if (!els.promptInput) return;
  const currentVal = els.promptInput.value;
  const mention = `@${filePath} `;
  if (!currentVal) {
    els.promptInput.value = mention;
  } else {
    els.promptInput.value = currentVal.endsWith(" ") ? `${currentVal}${mention}` : `${currentVal} ${mention}`;
  }
  els.promptInput.focus();
}

function renderSidePanelAgents() {
  if (!els.agentsPanelContent) return;
  if (state.activePlan && state.activePlan.steps?.length) {
    const pct = state.activePlan.totalCount > 0
      ? Math.round((state.activePlan.completedCount / state.activePlan.totalCount) * 100)
      : 0;
    const stepsHtml = (state.activePlan.steps || []).map((step) => {
      let icon = "○";
      if (step.status === "completed") icon = "✓";
      else if (step.status === "in_progress") icon = "●";
      return `
        <li class="plan-step-item ${escapeHtml(step.status)}">
          <span class="plan-step-icon">${icon}</span>
          <span class="plan-step-text">${escapeHtml(step.step)}</span>
        </li>
      `;
    }).join("");

    els.agentsPanelContent.innerHTML = `
      <div class="plan-progress-panel" style="margin: 0; border: none;">
        <div class="plan-progress-header">
          <span>${escapeHtml(t("plan.progress", { completed: state.activePlan.completedCount, total: state.activePlan.totalCount }))}</span>
          <span>${pct}%</span>
        </div>
        <div class="plan-progress-track">
          <div class="plan-progress-fill" style="width: ${pct}%;"></div>
        </div>
        <ul class="plan-steps-list">
          ${stepsHtml}
        </ul>
      </div>
    `;
  } else {
    els.agentsPanelContent.innerHTML = `<div class="side-panel-empty">${escapeHtml(t("agents.empty"))}</div>`;
  }
}

function setupSidePanelResizer() {
  if (!els.sidePanelResizer || !els.taskSidePanel) return;
  let startX = 0;
  let startWidth = 0;

  const onMouseMove = (e) => {
    const delta = startX - e.clientX;
    const newWidth = Math.min(Math.max(startWidth + delta, 320), 800);
    els.taskSidePanel.style.width = `${newWidth}px`;
  };

  const onMouseUp = () => {
    els.sidePanelResizer.classList.remove("resizing");
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };

  els.sidePanelResizer.addEventListener("mousedown", (e) => {
    startX = e.clientX;
    startWidth = els.taskSidePanel.getBoundingClientRect().width;
    els.sidePanelResizer.classList.add("resizing");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

async function handlePromptInputMention() {
  if (!els.promptInput || !els.fileMentionMenu) return;
  const val = els.promptInput.value;
  const cursor = els.promptInput.selectionStart;
  const trigger = detectFileMentionTrigger ? detectFileMentionTrigger(val, cursor) : null;
  state.fileMentionTrigger = trigger;

  if (!trigger || !trigger.active) {
    els.fileMentionMenu.classList.add("hidden");
    return;
  }

  const query = trigger.query || "";
  let matches = [];
  try {
    const res = await rpc("fuzzyFileSearch", { query, roots: [currentEffectiveCwd()] });
    const rawList = res?.files || res?.matches || (Array.isArray(res) ? res : []);
    const cwd = currentEffectiveCwd().replace(/\\/g, "/").replace(/\/+$/, "");
    matches = rawList.map((item) => {
      const p = String(item.path || item.file_name || item.fileName || item);
      const normalized = p.replace(/\\/g, "/");
      let display = normalized;
      if (cwd && normalized.toLowerCase().startsWith(cwd.toLowerCase() + "/")) {
        display = normalized.slice(cwd.length + 1);
      }
      return { path: display, fullPath: p, name: item.file_name || item.fileName || display };
    });
  } catch (_) {
    matches = [];
  }

  if (!matches.length && state.fileTreeEntries.length) {
    matches = state.fileTreeEntries
      .filter((e) => !query || (e.name && e.name.toLowerCase().includes(query.toLowerCase())))
      .map((e) => ({ path: e.path, name: e.name }));
  }

  state.fileMentionItems = matches;
  state.fileMentionSelectedIndex = 0;

  if (!matches.length) {
    els.fileMentionMenu.innerHTML = `<div class="side-panel-empty">${escapeHtml(t("mention.empty"))}</div>`;
    els.fileMentionMenu.classList.remove("hidden");
    return;
  }

  renderFileMentionMenu();
}

function renderFileMentionMenu() {
  if (!els.fileMentionMenu) return;
  els.fileMentionMenu.innerHTML = "";
  els.fileMentionMenu.classList.remove("hidden");

  state.fileMentionItems.slice(0, 8).forEach((item, index) => {
    const el = document.createElement("div");
    el.className = `file-mention-item ${index === state.fileMentionSelectedIndex ? "selected" : ""}`;
    el.innerHTML = `
      <span>📄</span>
      <span class="file-mention-path">${escapeHtml(item.path || item.name || "")}</span>
    `;
    el.addEventListener("click", () => {
      applyFileMention(item.path || item.name || "");
    });
    els.fileMentionMenu.append(el);
  });
}

function applyFileMention(chosenPath) {
  if (!els.promptInput || !state.fileMentionTrigger) return;
  const val = els.promptInput.value;
  const res = insertFileMention(val, state.fileMentionTrigger, chosenPath);
  if (res && typeof res.text === "string") {
    els.promptInput.value = res.text;
    const cur = typeof res.cursor === "number" ? res.cursor : res.text.length;
    els.promptInput.setSelectionRange(cur, cur);
  } else {
    insertFilePathToComposer(chosenPath);
  }
  els.fileMentionMenu.classList.add("hidden");
  state.fileMentionTrigger = null;
  els.promptInput.focus();
}

function applyTokenRoleUi() {
  const isReadonly = state.tokenRole === "readonly";
  if (els.deleteThreadBtn) els.deleteThreadBtn.disabled = isReadonly;
  if (els.archiveThreadBtn) els.archiveThreadBtn.disabled = isReadonly;
  if (els.compactThreadBtn) els.compactThreadBtn.disabled = isReadonly;
  if (els.newThread) els.newThread.disabled = isReadonly;
  if (els.sendButton && isReadonly) els.sendButton.disabled = true;
  if (els.workspaceCreateForm) {
    els.workspaceCreateForm.classList.toggle("hidden", isReadonly);
  }
}

async function forkThreadAtTurn(turnId) {
  const current = state.currentThread;
  if (!current?.id || state.forkingThreadId || state.resumingThreadId) return;

  const threadId = current.id;
  state.forkingThreadId = threadId;
  updateLockBanner();

  try {
    const result = await rpc("thread/fork", { threadId, turnId });
    const newThread = result?.thread || result;
    if (newThread?.id) {
      state.threadLockConflict = false;
      updateLockBanner();
      await loadThreads();
      await openThread(newThread);
      addSystemMessage(t("thread.forkSuccess"));
    } else {
      throw new Error(t("thread.forkFailed"));
    }
  } catch (error) {
    addSystemMessage(error.message || t("thread.forkFailed"));
  } finally {
    state.forkingThreadId = null;
    updateLockBanner();
  }
}

async function revertThreadToTurn(turnId) {
  const current = state.currentThread;
  if (!current?.id || !turnId) return;
  if (!confirm(t("turn.revertConfirm"))) return;

  try {
    await rpc("thread/revert", { threadId: current.id, beforeTurnId: turnId, turnId });
    await scheduleCurrentThreadSync(0);
    showToast({
      kind: "completed",
      title: t("turn.revert")
    });
  } catch (error) {
    showToast({
      kind: "failed",
      title: error.message || t("common.failed")
    });
  }
}

function renderMcpElicitationRequest(request) {
  const wrap = document.createElement("div");
  wrap.className = "question-request mcp-elicitation-request";
  const params = request.params || {};
  const serverName = params.serverName || params.server || "MCP";
  const promptText = params.message || params.prompt || "";
  const schema = params.requestedSchema || params.schema || {};
  const properties = schema.properties || {};
  const requiredKeys = new Set(Array.isArray(schema.required) ? schema.required : []);

  wrap.innerHTML = `
    <div>
      <strong>${escapeHtml(serverName)}: ${escapeHtml(t("approval.mcpElicitation"))}</strong>
      ${promptText ? `<p>${escapeHtml(promptText)}</p>` : ""}
    </div>
  `;

  const form = document.createElement("form");
  form.className = "question-form";

  for (const [key, prop] of Object.entries(properties)) {
    const label = document.createElement("label");
    label.className = "question-field";
    const isRequired = requiredKeys.has(key);
    label.innerHTML = `<span>${escapeHtml(prop.title || key)}${isRequired ? " *" : ""}</span>`;
    const input = document.createElement("input");
    input.className = "field";
    input.name = key;
    input.type = prop.type === "number" || prop.type === "integer" ? "number" : "text";
    if (isRequired) input.required = true;
    if (prop.default !== undefined) input.value = prop.default;
    label.append(input);
    form.append(label);
  }

  const actions = document.createElement("div");
  actions.className = "approval-actions";
  actions.innerHTML = `
    <button class="approval-button accept" type="submit">${escapeHtml(t("common.submit"))}</button>
    <button class="approval-button decline" type="button">${escapeHtml(t("common.decline"))}</button>
  `;
  form.append(actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const content = {};
    for (const [key, prop] of Object.entries(properties)) {
      const val = data.get(key);
      content[key] = (prop.type === "number" || prop.type === "integer")
        ? (val === "" || val === null ? null : Number(val))
        : val;
    }
    await sendServerResponse(request.id, { action: "accept", content });
    removeApproval(request.id);
  });

  actions.querySelector("button[type='button']").addEventListener("click", async () => {
    await sendServerResponse(request.id, { action: "decline", content: null });
    removeApproval(request.id);
  });

  wrap.append(form);
  return wrap;
}

function renderApprovals(requests) {
  const current = [...els.approvalPanel.querySelectorAll("[data-request-id]")]
    .map((node) => node.dataset.requestId);

  for (const request of requests) {
    if (!isWebUserApproval(request?.method) && request?.method !== "mcpServer/elicitation/request") continue;
    if (!request?.id || current.includes(String(request.id))) continue;
    const card = document.createElement("div");
    card.className = "approval-card";
    card.dataset.requestId = request.id;
    if (request.method === "item/tool/requestUserInput") {
      card.append(renderQuestionRequest(request));
    } else if (request.method === "mcpServer/elicitation/request") {
      card.append(renderMcpElicitationRequest(request));
    } else {
      const decisions = buildApprovalDecisions(request);
      const buttonsHtml = decisions.map((d) => `
        <button class="approval-button ${d.id === "decline" ? "decline" : "accept"}" data-decision-id="${escapeHtml(d.id)}">${escapeHtml(t(d.labelKey))}</button>
      `).join("");

      card.innerHTML = `
        <div>
          <strong>${approvalTitle(request.method)}</strong>
          <p>${escapeHtml(approvalText(request))}</p>
        </div>
        <div class="approval-actions">
          ${buttonsHtml}
        </div>
      `;
      card.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", async () => {
          const decisionId = button.dataset.decisionId;
          const found = decisions.find((d) => d.id === decisionId);
          if (found) {
            await respondApproval(request, found);
            removeApproval(request.id);
          }
        });
      });
    }
    els.approvalPanel.append(card);
  }

  els.approvalPanel.classList.toggle("hidden", !els.approvalPanel.children.length);
}

async function respondApproval(request, decisionOrOption) {
  if (decisionOrOption && typeof decisionOrOption === "object" && decisionOrOption.responsePayload) {
    await sendServerResponse(request.id, decisionOrOption.responsePayload);
    return;
  }

  if (request?.method === "item/permissions/requestApproval") {
    if (decisionOrOption === "acceptForSession") {
      await sendServerResponse(request.id, {
        permissions: request.params?.permissions || {},
        scope: "session"
      });
    } else if (decisionOrOption === "accept") {
      await sendServerResponse(request.id, {
        permissions: request.params?.permissions || {},
        scope: "turn"
      });
    } else {
      await sendServerResponse(request.id, { permissions: {} });
    }
    return;
  }

  const payload = (decisionOrOption && typeof decisionOrOption === "object" && "decision" in decisionOrOption)
    ? decisionOrOption
    : { decision: decisionOrOption };
  await sendServerResponse(request.id, payload);
}

function renderQuestionRequest(request) {
  const wrap = document.createElement("div");
  wrap.className = "question-request";
  const questions = request.params?.questions || [];
  wrap.innerHTML = `
    <div>
      <strong>${approvalTitle(request.method)}</strong>
      <p>${questions.map((question) => escapeHtml(question.question)).join("<br>")}</p>
    </div>
  `;

  const form = document.createElement("form");
  form.className = "question-form";
  for (const question of questions) {
    const label = document.createElement("div");
    label.className = "question-field";
    label.innerHTML = `<span class="question-header">${escapeHtml(question.header || question.id)}</span>`;
    if (question.options?.length) {
      const group = document.createElement("div");
      group.className = "question-radio-group";
      question.options.forEach((option, idx) => {
        const radioCard = document.createElement("label");
        radioCard.className = "question-radio-card";
        radioCard.innerHTML = `
          <input type="radio" name="${escapeHtml(question.id)}" value="${escapeHtml(option.label)}" ${idx === 0 ? "checked" : ""}>
          <div class="question-radio-content">
            <span class="question-radio-title">${escapeHtml(option.label)}</span>
            ${option.description ? `<span class="question-radio-desc">${escapeHtml(option.description)}</span>` : ""}
          </div>
        `;
        group.append(radioCard);
      });

      const otherCard = document.createElement("label");
      otherCard.className = "question-radio-card question-other-card";
      otherCard.innerHTML = `
        <input type="radio" name="${escapeHtml(question.id)}" value="__other__">
        <div class="question-radio-content">
          <span class="question-radio-title">${escapeHtml(t("question.otherOption"))}</span>
        </div>
      `;
      group.append(otherCard);

      const otherWrap = document.createElement("div");
      otherWrap.className = "question-other-wrap";
      otherWrap.innerHTML = `
        <input class="question-other-input field" name="other:${escapeHtml(question.id)}" placeholder="${escapeHtml(t("question.otherPlaceholder"))}" />
      `;
      group.append(otherWrap);

      label.append(group);
    } else {
      const input = document.createElement("input");
      input.className = "field";
      input.name = question.id;
      input.type = question.isSecret ? "password" : "text";
      label.append(input);
    }
    form.append(label);
  }

  const actions = document.createElement("div");
  actions.className = "approval-actions";
  actions.innerHTML = `
    <button class="approval-button accept" type="submit">${escapeHtml(t("common.submit"))}</button>
    <button class="approval-button decline" type="button">${escapeHtml(t("common.skip"))}</button>
  `;
  form.append(actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const answers = collectQuestionAnswers(questions, new FormData(form));
    await sendServerResponse(request.id, { answers });
    removeApproval(request.id);
  });

  actions.querySelector("button[type='button']").addEventListener("click", async () => {
    await sendServerResponse(request.id, { answers: {} });
    removeApproval(request.id);
  });

  wrap.append(form);
  return wrap;
}

function removeApproval(id) {
  const node = els.approvalPanel.querySelector(`[data-request-id="${CSS.escape(String(id))}"]`);
  node?.remove();
  els.approvalPanel.classList.toggle("hidden", !els.approvalPanel.children.length);
}

function approvalTitle(method) {
  if (method === "item/commandExecution/requestApproval") return t("approval.command");
  if (method === "item/fileChange/requestApproval") return t("approval.fileChange");
  if (method === "item/tool/requestUserInput") return t("approval.input");
  if (method === "mcpServer/elicitation/request") return t("approval.mcpElicitation");
  return t("approval.default");
}

function approvalText(request) {
  const params = request.params || {};
  if (params.command) return `${params.cwd || ""}\n${params.command}`;
  if (params.reason) return params.reason;
  if (params.grantRoot) return t("approval.grantRoot", { path: params.grantRoot });
  return request.method;
}

function rpc(method, params, options = {}) {
  return new Promise((resolve, reject) => {
    const requestId = state.nextRequestId++;
    const payload = { type: "rpc", requestId, method, params };
    const data = JSON.stringify(payload);
    const startedAt = performance.now();
    state.pending.set(requestId, {
      resolve,
      reject,
      method,
      label: options.label || method,
      traffic: options.traffic || null,
      startedAt,
      bytesOut: byteLengthText(data)
    });
    logRpcDebug("send", { requestId, method, bytesOut: byteLengthText(data), params });
    state.ws.send(data);
  });
}

function sendServerResponse(id, result) {
  return new Promise((resolve, reject) => {
    const requestId = state.nextRequestId++;
    state.pending.set(requestId, { resolve, reject });
    state.ws.send(JSON.stringify({ type: "server-response", requestId, id, result }));
  });
}

function createThreadLoadStats(threadId, thread, seq) {
  return {
    threadId,
    seq,
    phase: t("load.openThread"),
    startedAt: performance.now(),
    finishedAt: null,
    totalIn: 0,
    totalOut: 0,
    steps: [],
    messageCount: 0,
    itemCount: 0,
    renderMs: 0,
    title: thread?.name || thread?.preview || t("load.currentThread")
  };
}

function updateThreadLoadPhase(stats, phase) {
  if (!stats) return;
  stats.phase = phase;
  if (shouldRenderThreadLoadOverlay(stats) && stats.seq === state.threadLoadSeq) {
    renderThreadLoading(state.currentThread, stats);
  }
}

function recordTrafficStep(pending, bytesIn, error) {
  const stats = pending.traffic;
  if (!stats) return;

  const elapsedMs = performance.now() - pending.startedAt;
  stats.totalOut += pending.bytesOut;
  stats.totalIn += bytesIn;
  stats.steps.push({
    label: pending.label,
    out: pending.bytesOut,
    in: bytesIn,
    ms: elapsedMs,
    failed: Boolean(error)
  });
  updateTrafficSummary(stats);

  if (shouldRenderThreadLoadOverlay(stats) && stats.seq === state.threadLoadSeq && state.loadingThreadId === stats.threadId) {
    renderThreadLoading(state.currentThread, stats);
  }
}

function logRpcDebug(event, detail) {
  const elapsedMs = Number(detail.elapsedMs || 0);
  const slow = event !== "send" && elapsedMs > slowRpcThresholdMs(detail.method);
  const logger = slow || event === "error" ? console.warn : console.debug;
  logger.call(console, "[codex-webui:rpc]", {
    event,
    requestId: detail.requestId,
    method: detail.method,
    elapsedMs: event === "send" ? undefined : Math.round(elapsedMs),
    bytesOut: detail.bytesOut,
    bytesIn: detail.bytesIn,
    slow,
    error: detail.error || undefined,
    params: event === "send" ? summarizeRpcPayload(detail.params) : undefined,
    result: event === "send" ? undefined : summarizeRpcPayload(detail.result)
  });
}

function slowRpcThresholdMs(method) {
  if (["turn/start", "turn/steer", "thread/read", "thread/turns/list"].includes(method)) return 5000;
  return 2000;
}

function summarizeRpcPayload(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return { type: "array", length: value.length };
  const summary = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/token/i.test(key)) {
      summary[key] = "[redacted]";
    } else if (key === "input" && Array.isArray(raw)) {
      summary[key] = raw.map((item) => summarizeInputItem(item));
    } else if (key === "data" && Array.isArray(raw)) {
      summary[key] = { type: "array", length: raw.length };
    } else if (key === "thread" && raw && typeof raw === "object") {
      summary[key] = summarizeThread(raw);
    } else if (typeof raw === "string") {
      summary[key] = raw.length > 160 ? `${raw.slice(0, 160)}...(${raw.length})` : raw;
    } else if (Array.isArray(raw)) {
      summary[key] = { type: "array", length: raw.length };
    } else if (raw && typeof raw === "object") {
      summary[key] = Object.fromEntries(Object.entries(raw).slice(0, 8));
    } else {
      summary[key] = raw;
    }
  }
  return summary;
}

function summarizeInputItem(item) {
  if (!item || typeof item !== "object") return item;
  if (item.type === "text") {
    const text = String(item.text || "");
    return { type: "text", chars: text.length, preview: text.slice(0, 80) };
  }
  if (item.type === "localImage") return { type: "localImage", path: shortPath(item.path) };
  return { type: item.type || "unknown" };
}

function summarizeThread(thread) {
  return {
    id: thread.id,
    cwd: thread.cwd,
    name: thread.name,
    status: formatStatus(thread.status)
  };
}

function logTurnDebug(event, threadId, extra = {}) {
  const diagnostics = state.turnDiagnostics.get(threadId);
  if (!diagnostics) {
    console.debug("[codex-webui:turn]", { event, threadId, ...extra });
    return;
  }

  const now = performance.now();
  const elapsedMs = Math.round(now - diagnostics.startedAt);
  const firstDeltaMs = diagnostics.firstDeltaAt
    ? Math.round(diagnostics.firstDeltaAt - diagnostics.startedAt)
    : null;
  const turnStartedMs = diagnostics.turnStartedAt
    ? Math.round(diagnostics.turnStartedAt - diagnostics.startedAt)
    : null;
  const turnStartRpcDoneMs = diagnostics.turnStartRpcDoneAt
    ? Math.round(diagnostics.turnStartRpcDoneAt - diagnostics.startedAt)
    : null;

  const payload = {
    event,
    id: diagnostics.id,
    threadId,
    elapsedMs,
    turnStartedMs,
    turnStartRpcDoneMs,
    firstDeltaMs,
    textChars: diagnostics.textChars,
    imageCount: diagnostics.imageCount,
    ...extra
  };
  const logger = elapsedMs > 10000 && event !== "send-begin" ? console.warn : console.info;
  logger.call(console, "[codex-webui:turn]", payload);

  if (event === "turn-completed") {
    state.turnDiagnostics.delete(threadId);
  }
}

function settleRequest(requestId, error, result, bytesIn = 0) {
  const pending = state.pending.get(requestId);
  if (!pending) return;
  state.pending.delete(requestId);
  recordTrafficStep(pending, bytesIn, error);
  logRpcDebug(error ? "error" : "result", {
    requestId,
    method: pending.method,
    elapsedMs: performance.now() - pending.startedAt,
    bytesOut: pending.bytesOut,
    bytesIn,
    error: error?.message || "",
    result
  });
  if (error) pending.reject(error);
  else pending.resolve(result);
}

function rejectPendingRequests(error) {
  for (const [requestId, pending] of state.pending.entries()) {
    state.pending.delete(requestId);
    recordTrafficStep(pending, 0, error);
    pending.reject(error);
  }
}

function addMessage(message, scroll = true) {
  state.messages.push(message);
  renderMessages(scroll);
}

function replaceOrAppendMessage(message) {
  const index = state.messages.findIndex((entry) => entry.id && entry.id === message.id);
  if (index >= 0) {
    state.messages[index] = message;
    return;
  }
  const aliasIndex = findTransientMessageAliasIndex(state.messages, message);
  if (aliasIndex >= 0) {
    state.messages[aliasIndex] = message;
    return;
  }
  state.messages.push(message);
}

function addPendingReplyMessage(threadId, scroll = true) {
  if (!threadId) return;
  startReplyProgress(threadId);
  if (state.messages.some((message) => message.pendingReply && message.threadId === threadId)) return;
  addMessage({
    role: "assistant",
    id: `pending-reply-${threadId}-${Date.now()}`,
    threadId,
    text: "",
    pendingReply: true
  }, scroll);
}

function ensureReplyProgressIndicator(threadId, scroll = true) {
  if (!threadId) return;
  startReplyProgress(threadId);
  const hasStreamingReply = state.messages.some((message) =>
    message.role === "assistant" && message.streamingReply
  );
  if (hasStreamingReply) return;
  addPendingReplyMessage(threadId, scroll);
}

function startReplyProgress(threadId) {
  if (threadId) state.replyProgressThreadIds.add(threadId);
  updateSendMode();
  if (threadId === state.currentThread?.id) scheduleCurrentThreadSync();
}

function reconcileApprovals(requests) {
  const supported = (requests || []).filter((request) => isWebUserApproval(request?.method) || request?.method === "mcpServer/elicitation/request");
  const pendingIds = new Set(supported.map((request) => String(request?.id || "")));
  for (const node of els.approvalPanel.querySelectorAll("[data-request-id]")) {
    if (!pendingIds.has(String(node.dataset.requestId || ""))) node.remove();
  }
  renderApprovals(supported);
  els.approvalPanel.classList.toggle("hidden", !els.approvalPanel.children.length);
}

function stopReplyProgress(threadId) {
  if (threadId) state.replyProgressThreadIds.delete(threadId);
  updateSendMode();
  if (threadId === state.currentThread?.id) scheduleCurrentThreadSync(0);
}

function takePendingReplyMessage(threadId, id) {
  const index = state.messages.findIndex((message) =>
    message.pendingReply && (!threadId || message.threadId === threadId)
  );
  if (index < 0) return null;
  const [message] = state.messages.splice(index, 1);
  return {
    ...message,
    id,
    text: "",
    pendingReply: false
  };
}

function removePendingReplyMessages(threadId) {
  state.messages = state.messages.filter((message) =>
    !message.pendingReply || (threadId && message.threadId !== threadId)
  );
}

function clearStreamingReply(id) {
  if (!id) return;
  const message = state.messages.find((entry) => entry.id === id);
  if (message) message.streamingReply = false;
}

function clearStreamingReplies() {
  for (const message of state.messages) {
    message.streamingReply = false;
  }
}

function clearMatchingPendingUserMessage(text, images = []) {
  const normalizedText = normalizeMessageText(text);
  const normalizedImages = normalizeMessageImages(images);
  const index = state.messages.findIndex((message) =>
    message.pendingLocal
    && message.role === "user"
    && normalizeMessageText(message.text) === normalizedText
    && normalizeMessageImages(message.images || []) === normalizedImages
  );
  if (index >= 0) {
    state.messages.splice(index, 1);
  }
}

function normalizeMessageText(text) {
  return String(text || "").trim();
}

function normalizeMessageImages(images) {
  return (images || [])
    .map((image) => typeof image === "string" ? image : image?.source || image?.id || "")
    .filter(Boolean)
    .join("\n");
}

function addSystemMessage(text, scroll = true) {
  addMessage({ role: "system", text }, scroll);
}

function isMessagesNearBottom(threshold = 96) {
  if (!els.messages) return true;
  const remaining = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
  return remaining <= threshold;
}

function shouldStickToLiveOutput() {
  return state.followLiveOutput && isMessagesNearBottom();
}

function scrollMessagesToBottom() {
  if (!els.messages) return;
  els.messages.scrollTop = els.messages.scrollHeight;
  requestAnimationFrame(() => {
    els.messages.scrollTop = els.messages.scrollHeight;
  });
}

function entryKey(entry) {
  if (entry.type === "toolGroup") {
    const ids = (entry.messages || []).map((m) => m?.id || "").filter(Boolean);
    return `tg:${ids.join(",") || "empty"}`;
  }
  const msg = entry.message;
  if (!msg) return "";
  if (msg.id) return `msg:${msg.id}`;
  if (msg.pendingReply) return `pending:${msg.threadId || "reply"}`;
  return `msg:tmp_${msg.role}_${msg.turnId || ""}_${String(msg.text || "").slice(0, 20)}`;
}

function renderEntryNode(entry) {
  let node;
  if (entry.type === "toolGroup") {
    node = renderToolGroup(entry.messages);
  } else {
    node = renderMessage(entry.message);
  }
  if (node) {
    node.dataset.entryKey = entryKey(entry);
    if (entry.type === "message" && entry.message?.id) {
      node.dataset.messageId = String(entry.message.id);
    }
  }
  return node;
}

function reconcileMessageStream(stream) {
  const newEntries = groupMessagesForDisplay(state.messages);
  const newKeys = newEntries.map(entryKey);

  const existingNodes = Array.from(stream.children).filter(
    (node) => !node.classList.contains("reply-progress-footer")
  );
  const existingKeys = existingNodes.map((n) => n.dataset.entryKey || "");

  if (newKeys.length === existingKeys.length && newKeys.every((k, i) => k === existingKeys[i])) {
    if (newEntries.length > 0) {
      const lastIndex = newEntries.length - 1;
      const updatedNode = renderEntryNode(newEntries[lastIndex]);
      existingNodes[lastIndex].replaceWith(updatedNode);
    }
  } else if (
    newKeys.length > existingKeys.length
    && existingKeys.every((k, i) => k === newKeys[i])
  ) {
    if (existingNodes.length > 0) {
      const lastPrevIndex = existingNodes.length - 1;
      const updatedPrevNode = renderEntryNode(newEntries[lastPrevIndex]);
      existingNodes[lastPrevIndex].replaceWith(updatedPrevNode);
    }
    const footer = stream.querySelector(".reply-progress-footer");
    for (let i = existingKeys.length; i < newEntries.length; i++) {
      const newNode = renderEntryNode(newEntries[i]);
      if (footer) stream.insertBefore(newNode, footer);
      else stream.append(newNode);
    }
  } else if (
    newKeys.length > existingKeys.length
    && existingKeys.every((k, i) => k === newKeys[i + (newKeys.length - existingKeys.length)])
  ) {
    const prependCount = newKeys.length - existingKeys.length;
    const firstExisting = existingNodes[0];
    for (let i = 0; i < prependCount; i++) {
      const newNode = renderEntryNode(newEntries[i]);
      if (firstExisting) stream.insertBefore(newNode, firstExisting);
      else stream.append(newNode);
    }
  } else {
    const existingNodeMap = new Map();
    for (const node of existingNodes) {
      const key = node.dataset.entryKey;
      if (key) existingNodeMap.set(key, node);
    }
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < newEntries.length; i++) {
      const entry = newEntries[i];
      const key = entryKey(entry);
      const isLast = (i === newEntries.length - 1);
      let node;
      if (existingNodeMap.has(key) && !isLast) {
        node = existingNodeMap.get(key);
        existingNodeMap.delete(key);
      } else {
        node = renderEntryNode(entry);
      }
      fragment.append(node);
    }
    for (const unused of existingNodeMap.values()) {
      unused.remove();
    }
    const footer = stream.querySelector(".reply-progress-footer");
    stream.innerHTML = "";
    stream.append(fragment);
    if (footer) stream.append(footer);
  }

  const shouldHaveFooter = Boolean(
    state.currentThread?.id && state.replyProgressThreadIds.has(state.currentThread.id)
  );
  const currentFooter = stream.querySelector(".reply-progress-footer");
  if (shouldHaveFooter && !currentFooter) {
    const footer = renderReplyProgressFooter();
    if (footer) stream.append(footer);
  } else if (!shouldHaveFooter && currentFooter) {
    currentFooter.remove();
  }
}

function renderMessages(scroll = true) {
  if (!state.messages.length) {
    updateTrafficSummary();
    renderEmpty(t("empty.newTitle"), t("empty.newDescription"));
    if (els.messages) els.messages.dataset.renderedThreadId = "";
    return;
  }

  const currentThreadId = String(state.currentThread?.id || "");
  const isDifferentThread = els.messages.dataset.renderedThreadId !== currentThreadId;
  els.messages.dataset.renderedThreadId = currentThreadId;

  let stream = els.messages.querySelector(".message-stream");
  const preservedTop = els.messages.scrollTop;

  if (isDifferentThread || !stream || els.messages.querySelector(".empty-state") || els.messages.querySelector(".thread-loading")) {
    els.messages.innerHTML = "";
    const historyLoader = renderHistoryLoader();
    if (historyLoader) els.messages.append(historyLoader);

    stream = document.createElement("div");
    stream.className = "message-stream";
    for (const entry of groupMessagesForDisplay(state.messages)) {
      const node = renderEntryNode(entry);
      if (node) stream.append(node);
    }
    const progressFooter = renderReplyProgressFooter();
    if (progressFooter) stream.append(progressFooter);
    els.messages.append(stream);

    const lastMessageTime = renderLastMessageTime();
    if (lastMessageTime) els.messages.append(lastMessageTime);

    if (scroll) scrollMessagesToBottom();
    else els.messages.scrollTop = preservedTop;
    updateTrafficSummary();
    return;
  }

  reconcileMessageStream(stream);

  const existingLoader = els.messages.querySelector(".history-loader");
  if (state.loadingOlderTurns && !existingLoader) {
    const loader = renderHistoryLoader();
    if (loader) els.messages.prepend(loader);
  } else if (!state.loadingOlderTurns && existingLoader) {
    existingLoader.remove();
  }

  const existingTime = els.messages.querySelector(".last-message-time");
  if (state.lastMessageAt) {
    const timeText = t("lastMessage", { time: formatDateTime(state.lastMessageAt) });
    if (existingTime) {
      existingTime.textContent = timeText;
    } else {
      const node = renderLastMessageTime();
      if (node) els.messages.append(node);
    }
  } else if (existingTime) {
    existingTime.remove();
  }

  if (scroll) {
    scrollMessagesToBottom();
  } else {
    els.messages.scrollTop = preservedTop;
  }
  updateTrafficSummary();
}

function renderLastMessageTime() {
  if (!state.lastMessageAt) return null;
  const node = document.createElement("div");
  node.className = "last-message-time";
  node.textContent = t("lastMessage", { time: formatDateTime(state.lastMessageAt) });
  return node;
}

function renderReplyProgressFooter() {
  if (!state.currentThread?.id || !state.replyProgressThreadIds.has(state.currentThread.id)) return null;
  const item = document.createElement("article");
  item.className = "message assistant reply-progress-footer";
  item.innerHTML = `
    <div class="message-label">${labelFor("assistant")}</div>
    <div class="bubble markdown"><span class="reply-dots" aria-label="${escapeHtml(t("turn.replying"))}"></span></div>
  `;
  return item;
}

function groupMessagesForDisplay(messages) {
  const groups = [];
  let toolGroup = [];

  const flushTools = () => {
    if (!toolGroup.length) return;
    groups.push({ type: "toolGroup", messages: toolGroup });
    toolGroup = [];
  };

  for (const message of messages) {
    if (message.pendingReply) continue;
    if (message.role === "tool") {
      if (["retrying", "retryRecovered", "retryFailed", "contextCompaction"].includes(message.kind)) {
        flushTools();
        groups.push({ type: "toolGroup", messages: [message] });
        continue;
      }
      toolGroup.push(message);
    } else {
      flushTools();
      groups.push({ type: "message", message });
    }
  }
  flushTools();
  return groups;
}

function renderMessage(message) {
  if (message.kind === "reasoning") return renderReasoningMessage(message);
  if (message.kind === "automationHeartbeat") return renderAutomationHeartbeat(message);
  const item = document.createElement("article");
  const hasImages = Boolean(message.images?.length);
  const generationClass = message.imageGeneration?.pending ? " image-generation-pending" : "";
  const pendingClass = message.pendingReply ? " pending-reply" : "";
  const streamingClass = message.streamingReply ? " streaming-reply" : "";
  item.className = `message ${message.role}${hasImages ? " has-images" : ""}${generationClass}${pendingClass}${streamingClass}`;
  if (message.id) item.dataset.messageId = String(message.id);
  const bubbleClass = message.role === "tool" ? "bubble plain" : "bubble markdown";

  let rawText = message.text || "";
  let planCardHtml = "";
  if (message.role === "assistant") {
    const planInfo = extractProposedPlan(rawText);
    if (planInfo.hasPlan) {
      rawText = planInfo.cleanedText;
      const planMarkdownHtml = renderMarkdown(planInfo.planMarkdown);
      planCardHtml = `
        <div class="proposed-plan-card" data-plan-title="${escapeHtml(planInfo.title)}">
          <div class="proposed-plan-header">
            <div class="proposed-plan-title-wrap">
              <span class="proposed-plan-badge">PLAN</span>
              <span class="proposed-plan-title">${escapeHtml(planInfo.title || t("plan.cardTitle"))}</span>
            </div>
          </div>
          <div class="proposed-plan-body">${planMarkdownHtml}</div>
          <div class="proposed-plan-actions">
            <button class="execute-plan-btn" type="button">
              <span>▶</span> ${escapeHtml(t("plan.executeAndSwitch"))}
            </button>
          </div>
        </div>
      `;
    }
  }

  const hasText = Boolean(String(rawText || "").trim());
  const body = message.role === "tool"
    ? escapeHtml(rawText || "")
    : renderMarkdown(rawText || "");
  const generation = renderImageGenerationStatus(message.imageGeneration);
  const images = renderMessageImages(message.images || []);
  const bubble = (hasText || !planCardHtml) ? `<div class="${bubbleClass}">${body}</div>` : "";

  let turnActionsHtml = "";
  if (message.turnId && (message.role === "user" || message.role === "assistant") && !message.pendingReply) {
    turnActionsHtml = `
      <div class="message-turn-actions">
        <button class="turn-action-btn fork" type="button" data-turn-id="${escapeHtml(message.turnId)}" title="${escapeHtml(t("turn.fork"))}">
          <span>🌿</span> ${escapeHtml(t("turn.fork"))}
        </button>
        <button class="turn-action-btn revert" type="button" data-turn-id="${escapeHtml(message.turnId)}" title="${escapeHtml(t("turn.revert"))}">
          <span>⏪</span> ${escapeHtml(t("turn.revert"))}
        </button>
      </div>
    `;
  }

  item.innerHTML = `
    <div class="message-label">${labelFor(message.role)}</div>
    ${generation}
    ${images}
    ${bubble}
    ${planCardHtml}
    ${turnActionsHtml}
  `;

  const executeBtn = item.querySelector(".execute-plan-btn");
  if (executeBtn) {
    executeBtn.addEventListener("click", async () => {
      executeBtn.disabled = true;
      executeBtn.textContent = t("plan.executing");
      state.collaborationMode = "default";
      if (els.collaborationModeSelect) els.collaborationModeSelect.value = "default";
      if (els.planModeToggle) els.planModeToggle.classList.remove("active");
      await persistSelectedThreadSettings();
      await sendTurn(t("plan.executePrompt"));
    });
  }

  const forkBtn = item.querySelector(".turn-action-btn.fork");
  if (forkBtn) {
    forkBtn.addEventListener("click", () => {
      forkThreadAtTurn(message.turnId);
    });
  }

  const revertBtn = item.querySelector(".turn-action-btn.revert");
  if (revertBtn) {
    revertBtn.addEventListener("click", () => {
      revertThreadToTurn(message.turnId);
    });
  }

  bindImagePlaceholders(item);
  bindMarkdownImages(item);
  return item;
}

function patchStreamingMessage(message, scroll) {
  if (!message?.id) return false;

  if (message.kind === "reasoning") {
    const item = Array.from(els.messages.querySelectorAll("[data-message-id]"))
      .find((node) => node.dataset.messageId === String(message.id));
    if (!item) return false;
    const parts = message.reasoningParts?.length ? message.reasoningParts : [message.text || ""].filter(Boolean);
    const countText = t("reasoning.count", { count: parts.length });
    const countEl = item.querySelector(".reasoning-summary-count");
    if (countEl) countEl.textContent = countText;
    const partsList = item.querySelector(".reasoning-parts");
    if (partsList) {
      partsList.innerHTML = parts.map((part) => `<li>${renderMarkdown(part)}</li>`).join("");
    }
    bindImagePlaceholders(item);
    bindMarkdownImages(item);
    if (scroll) scrollMessagesToBottom();
    return true;
  }

  if (message.role === "tool") {
    const item = Array.from(els.messages.querySelectorAll("[data-message-id]"))
      .find((node) => node.dataset.messageId === String(message.id));
    if (!item) return false;
    const bubble = item.querySelector(".bubble.plain, .bubble");
    if (bubble) {
      bubble.textContent = message.text || "";
      if (scroll) scrollMessagesToBottom();
      return true;
    }
    return false;
  }

  if (message.role === "assistant" && !message.kind) {
    let item = Array.from(els.messages.querySelectorAll("[data-message-id]"))
      .find((node) => node.dataset.messageId === String(message.id));

    if (!item) {
      const pendingNode = els.messages.querySelector(".message.assistant.pending-reply");
      if (pendingNode) {
        pendingNode.dataset.messageId = String(message.id);
        pendingNode.classList.remove("pending-reply");
        item = pendingNode;
      } else {
        return false;
      }
    }

    let bubble = item.querySelector(".bubble.markdown");
    if (!bubble) {
      bubble = item.querySelector(".bubble");
      if (bubble) bubble.className = "bubble markdown";
    }
    if (!bubble) return false;

    let rawText = message.text || "";
    const planInfo = extractProposedPlan(rawText);
    if (planInfo.hasPlan) {
      const newItem = renderMessage(message);
      item.replaceWith(newItem);
      if (scroll) scrollMessagesToBottom();
      return true;
    }

    bubble.innerHTML = renderMarkdown(rawText);
    item.classList.toggle("streaming-reply", Boolean(message.streamingReply));
    bindImagePlaceholders(item);
    bindMarkdownImages(item);
    if (scroll) scrollMessagesToBottom();
    return true;
  }

  return false;
}

function renderAutomationHeartbeat(message) {
  const heartbeat = message.automationHeartbeat || parseAutomationHeartbeat(message.text);
  if (!heartbeat) return renderMessage({ ...message, kind: undefined });

  const item = document.createElement("article");
  item.className = "message system automation-heartbeat-message";
  const time = formatAutomationTime(heartbeat.currentTimeIso);
  const fullTime = formatAutomationDateTime(heartbeat.currentTimeIso);
  const instructions = heartbeat.instructions
    ? `<pre>${escapeHtml(heartbeat.instructions)}</pre>`
    : `<p>${escapeHtml(t("automation.noInstructions"))}</p>`;
  item.innerHTML = `
    <details>
      <summary>
        <span class="automation-heartbeat-pulse" aria-hidden="true"></span>
        <span class="automation-heartbeat-heading">
          <strong>${escapeHtml(t("automation.heartbeat"))}</strong>
          ${heartbeat.automationId ? `<small>${escapeHtml(heartbeat.automationId)}</small>` : ""}
        </span>
        ${time ? `<time datetime="${escapeHtml(heartbeat.currentTimeIso)}" title="${escapeHtml(fullTime)}">${escapeHtml(time)}</time>` : ""}
        <span class="automation-heartbeat-chevron" aria-hidden="true">›</span>
      </summary>
      <div class="automation-heartbeat-body">${instructions}</div>
    </details>
  `;
  bindDisclosureState(
    item.querySelector("details"),
    disclosureKey("automation", message, heartbeat.automationId || heartbeat.currentTimeIso)
  );
  return item;
}

function renderReasoningMessage(message) {
  const item = document.createElement("article");
  item.className = "message system reasoning-message";
  if (message.id) item.dataset.messageId = String(message.id);
  const parts = message.reasoningParts?.length ? message.reasoningParts : [message.text || ""].filter(Boolean);
  const countText = t("reasoning.count", { count: parts.length });
  const title = t("reasoning.process");
  const renderedParts = parts.map((part) => `<li>${renderMarkdown(part)}</li>`).join("");
  item.innerHTML = `
    <details>
      <summary title="${escapeHtml(t("reasoning.explainer"))}">
        <span class="reasoning-chevron" aria-hidden="true">›</span>
        <span class="reasoning-summary-title">${escapeHtml(title)}</span>
        <span class="reasoning-summary-count">${escapeHtml(countText)}</span>
      </summary>
      <div class="bubble markdown reasoning-body">
        <p class="reasoning-explainer">${escapeHtml(t("reasoning.explainer"))}</p>
        <ol class="reasoning-parts">${renderedParts}</ol>
      </div>
    </details>
  `;
  bindDisclosureState(item.querySelector("details"), disclosureKey("reasoning", message, title));
  bindImagePlaceholders(item);
  bindMarkdownImages(item);
  return item;
}

function renderImageGenerationStatus(state) {
  if (!state || (!state.pending && !state.failed)) return "";
  if (state.failed) {
    const detail = state.detail ? `<small>${escapeHtml(state.detail)}</small>` : "";
    return `
      <div class="image-generation-status failed" role="status">
        <span class="image-generation-mark" aria-hidden="true">!</span>
        <div>
          <strong>${escapeHtml(t("image.generationFailed"))}</strong>
          ${detail}
        </div>
      </div>
    `;
  }
  return `
    <div class="image-generation-status" role="status" aria-live="polite">
      <span class="mini-spinner" aria-hidden="true"></span>
      <div>
        <strong>${escapeHtml(t("image.generating"))}</strong>
        <small>${escapeHtml(t("image.generationDescription"))}</small>
      </div>
    </div>
  `;
}

function renderToolGroup(messages) {
  const item = document.createElement("article");
  item.className = "message tool compact-tool-group";
  const ids = messages.map((m) => m?.id || "").filter(Boolean);
  item.dataset.toolGroupIds = ids.join(",");
  const title = toolGroupTitle(messages);
  const details = messages.map((message, index) => {
    const text = String(message.text || "").trim();
    return `<pre>${escapeHtml(`${index + 1}. ${text}`)}</pre>`;
  }).join("");
  item.innerHTML = `
    <details>
      <summary>
        <span class="tool-summary-icon">▣</span>
        <span>${escapeHtml(title)}</span>
      </summary>
      <div class="tool-group-details">${details}</div>
    </details>
  `;
  bindDisclosureState(
    item.querySelector("details"),
    disclosureKey("tools", messages[0], messages[0]?.kind || title)
  );
  return item;
}

function disclosureKey(prefix, message, fallback = "") {
  return disclosureIdentity({
    threadId: state.currentThread?.id,
    prefix,
    messageId: message?.id,
    fallback: fallback || String(message?.text || "").slice(0, 80)
  });
}

function bindDisclosureState(details, key) {
  if (!details || !key) return;
  details.open = state.openDisclosures.has(key);
  details.addEventListener("toggle", () => {
    state.openDisclosures = updateDisclosureState(state.openDisclosures, key, details.open);
  });
}

function toolGroupTitle(messages) {
  const count = messages.length;
  const texts = messages.map((message) => String(message.text || "").trim());
  if (count === 1 && messages[0].kind === "retrying") return t("retry.retryingTitle");
  if (count === 1 && messages[0].kind === "retryRecovered") return t("retry.recovered");
  if (count === 1 && messages[0].kind === "retryFailed") return t("retry.failedTitle");
  if (count === 1 && [t("tool.compacting"), t("tool.compacted")].includes(texts[0])) return texts[0];
  if (texts.every((text) => text.startsWith("$ "))) return t("tool.commands", { count });
  if (texts.every((text) => text.includes("文件改动") || text.toLowerCase().includes("file"))) {
    return t("tool.fileChanges", { count });
  }
  return t("tool.records", { count });
}

function renderHistoryLoader() {
  if (!state.currentThread || (!state.hasOlderTurns && !state.loadingOlderTurns)) return null;

  const wrap = document.createElement("div");
  wrap.className = "history-loader";
  if (state.loadingOlderTurns) {
    wrap.innerHTML = `<span class="mini-spinner" aria-hidden="true"></span><span>${escapeHtml(t("load.loadingOlder"))}</span>`;
    return wrap;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = t("load.older");
  button.addEventListener("click", loadOlderTurns);
  wrap.append(button);
  return wrap;
}

function renderEmpty(title, text) {
  els.messages.innerHTML = `
    <div class="empty-state">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

function renderThreadLoading(thread, stats = null) {
  updateTrafficSummary(stats);
  const title = thread?.name || thread?.preview || t("load.currentThread");
  const lines = stats ? renderTrafficLines(stats) : [];
  els.messages.innerHTML = `
    <div class="loading-state" aria-live="polite">
      <div class="loading-spinner" aria-hidden="true"></div>
      <div>
        <h1>${escapeHtml(stats?.phase ? t("load.phase", { phase: stats.phase }) : t("load.opening"))}</h1>
        <p>${escapeHtml(title)}</p>
        ${lines.length ? `<div class="loading-traffic">${lines.join("")}</div>` : ""}
      </div>
    </div>
  `;
}

function updateTrafficSummary(activeStats = null) {
  if (!els.trafficSummary) return;
  const stats = activeStats || state.threadLoadStats || state.lastLoadStats;
  if (!stats || stats.threadId !== state.currentThread?.id) {
    els.trafficSummary.classList.add("hidden");
    els.trafficSummary.innerHTML = "";
    return;
  }

  const elapsed = (stats.finishedAt || performance.now()) - stats.startedAt;
  els.trafficSummary.classList.remove("hidden");
  els.trafficSummary.innerHTML = `
    <strong>${escapeHtml(t("traffic.title"))}</strong>
    <span>↓ ${formatBytes(stats.totalIn)}</span>
    <span>↑ ${formatBytes(stats.totalOut)}</span>
    <span>${formatDuration(elapsed)}</span>
    ${stats.messageCount ? `<span>${escapeHtml(t("traffic.count", { count: stats.messageCount }))}</span>` : ""}
  `;
}

function renderTrafficLines(stats) {
  const elapsed = (stats.finishedAt || performance.now()) - stats.startedAt;
  const lines = [
    `<span>${escapeHtml(t("traffic.total", {
      down: formatBytes(stats.totalIn),
      up: formatBytes(stats.totalOut),
      duration: formatDuration(elapsed)
    }))}</span>`
  ];

  for (const step of stats.steps) {
    const status = t(step.failed ? "common.failed" : "common.completed");
    lines.push(
      `<span>${escapeHtml(t("traffic.step", {
        label: step.label,
        status,
        down: formatBytes(step.in),
        up: formatBytes(step.out),
        duration: formatDuration(step.ms)
      }))}</span>`
    );
  }

  if (stats.messageCount) {
    lines.push(`<span>${escapeHtml(t("traffic.messages", {
      messages: stats.messageCount,
      items: stats.itemCount
    }))}</span>`);
  }

  return lines;
}

function renderMessageImages(images) {
  if (!images.length) return "";
  return `
    <div class="message-images">
      ${images.map((image, index) => {
        const src = image.kind === "inline"
          ? authenticatedUrl(`/api/inline-image?id=${encodeURIComponent(image.id)}`, state.token)
          : safeUrl(image.source, "image");
        if (!src) return "";
        const label = image.kind === "inline" && image.bytes
          ? `${t("image.defaultName")} · ${formatBytes(image.bytes)}`
          : t("image.defaultName");
        return `
          <button class="image-placeholder image-preview-placeholder" type="button" data-image-src="${escapeHtml(src)}" data-image-index="${index}" title="${escapeHtml(t("image.fullscreen"))}">
            <img class="message-image-preview" src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer">
            <span class="image-preview-caption">
              <strong>${escapeHtml(label)}</strong>
              <small>${escapeHtml(t("image.fullscreen"))}</small>
            </span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function bindImagePlaceholders(root) {
  for (const placeholder of root.querySelectorAll(".image-placeholder")) {
    const preview = placeholder.querySelector(".message-image-preview");
    if (preview) {
      const src = placeholder.dataset.imageSrc;
      preview.addEventListener("load", () => placeholder.classList.add("preview-ready"));
      preview.addEventListener("error", () => placeholder.classList.add("preview-failed"));
      if (preview.complete && preview.naturalWidth > 0) placeholder.classList.add("preview-ready");
      placeholder.addEventListener("click", () => {
        if (src) openImageViewer(preview.currentSrc || preview.src || src);
      });
      continue;
    }
    const loadImage = () => {
      const src = placeholder.dataset.imageSrc;
      if (!src || placeholder.classList.contains("loading")) return;
      const shouldStickToBottom = shouldStickToLiveOutput();
      placeholder.classList.add("loading");
      const loadingText = placeholder.querySelector("small");
      if (loadingText) loadingText.textContent = t("image.loading");
      const viewerButton = document.createElement("button");
      viewerButton.className = "loaded-message-image-button";
      viewerButton.type = "button";
      viewerButton.title = t("image.fullscreen");
      const img = document.createElement("img");
      img.loading = "eager";
      img.fetchPriority = "high";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.alt = "";
      img.className = "loaded-message-image";
      const startedAt = performance.now();
      let attempt = 1;
      logImageDebug("start", { src, attempt });
      const imageLoadTimer = window.setTimeout(() => {
        if (!placeholder.isConnected) return;
        logImageDebug("timeout", {
          src: img.currentSrc || img.src || src,
          attempt,
          elapsedMs: Math.round(performance.now() - startedAt),
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight
        });
        placeholder.replaceWith(renderImageLoadError(src));
        if (shouldStickToBottom) scrollMessagesToBottom();
      }, 90000);
      let retried = false;
      img.addEventListener("load", () => {
        window.clearTimeout(imageLoadTimer);
        logImageDebug("loaded", {
          src: img.currentSrc || img.src || src,
          attempt,
          elapsedMs: Math.round(performance.now() - startedAt),
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          complete: img.complete
        });
        placeholder.replaceWith(viewerButton);
        if (shouldStickToBottom) scrollMessagesToBottom();
      });
      img.addEventListener("error", () => {
        logImageDebug("error", {
          src: img.currentSrc || img.src || src,
          attempt,
          elapsedMs: Math.round(performance.now() - startedAt),
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight
        });
        if (!retried) {
          retried = true;
          attempt += 1;
          const retrySrc = cacheBustedImageUrl(src);
          logImageDebug("retry", { src: retrySrc, attempt });
          img.src = retrySrc;
          return;
        }
        window.clearTimeout(imageLoadTimer);
        placeholder.replaceWith(renderImageLoadError(src));
        if (shouldStickToBottom) scrollMessagesToBottom();
      });
      viewerButton.append(img);
      viewerButton.addEventListener("click", () => openImageViewer(img.currentSrc || img.src || src));
      img.src = src;
    };
    placeholder.addEventListener("click", loadImage);
    placeholder.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      loadImage();
    });
  }
}

function cacheBustedImageUrl(src) {
  try {
    const url = new URL(src, window.location.href);
    url.searchParams.set("_retry", Date.now().toString(36));
    return url.toString();
  } catch {
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}_retry=${Date.now().toString(36)}`;
  }
}

function logImageDebug(event, detail = {}) {
  const payload = {
    event,
    id: imageIdFromUrl(detail.src),
    src: redactImageUrl(detail.src),
    attempt: detail.attempt,
    elapsedMs: detail.elapsedMs,
    complete: detail.complete,
    naturalWidth: detail.naturalWidth,
    naturalHeight: detail.naturalHeight,
    online: navigator.onLine,
    page: window.location.href
  };
  if (event === "error" || event === "timeout") {
    console.warn("[CodexWebUI image]", payload);
  } else {
    console.info("[CodexWebUI image]", payload);
  }
}

function imageIdFromUrl(src) {
  try {
    return new URL(src, window.location.href).searchParams.get("id") || "";
  } catch {
    return "";
  }
}

function redactImageUrl(src) {
  try {
    const url = new URL(src, window.location.href);
    if (url.searchParams.has("token")) url.searchParams.set("token", "[redacted]");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return String(src || "").replace(/token=([^&]+)/, "token=[redacted]");
  }
}

function bindMarkdownImages(root) {
  for (const img of root.querySelectorAll(".bubble.markdown img")) {
    const shouldStickToBottom = shouldStickToLiveOutput();
    img.classList.add("loaded-message-image");
    img.title = t("image.fullscreen");
    img.addEventListener("click", () => openImageViewer(img.currentSrc || img.src));
    img.addEventListener("load", () => {
      if (shouldStickToBottom) scrollMessagesToBottom();
    }, { once: true });
  }
}

function renderImageLoadError(src) {
  const error = document.createElement("div");
  error.className = "image-load-error";
  error.innerHTML = `
    <strong>${escapeHtml(t("image.loadFailed"))}</strong>
    <small>${escapeHtml(imageErrorLabel(src))}</small>
  `;
  return error;
}

function imageErrorLabel(src) {
  try {
    const url = new URL(src, window.location.href);
    return url.searchParams.get("path") || redactImageUrl(src);
  } catch {
    return redactImageUrl(src);
  }
}

function openImageViewer(src) {
  if (!els.imageViewer || !els.imageViewerImg || !src) return;
  els.imageViewerImg.src = src;
  els.imageViewer.classList.remove("hidden");
  document.body.classList.add("viewer-open");
}

function closeImageViewer() {
  if (!els.imageViewer || els.imageViewer.classList.contains("hidden")) return false;
  els.imageViewer.classList.add("hidden");
  document.body.classList.remove("viewer-open");
  if (els.imageViewerImg) els.imageViewerImg.src = "";
  return true;
}

function updateThreadHeader() {
  const thread = state.currentThread;
  els.threadTitle.value = thread?.name || thread?.preview || t("thread.untitled");
  els.threadTitle.disabled = !thread;
  els.threadTitle.title = t(thread?.id || thread?.draft ? "thread.editTitle" : "thread.notSelected");
  const metaPath = thread?.cwd ? shortPath(thread.cwd) : t("empty.noProject");
  const archivedText = thread?.archived ? ` · [${t("thread.archivedBadge")}]` : "";
  els.threadMeta.textContent = thread ? `${metaPath} · ${formatStatusLabel(thread.status)}${archivedText}` : t("common.ready");
  if (els.archiveThreadBtn) {
    els.archiveThreadBtn.title = t(thread?.archived ? "thread.unarchive" : "thread.archive");
    els.archiveThreadBtn.classList.toggle("active", Boolean(thread?.archived));
  }
  updateResumeStatus(thread);
  renderTokenUsageBadge();
  updateSendMode();
  updateProjectSelectState();
  scrollThreadTitleToEnd();
}

function updateSendMode() {
  if (!els.sendButton) return;
  const waitingForContent = Boolean(
    state.sendingThreadId
    && state.threadContentGate?.threadId === state.currentThread?.id
    && !state.threadContentGate.gate.ready
  );
  if (waitingForContent) {
    setFollowUpMenuOpen(false);
    els.sendButton.textContent = t("composer.waiting");
    els.sendButton.setAttribute("aria-label", t("composer.waiting"));
    els.sendButton.title = "";
    return;
  }
  const threadId = state.currentThread?.id;
  const steering = Boolean(threadId && state.activeTurns.has(threadId));
  if (!steering) {
    state.interruptingTurnId = null;
    setFollowUpMenuOpen(false);
  }
  const interrupting = Boolean(state.interruptingTurnId);
  const label = t(interrupting ? "composer.stopping" : steering ? "composer.chooseFollowUp" : "composer.send");
  els.sendButton.textContent = label;
  els.sendButton.setAttribute("aria-label", label);
  els.sendButton.title = steering && !interrupting ? t("composer.chooseFollowUpTitle") : "";
  els.sendButton.setAttribute("aria-haspopup", steering ? "menu" : "false");
  if (!steering) els.sendButton.setAttribute("aria-expanded", "false");
  els.sendButton.disabled = isSendBlocked();
  updateFollowUpOptions();
}

function setFollowUpMenuOpen(open) {
  if (!els.followUpMenu || !els.sendButton) return;
  const threadId = state.currentThread?.id;
  const canChoose = Boolean(threadId && state.activeTurns.has(threadId));
  const visible = Boolean(open && canChoose);
  els.followUpMenu.classList.toggle("hidden", !visible);
  els.sendButton.setAttribute("aria-expanded", String(visible));
  updateFollowUpOptions();
}

function updateFollowUpOptions() {
  if (!els.followUpMenu) return;
  const hasPrompt = Boolean(els.promptInput.value.trim() || state.pendingImages.length || state.pendingSkills.length);
  for (const option of els.followUpMenu.querySelectorAll("[data-follow-up-mode]")) {
    const needsPrompt = option.dataset.followUpMode !== "stop";
    option.disabled = Boolean(state.interruptingTurnId) || (needsPrompt && !hasPrompt);
  }
}

async function interruptActiveTurn() {
  const threadId = state.currentThread?.id;
  const activeTurnId = threadId ? state.activeTurns.get(threadId) : null;
  if (!threadId || !activeTurnId || state.interruptingTurnId) return;
  const request = buildInterruptRequest({ threadId, activeTurnId });
  state.interruptingTurnId = activeTurnId;
  updateSendMode();
  try {
    await rpc(request.method, request.params);
    scheduleCurrentThreadSync(0);
  } catch (error) {
    if (state.interruptingTurnId === activeTurnId) state.interruptingTurnId = null;
    addSystemMessage(error.message || t("error.interrupt"));
    updateSendMode();
  }
}

async function startNextQueuedSubmission(threadId) {
  if (!threadId || state.activeTurns.has(threadId) || state.queueStartingThreadIds.has(threadId)) return false;
  state.queueStartingThreadIds.add(threadId);
  try {
    const page = await rpc("thread/queue/list", { threadId, limit: 1 });
    const next = page?.data?.[0];
    if (!next || state.activeTurns.has(threadId)) return false;
    await rpc("thread/queue/start", { threadId, queuedSubmissionId: next.id });
    return true;
  } finally {
    state.queueStartingThreadIds.delete(threadId);
  }
}

function isSendBlocked() {
  return state.initialThreadRestorePending || Boolean(state.sendingThreadId) || Boolean(state.interruptingTurnId);
}

async function commitThreadTitle() {
  if (threadTitleSaving || !state.currentThread || !els.threadTitle) return;
  const previous = threadTitleBeforeEdit || state.currentThread.name || state.currentThread.preview || "";
  const name = els.threadTitle.value.trim();

  if (!name) {
    els.threadTitle.value = previous || state.currentThread.name || state.currentThread.preview || t("thread.untitled");
    return;
  }
  if (name === previous || name === state.currentThread.name) return;

  if (state.currentThread.draft || !state.currentThread.id) {
    state.currentThread.name = name;
    state.currentThread.preview = name;
    updateThreadHeader();
    renderThreads();
    return;
  }

  threadTitleSaving = true;
  const threadId = state.currentThread.id;
  const oldName = state.currentThread.name;
  const oldPreview = state.currentThread.preview;
  state.currentThread.name = name;
  state.currentThread.preview = name;
  updateThreadHeader();
  renderThreads();

  try {
    await rpc("thread/name/set", { threadId, name });
    await loadThreads();
    const updated = state.threads.find((thread) => thread.id === threadId);
    if (updated && state.currentThread?.id === threadId) {
      state.currentThread = { ...state.currentThread, ...updated };
      const term = els.searchThreads.value.trim().toLowerCase();
      if (term && !threadMatchesSearch(state.currentThread, term)) {
        els.searchThreads.value = "";
        renderThreads();
      }
      threadTitleBeforeEdit = state.currentThread.name || name;
      updateThreadHeader();
    }
  } catch (error) {
    if (state.currentThread?.id === threadId) {
      state.currentThread.name = oldName;
      state.currentThread.preview = oldPreview;
      threadTitleBeforeEdit = oldName || oldPreview || "";
      updateThreadHeader();
    }
    addSystemMessage(error.message || t("thread.titleError"));
  } finally {
    threadTitleSaving = false;
  }
}

function cancelThreadTitleEdit() {
  if (!els.threadTitle) return;
  els.threadTitle.value = threadTitleBeforeEdit || state.currentThread?.name || state.currentThread?.preview || t("thread.untitled");
}

function scrollThreadTitleToEnd() {
  stopThreadTitleMarquee(false);
  if (!els.threadTitle || document.activeElement === els.threadTitle) return;
  requestAnimationFrame(() => {
    const maxScroll = els.threadTitle.scrollWidth - els.threadTitle.clientWidth;
    if (maxScroll <= 1) {
      els.threadTitle.scrollLeft = 0;
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      els.threadTitle.scrollLeft = maxScroll;
      return;
    }
    runThreadTitleMarquee(maxScroll);
  });
}

function runThreadTitleMarquee(maxScroll) {
  if (!els.threadTitle || document.activeElement === els.threadTitle) return;
  const startDelay = 450;
  const endDelay = 650;
  const duration = Math.max(1400, (maxScroll / 125) * 1000);

  const cycle = () => {
    if (!els.threadTitle || document.activeElement === els.threadTitle) return;
    els.threadTitle.scrollLeft = 0;
    threadTitleScrollTimer = window.setTimeout(() => {
      const startedAt = performance.now();
      const step = (now) => {
        if (!els.threadTitle || document.activeElement === els.threadTitle) {
          stopThreadTitleMarquee(true);
          return;
        }
        const progress = Math.min(1, (now - startedAt) / duration);
        els.threadTitle.scrollLeft = maxScroll * easeInOut(progress);
        if (progress < 1) {
          threadTitleScrollFrame = requestAnimationFrame(step);
          return;
        }
        threadTitleScrollTimer = window.setTimeout(cycle, endDelay);
      };
      threadTitleScrollFrame = requestAnimationFrame(step);
    }, startDelay);
  };

  cycle();
}

function stopThreadTitleMarquee(resetScroll) {
  if (threadTitleScrollFrame) {
    cancelAnimationFrame(threadTitleScrollFrame);
    threadTitleScrollFrame = null;
  }
  if (threadTitleScrollTimer) {
    clearTimeout(threadTitleScrollTimer);
    threadTitleScrollTimer = null;
  }
  if (resetScroll && els.threadTitle) {
    els.threadTitle.scrollLeft = 0;
  }
}

function easeInOut(value) {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

function updateProjectSelectState() {
  const choosingWorkspace = Boolean(state.currentThread?.draft || !state.currentThread?.id);
  els.projectSelect.disabled = !choosingWorkspace;
  els.workspaceSettingControls?.classList.toggle("hidden", !choosingWorkspace);
  els.currentConversationSummary?.classList.toggle("hidden", choosingWorkspace);
  if (els.contextSettingLabel) {
    els.contextSettingLabel.textContent = t(choosingWorkspace ? "settings.workspace" : "settings.currentConversation");
  }
  if (!choosingWorkspace && els.currentConversationSummary) {
    const thread = state.currentThread;
    const name = thread?.name || thread?.preview || t("thread.untitled");
    const context = thread?.cwd ? `${projectFromCwd(thread.cwd).name} · ${shortPath(thread.cwd)}` : t("empty.noProject");
    els.currentConversationSummary.innerHTML = `
      <strong>${escapeHtml(name)}</strong>
      <small>${escapeHtml(context)}</small>
    `;
  }
}

function applyBridgeModeUi() {
  const disabled = state.desktopBridgeConnected !== true
    || state.settingsSaving
    || !state.threadSettingsAvailable;
  document.documentElement.classList.add("desktop-bridge-mode");
  for (const select of [els.modelSelect, els.reasoningSelect, els.permissionSelect]) {
    if (!select) continue;
    select.disabled = disabled;
    select.title = "";
  }
  els.browseWorkspace.disabled = state.desktopBridgeConnected !== true
    || !state.workspaceBrowserAvailable
    || (Boolean(state.currentThread?.id) && !state.currentThread?.draft);
  els.chatPane?.classList.toggle(
    "desktop-bridge-offline",
    state.desktopBridgeConnected !== true
  );
  updateResumeStatus(state.currentThread);
}

function setDesktopBridgeStatus(connected) {
  const wasConnected = state.desktopBridgeConnected === true;
  state.desktopBridgeConnected = Boolean(connected);
  if (wasConnected && !state.desktopBridgeConnected) {
    state.threadSettingsCache.clear();
  }
  applyBridgeModeUi();
  if (!state.connected) return;
  setConnection(connected ? "connection.connected" : "connection.desktopBridgeOffline");
}

async function reconnectDesktopBridge() {
  if (state.desktopBridgeReconnecting) return;
  state.desktopBridgeReconnecting = true;
  updateResumeStatus(state.currentThread);
  try {
    await rpc("config/read", {});
    setDesktopBridgeStatus(true);
    scheduleCurrentThreadSync(0);
  } catch (error) {
    setDesktopBridgeStatus(false);
    throw error;
  } finally {
    state.desktopBridgeReconnecting = false;
    updateResumeStatus(state.currentThread);
  }
}

function updateResumeStatus(thread) {
  if (!els.resumeStatus) return;
  if (state.desktopBridgeConnected !== true) {
    const reconnecting = state.desktopBridgeReconnecting;
    els.resumeStatus.classList.remove("hidden", "resumed");
    els.resumeStatus.classList.add("unresumed");
    els.resumeStatus.textContent = t(reconnecting ? "thread.bridgeReconnecting" : "thread.bridgeReconnect");
    els.resumeStatus.disabled = reconnecting;
    els.resumeStatus.title = t("thread.bridgeReconnectTitle");
    return;
  }
  const status = formatStatus(thread?.status);
  const hasThread = Boolean(thread?.id);
  const resuming = hasThread && state.resumingThreadId === thread.id;
  const resumed = hasThread && status !== "notLoaded" && status !== "draft";
  els.resumeStatus.classList.toggle("hidden", !hasThread || status === "draft");
  els.resumeStatus.classList.toggle("resumed", resumed);
  els.resumeStatus.classList.toggle("unresumed", !resumed);
  els.chatPane?.classList.toggle("resuming-thread", resuming);
  els.chatPane?.classList.toggle("connected-thread", resumed && !resuming);
  const label = resuming ? "thread.bridgeLoading" : resumed ? "thread.bridgeConnected" : "thread.bridgeLoad";
  els.resumeStatus.textContent = t(label);
  els.resumeStatus.disabled = !hasThread || resumed || resuming;
  els.resumeStatus.title = t(resumed ? "thread.bridgeConnectedTitle" : "thread.bridgeLoadTitle");
}

function setConnection(key) {
  const text = t(key);
  els.connection.textContent = text;
  if (!els.connectionBanner) return;

  const value = String(text || "");
  const shouldShow = value && key !== "connection.connected";
  els.connectionBanner.textContent = value;
  els.connectionBanner.classList.toggle("hidden", !shouldShow);
  els.connectionBanner.classList.toggle(
    "danger",
    ["connection.invalidToken", "connection.error", "connection.missingToken"].includes(key)
  );
  els.connectionBanner.classList.toggle(
    "connecting",
    ["connection.connecting", "connection.reconnecting"].includes(key)
  );
}

function labelFor(role) {
  if (role === "user") return t("role.user");
  if (role === "assistant") return "Codex";
  if (role === "tool") return t("role.tool");
  return t("role.status");
}

function formatDate(seconds) {
  if (!seconds) return "";
  return new Intl.DateTimeFormat(currentLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(seconds * 1000));
}

function formatDateTime(seconds) {
  if (!seconds) return "";
  return new Intl.DateTimeFormat(currentLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(seconds * 1000));
}

function formatAutomationTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(currentLocale(), {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatAutomationDateTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(currentLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function shortPath(value) {
  if (!value) return "";
  const text = String(value);
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : text;
}

function projectFromCwd(value) {
  const cwd = String(value || t("project.unspecified"));
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  const fallback = cwd.replace(/[\\/]+$/, "");
  return {
    key: normalizePath(cwd),
    cwd,
    name: parts.at(-1) || fallback || t("project.unspecified")
  };
}

function isAbsolutePath(val) {
  if (!val || typeof val !== "string") return false;
  return /^[a-zA-Z]:[\\/]/.test(val) || val.startsWith("/") || val.startsWith("\\\\");
}

function getInitialWorkspacePath() {
  const currentCwd = state.currentThread?.cwd?.trim();
  if (currentCwd && isAbsolutePath(currentCwd)) return currentCwd;

  const proj = getSelectedProject();
  if (proj && proj.projectKind === "local" && proj.primaryPath && isAbsolutePath(proj.primaryPath)) {
    return proj.primaryPath;
  }

  const cwdVal = els.cwdInput?.value?.trim();
  if (cwdVal && isAbsolutePath(cwdVal)) return cwdVal;

  const scoped = preferredScopedCwd();
  if (scoped && isAbsolutePath(scoped)) return scoped;

  return "";
}

async function openWorkspacePicker() {
  els.workspacePicker.classList.remove("hidden");
  els.workspaceError.classList.add("hidden");
  els.workspaceName.value = "";
  const initial = getInitialWorkspacePath();
  await loadWorkspaceDirectory(initial);
}

function closeWorkspacePicker() {
  els.workspacePicker.classList.add("hidden");
}

async function loadWorkspaceDirectory(directory = "") {
  els.workspaceDirectoryList.textContent = t("workspace.loading");
  els.workspaceError.classList.add("hidden");
  try {
    const url = new URL(authenticatedUrl("/api/workspaces", state.token), window.location.origin);
    if (directory && isAbsolutePath(directory)) url.searchParams.set("path", directory);
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok) {
      if (directory) {
        return await loadWorkspaceDirectory("");
      }
      throw new Error(payload.error || t("error.request"));
    }
    renderWorkspaceDirectory(payload);
  } catch (error) {
    if (directory) {
      return await loadWorkspaceDirectory("");
    }
    showWorkspaceError(error.message || t("error.request"));
  }
}

function renderWorkspaceDirectory(payload) {
  const directory = payload?.path || "";
  els.workspaceCurrentPath.textContent = directory || t("workspace.roots");
  els.workspaceCurrentPath.dataset.path = directory;
  els.workspaceParent.dataset.path = payload?.parent || "";
  els.workspaceParent.disabled = !payload?.parent;
  els.workspaceUseCurrent.disabled = !directory;
  els.workspaceDirectoryList.innerHTML = "";
  const entries = directory ? payload?.directories || [] : payload?.roots || [];
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state compact-empty";
    empty.textContent = t("workspace.empty");
    els.workspaceDirectoryList.append(empty);
    return;
  }
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "workspace-directory";
    button.textContent = entry.name;
    button.title = entry.path;
    button.addEventListener("click", () => loadWorkspaceDirectory(entry.path));
    els.workspaceDirectoryList.append(button);
  }
}

async function useCurrentWorkspace() {
  const directory = els.workspaceCurrentPath.dataset.path || "";
  if (!directory) {
    showWorkspaceError(t("workspace.selectDirectory"));
    return;
  }
  await selectWorkspace(directory);
}

async function createAndUseWorkspace(event) {
  event.preventDefault();
  const parent = els.workspaceCurrentPath.dataset.path || "";
  if (!parent) {
    showWorkspaceError(t("workspace.selectDirectory"));
    return;
  }
  try {
    const url = new URL(authenticatedUrl("/api/workspaces/create", state.token), window.location.origin);
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parent, name: els.workspaceName.value })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || t("error.request"));
    await selectWorkspace(payload.workspace.path);
  } catch (error) {
    showWorkspaceError(error.message || t("error.request"));
  }
}

async function selectWorkspace(directory) {
  if (state.currentThread?.id && !state.currentThread?.draft) return;
  if (!state.currentThread?.draft) createThread();
  state.currentThread.cwd = directory;
  setProjectSelection(directory);
  updateThreadHeader();
  renderEmpty(t("thread.new"), t("empty.newThreadProject", { project: projectFromCwd(directory).name }));
  await Promise.allSettled([loadPermissionModes(directory), loadSkills(directory)]);
  closeWorkspacePicker();
}

function showWorkspaceError(message) {
  els.workspaceError.textContent = message;
  els.workspaceError.classList.remove("hidden");
}

function scopeCwdsFrom(source) {
  const values = Array.isArray(source?.threadFilterCwds)
    ? source.threadFilterCwds
    : source?.threadFilterCwd
      ? [source.threadFilterCwd]
      : [];
  return [...new Map(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => [normalizePath(value), value])
  ).values()];
}

function hasScopedToken() {
  return state.threadFilterCwds.length > 0;
}

function preferredScopedCwd() {
  return state.threadFilterCwds[0] || "";
}

function isProjectGroup(group) {
  const cwd = normalizePath(group.cwd);
  const name = group.name.toLowerCase();
  if (!cwd) return false;
  if (/\/documents\/codex\/\d{4}-\d{2}-\d{2}\//.test(cwd)) return false;
  if (/\/codex\/\d{4}-\d{2}-\d{2}\//.test(cwd)) return false;
  if (name.startsWith("new-chat")) return false;
  return true;
}

function samePath(a, b) {
  return normalizePath(a) === normalizePath(b);
}

function normalizePath(value) {
  return String(value || "")
    .replace(/[\\/]+$/, "")
    .replaceAll("\\", "/")
    .toLowerCase();
}

function formatStatus(status) {
  if (!status) return "ready";
  if (typeof status === "string") return status;
  if (typeof status === "object" && status.type) return status.type;
  return "ready";
}

function formatStatusLabel(status) {
  const value = formatStatus(status);
  const key = `status.${value}`;
  const label = t(key);
  return label === key ? value : label;
}

function formatRelativeTime(seconds) {
  if (!seconds) return "";
  const diffSeconds = Math.max(1, Math.floor(Date.now() / 1000 - seconds));
  const minute = 60;
  const hour = minute * 60;
  const day = hour * 24;
  const week = day * 7;
  if (diffSeconds < hour) return t("relative.minutes", { count: Math.max(1, Math.floor(diffSeconds / minute)) });
  if (diffSeconds < day) return t("relative.hours", { count: Math.floor(diffSeconds / hour) });
  if (diffSeconds < week) return t("relative.days", { count: Math.floor(diffSeconds / day) });
  return t("relative.weeks", { count: Math.floor(diffSeconds / week) });
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

function formatDuration(ms) {
  const value = Math.max(0, Number(ms) || 0);
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
}

function byteLengthText(text) {
  return byteEncoder.encode(String(text || "")).length;
}

function encodedJsonBytes(value) {
  return byteLengthText(JSON.stringify(value));
}

function remoteIcon() {
  return `
    <svg class="folder-icon remote-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm0 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="7.5" cy="7.5" r="1" fill="currentColor"/>
      <circle cx="7.5" cy="16.5" r="1" fill="currentColor"/>
    </svg>
  `;
}

function folderIcon() {
  return `
    <svg class="folder-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4.1l2 2H18.5A2.5 2.5 0 0 1 21 9.5v6A3.5 3.5 0 0 1 17.5 19h-11A3.5 3.5 0 0 1 3 15.5v-8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>
  `;
}

function settingsIcon() {
  return `
    <svg class="settings-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M19.2 13.1c.05-.36.08-.72.08-1.1s-.03-.74-.08-1.1l2-1.52-1.9-3.28-2.35.96a8.1 8.1 0 0 0-1.9-1.1L14.7 3.4h-3.8l-.36 2.56a8.1 8.1 0 0 0-1.9 1.1L6.3 6.1 4.4 9.38l2 1.52c-.05.36-.08.72-.08 1.1s.03.74.08 1.1l-2 1.52 1.9 3.28 2.35-.96c.58.46 1.22.83 1.9 1.1l.36 2.56h3.8l.36-2.56a8.1 8.1 0 0 0 1.9-1.1l2.35.96 1.9-3.28-2-1.52Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>
  `;
}

function resizePromptInput() {
  const minHeight = 40;
  els.promptInput.style.height = `${minHeight}px`;
  const nextHeight = Math.min(160, Math.max(minHeight, els.promptInput.scrollHeight));
  els.promptInput.style.height = `${nextHeight}px`;
  els.promptInput.style.overflowY = els.promptInput.scrollHeight > 160 ? "auto" : "hidden";
  updateMobileChromeMetrics();
}

function submitComposer() {
  if (els.sendButton.disabled) return;
  if (els.composer.requestSubmit) {
    els.composer.requestSubmit();
    return;
  }
  els.composer.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const markdownRenderer = createMarkdownRenderer();

function createMarkdownRenderer() {
  if (!window.markdownit || !window.DOMPurify) return null;

  const renderer = window.markdownit({
    breaks: true,
    html: false,
    linkify: true,
    typographer: false
  });

  const defaultLinkOpen =
    renderer.renderer.rules.link_open ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  const defaultImage =
    renderer.renderer.rules.image ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  renderer.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const hrefIndex = token.attrIndex("href");
    if (hrefIndex >= 0) {
      const href = safeUrl(token.attrs[hrefIndex][1], "link");
      if (href) {
        token.attrs[hrefIndex][1] = href;
        token.attrSet("target", "_blank");
        token.attrSet("rel", "noreferrer");
      } else {
        token.attrs.splice(hrefIndex, 1);
      }
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  renderer.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const srcIndex = token.attrIndex("src");
    if (srcIndex >= 0) {
      const src = safeUrl(token.attrs[srcIndex][1], "image");
      if (src) {
        const alt = token.content ? ` aria-label="${escapeHtml(token.content)}"` : "";
        return `<button class="image-placeholder markdown-image-placeholder" type="button" data-image-src="${escapeHtml(src)}"${alt}><span>${escapeHtml(t("image.defaultName"))}</span><small>${escapeHtml(t("image.clickLoad"))}</small></button>`;
      }
      token.attrs.splice(srcIndex, 1);
    }
    return defaultImage(tokens, idx, options, env, self);
  };

  return renderer;
}

function renderMarkdown(value) {
  if (!markdownRenderer || !window.DOMPurify) return escapeHtml(value);

  const dirty = markdownRenderer.render(String(value || ""));
  return window.DOMPurify.sanitize(dirty, {
    ADD_ATTR: ["target", "data-image-src"],
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed"],
    ALLOW_DATA_ATTR: true
  });
}

function safeUrl(rawUrl, kind) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  if (/^https?:/i.test(value)) return normalizeHttpUrl(value);
  if (/^mailto:/i.test(value)) return kind === "link" ? value : "";
  if (kind === "image" && /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value)) return value;
  const localPath = localPathFromMarkdownUrl(value, kind);
  if (localPath) {
    return authenticatedUrl(`/api/local-file?path=${encodeURIComponent(localPath)}`, state.token);
  }
  if (kind === "image" && /^\/(?![A-Za-z]:)/.test(value)) return value;
  if (kind === "link" && /^(#|\/(?![A-Za-z]:))/.test(value)) return value;
  return "";
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    if (isLocalBrowserHost(url.hostname)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return value;
  }
}

function isLocalBrowserHost(hostname) {
  const value = String(hostname || "").toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "0.0.0.0" || value === "[::1]" || value === "::1";
}

function localPathFromMarkdownUrl(value, kind = "image") {
  const decoded = decodeMarkdownUrlPath(value);
  const withoutFileScheme = decoded.replace(/^file:\/\//i, "");
  if (/^\/[A-Za-z]:\//.test(withoutFileScheme)) return withoutFileScheme.slice(1);
  if (/^[A-Za-z]:[\\/]/.test(withoutFileScheme)) return withoutFileScheme;
  if (kind === "image" && state.currentThread?.cwd && isRelativeLocalImagePath(withoutFileScheme)) {
    return joinLocalPath(state.currentThread.cwd, withoutFileScheme);
  }
  return "";
}

function decodeMarkdownUrlPath(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function isRelativeLocalImagePath(value) {
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return false;
  return /\.(png|jpe?g|webp|gif|svg)(?:[?#].*)?$/i.test(value);
}

function joinLocalPath(base, relativePath) {
  const slash = base.includes("\\") ? "\\" : "/";
  const cleanBase = base.replace(/[\\/]+$/, "");
  const cleanRelative = relativePath.replace(/[?#].*$/, "").replace(/^[\\/]+/, "").replaceAll("/", slash).replaceAll("\\", slash);
  return `${cleanBase}${slash}${cleanRelative}`;
}


function toggleTerminalPane(force) {
  if (!els.terminalPane) return;
  if (state.tokenRole && state.tokenRole !== "owner") return;
  state.terminalPaneOpen = typeof force === "boolean" ? force : !state.terminalPaneOpen;
  els.terminalPane.classList.toggle("hidden", !state.terminalPaneOpen);
  if (els.toggleTerminalBtn) {
    els.toggleTerminalBtn.classList.toggle("active", state.terminalPaneOpen);
  }
  if (state.terminalPaneOpen) {
    if (state.terminals.size === 0) {
      createNewTerminalTab();
    } else {
      renderTerminalTabs();
      renderTerminalOutput();
    }
    els.terminalStdinInput?.focus();
  }
}

function createNewTerminalTab() {
  if (state.tokenRole && state.tokenRole !== "owner") return;
  const id = `term-${state.nextTerminalId++}`;
  const shell = els.terminalShellSelect?.value || "powershell";
  const cwd = currentEffectiveCwd();
  const cols = 100;
  const rows = 28;
  const startParams = buildTerminalStartParams({
    processId: id,
    cwd,
    cols,
    rows,
    shell
  });
  const term = {
    id,
    processId: id,
    title: `${shell} #${state.terminals.size + 1}`,
    shell,
    cols,
    rows,
    output: t("terminal.started", { shell }),
    exited: false
  };
  state.terminals.set(id, term);
  state.activeTerminalId = id;
  renderTerminalTabs();
  renderTerminalOutput();

  rpc("command/exec", startParams)
    .then((res) => {
      if (res?.stdout || res?.stderr) {
        const extra = stripAnsiCodes(`${res.stdout || ""}${res.stderr || ""}`);
        if (extra) term.output += extra;
      }
      if (!term.exited && typeof res?.exitCode === "number") {
        term.exited = true;
        term.output += t("terminal.exited", { code: res.exitCode });
      }
      if (state.activeTerminalId === term.id) renderTerminalOutput();
    })
    .catch((err) => {
      term.output += `\n[Error: ${err?.message || "Terminal failed"}]\n`;
      if (state.activeTerminalId === term.id) renderTerminalOutput();
    });
}

function renderTerminalTabs() {
  if (!els.terminalTabList) return;
  els.terminalTabList.innerHTML = "";
  for (const term of state.terminals.values()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `terminal-tab-btn ${state.activeTerminalId === term.id ? "active" : ""}`;
    btn.textContent = term.title;
    btn.addEventListener("click", () => {
      state.activeTerminalId = term.id;
      renderTerminalTabs();
      renderTerminalOutput();
    });
    els.terminalTabList.append(btn);
  }
}

function renderTerminalOutput() {
  if (!els.terminalOutputViewport) return;
  const active = state.terminals.get(state.activeTerminalId);
  if (!active) {
    els.terminalOutputViewport.textContent = t("terminal.empty");
    return;
  }
  els.terminalOutputViewport.textContent = active.output || t("terminal.empty");
  els.terminalOutputViewport.scrollTop = els.terminalOutputViewport.scrollHeight;
}

async function sendTerminalInput(event) {
  if (event) event.preventDefault();
  const active = state.terminals.get(state.activeTerminalId);
  if (!active || !els.terminalStdinInput) return;
  const raw = els.terminalStdinInput.value;
  els.terminalStdinInput.value = "";
  const line = raw + "\r\n";
  active.output += `> ${raw}\n`;
  renderTerminalOutput();
  try {
    await rpc("command/exec/write", buildTerminalWriteParams(active.processId, line));
  } catch (err) {
    active.output += `\n[Write error: ${err?.message || "failed"}]\n`;
    renderTerminalOutput();
  }
}

async function sendTerminalSigint() {
  const active = state.terminals.get(state.activeTerminalId);
  if (!active) return;
  try {
    await rpc("command/exec/write", buildTerminalWriteParams(active.processId, "\x03"));
  } catch (err) {
    showToast({ kind: "failed", title: err?.message || t("common.failed") });
  }
}

async function resizeActiveTerminal(cols = 100, rows = 28) {
  const active = state.terminals.get(state.activeTerminalId);
  if (!active) return;
  active.cols = cols;
  active.rows = rows;
  try {
    await rpc("command/exec/resize", buildTerminalResizeParams(active.processId, cols, rows));
  } catch (_) {}
}

async function killTerminalProcess() {
  const active = state.terminals.get(state.activeTerminalId);
  if (!active) return;
  try {
    await rpc("command/exec/terminate", buildTerminalTerminateParams(active.processId));
    active.exited = true;
    active.output += t("terminal.exited", { code: -1 });
    renderTerminalOutput();
  } catch (err) {
    showToast({ kind: "failed", title: err?.message || t("common.failed") });
  }
}

function clearCurrentTerminal() {
  const active = state.terminals.get(state.activeTerminalId);
  if (!active) return;
  active.output = "";
  renderTerminalOutput();
}

function toggleEcosystemModal(force) {
  if (!els.ecosystemModal) return;
  state.ecosystemModalOpen = typeof force === "boolean" ? force : !state.ecosystemModalOpen;
  els.ecosystemModal.classList.toggle("hidden", !state.ecosystemModalOpen);
  if (state.ecosystemModalOpen) {
    switchEcoTab(state.activeEcoTab || "skills");
  }
}

function switchEcoTab(tabName) {
  state.activeEcoTab = tabName;
  const tabs = [
    { name: "skills", btn: els.ecoTabSkills, panel: els.ecoPanelSkills },
    { name: "mcp", btn: els.ecoTabMcp, panel: els.ecoPanelMcp },
    { name: "plugins", btn: els.ecoTabPlugins, panel: els.ecoPanelPlugins }
  ];
  for (const tab of tabs) {
    const isActive = tab.name === tabName;
    if (tab.btn) {
      tab.btn.classList.toggle("active", isActive);
      tab.btn.setAttribute("aria-selected", isActive ? "true" : "false");
    }
    if (tab.panel) {
      tab.panel.classList.toggle("hidden", !isActive);
    }
  }
  if (tabName === "skills") {
    loadEcosystemSkills().catch(() => {});
  } else if (tabName === "mcp") {
    loadEcosystemMcp().catch(() => {});
  } else if (tabName === "plugins") {
    loadEcosystemPlugins().catch(() => {});
  }
}

async function loadEcosystemSkills() {
  if (!els.ecoSkillsList) return;
  try {
    const res = await rpc("skills/list", { cwds: [currentEffectiveCwd()] });
    state.ecoSkills = normalizeSkillsCatalog(res);
    renderEcosystemSkills();
  } catch (err) {
    els.ecoSkillsList.innerHTML = `<div class="side-panel-empty">${escapeHtml(err?.message || t("common.failed"))}</div>`;
  }
}

function renderEcosystemSkills() {
  if (!els.ecoSkillsList) return;
  const query = String(els.ecoSkillSearch?.value || "").trim().toLowerCase();
  const isOwner = !state.tokenRole || state.tokenRole === "owner";
  const items = (state.ecoSkills || []).filter((item) => {
    if (!query) return true;
    return item.name.toLowerCase().includes(query) || item.description.toLowerCase().includes(query);
  });

  if (!items.length) {
    els.ecoSkillsList.innerHTML = `<div class="side-panel-empty">${escapeHtml(t("skill.empty"))}</div>`;
    return;
  }

  els.ecoSkillsList.innerHTML = items.map((skill, idx) => `
    <div class="eco-card" data-skill-idx="${idx}">
      <div class="eco-card-main">
        <div class="eco-card-title-row">
          <strong>${escapeHtml(skill.name)}</strong>
          <span class="eco-badge">${escapeHtml(skill.scope || "user")}</span>
        </div>
        <p class="eco-card-desc">${escapeHtml(skill.description || "")}</p>
        ${skill.path ? `<div class="eco-card-path">${escapeHtml(skill.path)}</div>` : ""}
      </div>
      <label class="eco-toggle-label">
        <input type="checkbox" class="eco-skill-toggle" data-skill-idx="${idx}" ${skill.enabled !== false ? "checked" : ""} ${!isOwner ? "disabled" : ""} />
      </label>
    </div>
  `).join("");

  els.ecoSkillsList.querySelectorAll(".eco-skill-toggle").forEach((input) => {
    input.addEventListener("change", async () => {
      const skill = items[Number(input.dataset.skillIdx)];
      if (!skill) return;
      try {
        await rpc("skills/config/write", buildSkillToggleParams(skill, input.checked));
        skill.enabled = input.checked;
        loadSkills(currentEffectiveCwd(), { forceReload: true }).catch(() => {});
      } catch (err) {
        input.checked = !input.checked;
        showToast({ kind: "failed", title: err?.message || t("common.failed") });
      }
    });
  });
}

async function loadEcosystemMcp() {
  if (!els.ecoMcpList) return;
  try {
    const res = await rpc("mcpServerStatus/list", {});
    state.ecoMcpServers = normalizeMcpServerList(res);
    renderEcosystemMcp();
  } catch (err) {
    els.ecoMcpList.innerHTML = `<div class="side-panel-empty">${escapeHtml(err?.message || t("common.failed"))}</div>`;
  }
}

function renderEcosystemMcp() {
  if (!els.ecoMcpList) return;
  const servers = state.ecoMcpServers || [];
  if (!servers.length) {
    els.ecoMcpList.innerHTML = `<div class="side-panel-empty">No MCP servers configured</div>`;
    return;
  }
  const isOwner = !state.tokenRole || state.tokenRole === "owner";
  els.ecoMcpList.innerHTML = servers.map((srv, idx) => `
    <div class="eco-card">
      <div class="eco-card-main">
        <div class="eco-card-title-row">
          <strong>${escapeHtml(srv.name)}</strong>
          <span class="eco-badge">${escapeHtml(srv.status || "unknown")}</span>
          <span class="eco-badge">Tools: ${Number(srv.toolCount || 0)}</span>
          <span class="eco-badge">Resources: ${Number(srv.resourceCount || 0)}</span>
        </div>
        ${srv.error ? `<p class="eco-card-desc" style="color: var(--danger);">${escapeHtml(srv.error)}</p>` : ""}
      </div>
      ${isOwner ? `<button type="button" class="secondary-action compact-action eco-mcp-oauth-btn" data-mcp-idx="${idx}">OAuth</button>` : ""}
    </div>
  `).join("");

  els.ecoMcpList.querySelectorAll(".eco-mcp-oauth-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const srv = servers[Number(btn.dataset.mcpIdx)];
      if (!srv) return;
      try {
        await rpc("mcpServer/oauth/login", { name: srv.name, threadId: state.currentThread?.id || null });
        await loadEcosystemMcp();
      } catch (err) {
        showToast({ kind: "failed", title: err?.message || t("common.failed") });
      }
    });
  });
}

async function reloadAllMcpServers() {
  try {
    await rpc("config/mcpServer/reload", {});
    await loadEcosystemMcp();
  } catch (err) {
    showToast({ kind: "failed", title: err?.message || t("common.failed") });
  }
}

async function loadEcosystemPlugins() {
  if (!els.ecoPluginsList) return;
  try {
    let res;
    try {
      res = await rpc("plugin/list", {});
    } catch (_) {
      res = await rpc("plugin/installed", {});
    }
    state.ecoPlugins = normalizePluginCatalog(res);
    renderEcosystemPlugins();
  } catch (err) {
    els.ecoPluginsList.innerHTML = `<div class="side-panel-empty">${escapeHtml(err?.message || t("common.failed"))}</div>`;
  }
}

function renderEcosystemPlugins() {
  if (!els.ecoPluginsList) return;
  const plugins = state.ecoPlugins || [];
  if (!plugins.length) {
    els.ecoPluginsList.innerHTML = `<div class="side-panel-empty">No plugins found</div>`;
    return;
  }
  els.ecoPluginsList.innerHTML = plugins.map((plugin) => `
    <div class="eco-card">
      <div class="eco-card-main">
        <div class="eco-card-title-row">
          <strong>${escapeHtml(plugin.name || plugin.id)}</strong>
          ${plugin.version ? `<span class="eco-badge">v${escapeHtml(plugin.version)}</span>` : ""}
          ${plugin.marketplace ? `<span class="eco-badge">${escapeHtml(plugin.marketplace)}</span>` : ""}
          <span class="eco-badge">${plugin.installed ? "Installed" : "Available"}</span>
        </div>
      </div>
    </div>
  `).join("");
}

async function loadThreadGoal() {
  if (!els.goalCurrentStatus) return;
  const threadId = state.currentThread?.id;
  if (!threadId) {
    els.goalCurrentStatus.textContent = t("agents.goalNone");
    return;
  }
  try {
    const res = await rpc("thread/goal/get", { threadId });
    const goal = normalizeThreadGoal(res);
    state.currentThreadGoal = goal;
    if (goal && goal.active && goal.objective) {
      const budgetText = goal.tokenBudget
        ? ` (${goal.tokensUsed || 0} / ${goal.tokenBudget} tokens${goal.progressPercent != null ? `, ${goal.progressPercent}%` : ""})`
        : "";
      els.goalCurrentStatus.textContent = `[${goal.status || "active"}] ${goal.objective}${budgetText}`;
      if (els.goalObjectiveInput && !els.goalObjectiveInput.value) {
        els.goalObjectiveInput.value = goal.objective;
      }
    } else {
      els.goalCurrentStatus.textContent = t("agents.goalNone");
    }
  } catch (_) {
    els.goalCurrentStatus.textContent = t("agents.goalNone");
  }
}

async function saveThreadGoal() {
  const threadId = state.currentThread?.id;
  if (!threadId || !els.goalObjectiveInput) return;
  const objective = els.goalObjectiveInput.value.trim();
  if (!objective) return;
  const rawBudget = els.goalBudgetInput?.value ? Number(els.goalBudgetInput.value) : null;
  const tokenBudget = Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : null;
  try {
    await rpc("thread/goal/set", {
      threadId,
      objective,
      status: "active",
      ...(tokenBudget ? { tokenBudget } : {})
    });
    showToast({ kind: "completed", title: t("agents.goalSaved") });
    await loadThreadGoal();
  } catch (err) {
    showToast({ kind: "failed", title: err?.message || t("common.failed") });
  }
}

async function clearThreadGoal() {
  const threadId = state.currentThread?.id;
  if (!threadId) return;
  try {
    await rpc("thread/goal/clear", { threadId });
    if (els.goalObjectiveInput) els.goalObjectiveInput.value = "";
    if (els.goalBudgetInput) els.goalBudgetInput.value = "";
    showToast({ kind: "completed", title: t("agents.goalCleared") });
    await loadThreadGoal();
  } catch (err) {
    showToast({ kind: "failed", title: err?.message || t("common.failed") });
  }
}

async function loadActiveSubagents() {
  if (!els.activeAgentsList) return;
  try {
    const loadedResult = await rpc("thread/loaded/list", {});
    const items = extractSubagentsAndLoadedThreads({
      loadedResult,
      threads: state.threads,
      currentThreadId: state.currentThread?.id || "",
      messages: state.messages
    });
    state.activeSubagents = items;
    if (!items.length) {
      els.activeAgentsList.innerHTML = `<div class="side-panel-empty">${escapeHtml(t("agents.emptyList"))}</div>`;
      return;
    }
    els.activeAgentsList.innerHTML = items.map((item, idx) => `
      <button type="button" class="agent-thread-card" data-agent-idx="${idx}">
        <div class="eco-card-title-row">
          <strong>${escapeHtml(item.name || item.threadId)}</strong>
          <span class="eco-badge">${escapeHtml(item.isSubagent ? t("agents.subagentBadge") : t("agents.activeBadge"))}</span>
        </div>
        ${item.cwd ? `<div class="eco-card-path">${escapeHtml(item.cwd)}</div>` : ""}
      </button>
    `).join("");

    els.activeAgentsList.querySelectorAll(".agent-thread-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = items[Number(btn.dataset.agentIdx)];
        if (!target?.threadId) return;
        const found = state.threads.find((th) => th.id === target.threadId) || { id: target.threadId, name: target.name, cwd: target.cwd };
        openThread(found);
      });
    });
  } catch (_) {
    els.activeAgentsList.innerHTML = `<div class="side-panel-empty">${escapeHtml(t("agents.emptyList"))}</div>`;
  }
}
