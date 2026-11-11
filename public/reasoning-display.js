export function cleanReasoningText(value) {
  const text = typeof value === "string" ? value : value?.text || value?.content || "";
  return String(text)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Keep empty slots: streaming summaryIndex refers to the original array.
export function cleanReasoningParts(item) {
  return (Array.isArray(item?.summary) ? item.summary : []).map(cleanReasoningText);
}

export function reasoningPartsForDisplay(message) {
  const source = Array.isArray(message?.reasoningParts)
    ? message.reasoningParts
    : [message?.text];
  const parts = source.map(cleanReasoningText).filter(Boolean);
  return parts.length ? parts : [cleanReasoningText(message?.text)].filter(Boolean);
}

export function reasoningDisplay(messages) {
  const parts = [];
  for (const message of messages || []) {
    for (const part of reasoningPartsForDisplay(message)) {
      if (part !== parts.at(-1)) parts.push(part);
    }
  }
  const latest = parts.at(-1) || "";
  const firstLine = latest.split(/\r?\n/).find((line) => line.trim()) || "";
  const preview = firstLine
    .replace(/^\s*(?:#{1,6}\s+|[-*>]\s+)/, "")
    .replace(/!?(\[([^\]]+)\])\([^)]*\)/g, "$2")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    parts,
    preview: Array.from(preview).slice(0, 160).join(""),
    active: (messages || []).some((message) => message.reasoningActive === true)
  };
}

export function appendReasoningSummary(message, params) {
  const rawIndex = Number(params.summaryIndex ?? params.summary_index ?? 0);
  const index = Number.isSafeInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0;
  const parts = [...(message.reasoningParts || [])];
  parts[index] = (parts[index] || "") + String(params.delta ?? params.text ?? "");
  return {
    ...message,
    reasoningParts: parts,
    text: parts.map(cleanReasoningText).filter(Boolean).join("\n\n"),
    reasoningActive: true
  };
}

// A delayed active snapshot must not shorten a summary already received live.
export function mergeReasoningParts(existing, incoming) {
  const previous = existing?.reasoningParts || [];
  const next = incoming?.reasoningParts || [];
  return Array.from({ length: Math.max(previous.length, next.length) }, (_, index) => {
    const before = cleanReasoningText(previous[index]);
    const after = cleanReasoningText(next[index]);
    return before.startsWith(after) ? before : after;
  });
}
