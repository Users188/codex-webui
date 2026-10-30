export function extractProposedPlan(markdownText) {
  if (!markdownText || typeof markdownText !== "string") {
    return { hasPlan: false, planMarkdown: "", cleanedText: "", title: "" };
  }

  const regex = /<proposed_plan(?:\s+title=["']([^"']*)["'])?>([\s\S]*?)(?:<\/proposed_plan>|$)/i;
  const match = markdownText.match(regex);
  if (!match) {
    return { hasPlan: false, planMarkdown: "", cleanedText: markdownText, title: "" };
  }

  const rawTitle = match[1] || "";
  const planMarkdown = (match[2] || "").trim();
  const cleanedText = markdownText.replace(regex, "").trim();

  let title = rawTitle;
  if (!title && planMarkdown) {
    const firstLine = planMarkdown.split(/\r?\n/)[0].trim();
    if (firstLine.startsWith("#")) {
      title = firstLine.replace(/^#+\s*/, "");
    }
  }

  return {
    hasPlan: true,
    planMarkdown,
    cleanedText,
    title: title || "Proposed Plan"
  };
}

export function normalizePlanSteps(payload) {
  if (!payload) {
    return { explanation: "", steps: [], completedCount: 0, totalCount: 0 };
  }

  const rawExplanation = payload.explanation || payload.reason || "";
  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.plan)
    ? payload.plan
    : Array.isArray(payload.steps)
    ? payload.steps
    : [];

  const steps = rawList.map((item) => {
    const stepText = typeof item === "string" ? item : (item.step || item.text || item.title || "");
    const rawStatus = String(item.status || "pending").toLowerCase().replace(/-/g, "_");
    let status = "pending";
    if (["completed", "done", "finished", "success"].includes(rawStatus)) {
      status = "completed";
    } else if (["in_progress", "inprogress", "running", "active"].includes(rawStatus)) {
      status = "in_progress";
    }
    return {
      step: String(stepText).trim(),
      status
    };
  });

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const totalCount = steps.length;

  return {
    explanation: String(rawExplanation).trim(),
    steps,
    completedCount,
    totalCount
  };
}

export function buildApprovalDecisions(request) {
  if (!request) return [];
  const method = String(request.method || "");
  const params = request.params || {};

  if (method === "item/permissions/requestApproval") {
    const permissions = params.permissions || {};
    return [
      {
        id: "accept",
        labelKey: "common.allowOnce",
        decision: "accept",
        responsePayload: { permissions, scope: "turn" }
      },
      {
        id: "acceptForSession",
        labelKey: "common.allowSession",
        decision: "acceptForSession",
        responsePayload: { permissions, scope: "session" }
      },
      {
        id: "decline",
        labelKey: "common.decline",
        decision: "decline",
        responsePayload: { permissions: {} }
      }
    ];
  }

  if (method === "item/commandExecution/requestApproval") {
    const decisions = [
      {
        id: "accept",
        labelKey: "common.allowOnce",
        decision: "accept",
        responsePayload: { decision: "accept" }
      },
      {
        id: "acceptForSession",
        labelKey: "common.allowSession",
        decision: "acceptForSession",
        responsePayload: { decision: "acceptForSession" }
      }
    ];

    if (params.proposedExecpolicyAmendment) {
      const amendment = params.proposedExecpolicyAmendment;
      const dec = {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: amendment
        }
      };
      decisions.push({
        id: "amendExec",
        labelKey: "common.allowSimilar",
        decision: dec,
        responsePayload: { decision: dec }
      });
    }

    const netAmendments = Array.isArray(params.proposedNetworkPolicyAmendments)
      ? params.proposedNetworkPolicyAmendments.filter((a) => a && a.action !== "deny")
      : [];

    if (netAmendments.length > 0) {
      const dec = {
        applyNetworkPolicyAmendment: {
          network_policy_amendment: netAmendments[0]
        }
      };
      decisions.push({
        id: "amendNet",
        labelKey: "common.allowNetwork",
        decision: dec,
        responsePayload: { decision: dec }
      });
    }

    decisions.push({
      id: "decline",
      labelKey: "common.decline",
      decision: "decline",
      responsePayload: { decision: "decline" }
    });
    return decisions;
  }

  if (method === "item/fileChange/requestApproval") {
    return [
      {
        id: "accept",
        labelKey: "common.allowOnce",
        decision: "accept",
        responsePayload: { decision: "accept" }
      },
      {
        id: "acceptForSession",
        labelKey: "common.allowSession",
        decision: "acceptForSession",
        responsePayload: { decision: "acceptForSession" }
      },
      {
        id: "decline",
        labelKey: "common.decline",
        decision: "decline",
        responsePayload: { decision: "decline" }
      }
    ];
  }

  return [
    {
      id: "accept",
      labelKey: "common.allow",
      decision: "accept",
      responsePayload: { decision: "accept" }
    },
    {
      id: "decline",
      labelKey: "common.decline",
      decision: "decline",
      responsePayload: { decision: "decline" }
    }
  ];
}

export function collectQuestionAnswers(questions, formValues) {
  const answers = {};
  const getVal = (key) => {
    if (!formValues) return "";
    if (typeof formValues.get === "function") {
      return formValues.get(key);
    }
    return formValues[key];
  };

  for (const question of questions || []) {
    let value = getVal(question.id);
    if (value === "__other__") {
      value = getVal(`other:${question.id}`);
    }
    const trimmed = typeof value === "string" ? value.trim() : (value != null ? String(value).trim() : "");
    answers[question.id] = { answers: trimmed ? [trimmed] : [] };
  }

  return answers;
}

function formatNumber(num) {
  if (num >= 1000000) {
    const val = (num / 1000000).toFixed(1).replace(/\.0$/, "");
    return `${val}M`;
  }
  if (num >= 1000) {
    const val = (num / 1000).toFixed(1).replace(/\.0$/, "");
    return `${val}k`;
  }
  return String(num);
}

export function formatTokenUsageSummary(usage) {
  if (!usage) return "";
  const total = Number(
    usage.totalTokens ?? usage.total_tokens ?? (
      (usage.inputTokens ?? usage.prompt_tokens ?? usage.input_tokens ?? 0) +
      (usage.outputTokens ?? usage.completion_tokens ?? usage.output_tokens ?? 0)
    )
  );

  if (isNaN(total) || total <= 0) return "";

  const limit = Number(
    usage.contextWindow ?? usage.maxContextTokens ?? usage.context_window ?? usage.max_context_tokens
  );

  if (!isNaN(limit) && limit > 0) {
    const pct = Math.round((total / limit) * 100);
    return `${formatNumber(total)} / ${formatNumber(limit)} tokens (${pct}%)`;
  }

  return `${formatNumber(total)} tokens`;
}