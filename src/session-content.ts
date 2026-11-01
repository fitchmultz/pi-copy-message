import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatTime, roleLabel } from "./display-text.ts";

export type CopyFormat = "raw" | "metadata";

export interface CopyableMessage {
  id: string;
  role: string;
  timestamp?: string | undefined;
  text: string;
}

/** A persisted session entry inspected field by field; nothing here is trusted to be shaped right. */
interface SessionRecord {
  type?: unknown;
  text?: unknown;
  id?: unknown;
  timestamp?: unknown;
  summary?: unknown;
  content?: unknown;
  display?: unknown;
  message?: unknown;
}

interface SessionMessage {
  role?: unknown;
  type?: unknown;
  text?: unknown;
  display?: unknown;
  responseId?: unknown;
  stopReason?: unknown;
  content?: unknown;
  command?: unknown;
  output?: unknown;
  summary?: unknown;
}

function isRecord(value: unknown): value is SessionRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessage(value: unknown): value is SessionMessage {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(
      (part): part is { type: string; text: string } =>
        isMessage(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
}

function textFromMessage(message: SessionMessage): string {
  switch (message.role) {
    case "bashExecution": {
      const command = stringField(message.command) ?? "";
      const output = stringField(message.output) ?? "";
      return command === "" ? output : `$ ${command}\n${output}`.trimEnd();
    }
    case "branchSummary":
      return stringField(message.summary) ?? "";
    case "compactionSummary":
      return stringField(message.summary) ?? "";
    default:
      return textFromContent(message.content);
  }
}

function copyableFrom(
  record: SessionRecord,
  role: string,
  text: string,
): CopyableMessage | undefined {
  if (text.trim() === "") {
    return undefined;
  }
  return {
    id: stringField(record.id) ?? "unknown",
    role,
    timestamp: stringField(record.timestamp),
    text,
  };
}

/** Reads one persisted entry as a copyable message; entries of other kinds return nothing. */
function savedForkBoundary(entry: { type?: string | undefined }): boolean {
  return entry.type === "context_window";
}

function messageEntry(entry: SessionRecord, message: SessionMessage): CopyableMessage | undefined {
  const role = stringField(message.role) ?? "message";
  if (role === "custom" && message.display !== true) {
    return undefined;
  }
  return copyableFrom(entry, role, textFromMessage(message));
}

function entryToCopyableMessage(entry: unknown): CopyableMessage | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }

  if (entry.type === "message" && isMessage(entry.message)) {
    return messageEntry(entry, entry.message);
  }

  if (entry.type === "branch_summary") {
    return copyableFrom(entry, "branchSummary", stringField(entry.summary) ?? "");
  }

  if (entry.type === "compaction") {
    return copyableFrom(entry, "compactionSummary", stringField(entry.summary) ?? "");
  }

  if (entry.type === "custom_message" && entry.display === true) {
    return copyableFrom(entry, "custom", textFromContent(entry.content));
  }

  return undefined;
}

/**
 * Pi persists assistant responses as separate snapshot entries that share a response id. Within one
 * context window the latest snapshot wins, except that a pending snapshot may not replace a settled
 * one that already holds at least as much content.
 */
function responseIdOf(record: SessionRecord): string | undefined {
  if (record.type !== "message" || !isMessage(record.message)) {
    return undefined;
  }
  if (record.message.role !== "assistant") {
    return undefined;
  }
  return stringField(record.message.responseId);
}

function contentLengthOf(record: SessionRecord): number {
  if (!isMessage(record.message) || !Array.isArray(record.message.content)) {
    return 0;
  }
  return record.message.content.length;
}

function stopReasonOf(record: SessionRecord): string | undefined {
  return isMessage(record.message) ? stringField(record.message.stopReason) : undefined;
}

function keepsSnapshot(earlier: SessionRecord, latest: SessionRecord): boolean {
  if (stopReasonOf(latest) !== "pending") {
    return true;
  }
  return stopReasonOf(earlier) === "pending" && contentLengthOf(earlier) <= contentLengthOf(latest);
}

export function collectCopyableMessages(ctx: {
  sessionManager: { getBranch: () => unknown[] };
}): CopyableMessage[] {
  const entries: unknown[] = [];
  const responses = new Map<string, number>();

  for (const entry of ctx.sessionManager.getBranch()) {
    if (!isRecord(entry)) {
      entries.push(entry);
      continue;
    }
    if (entry.type === "context_window") {
      responses.clear();
    }
    const responseId = responseIdOf(entry);
    if (responseId === undefined) {
      entries.push(entry);
      continue;
    }
    const previous = responses.get(responseId);
    if (previous === undefined) {
      responses.set(responseId, entries.length);
      entries.push(entry);
      continue;
    }
    const earlier = entries[previous];
    if (isRecord(earlier) && keepsSnapshot(earlier, entry)) {
      entries[previous] = entry;
    }
  }

  return entries.flatMap((entry) => {
    const message = entryToCopyableMessage(entry);
    return message === undefined ? [] : [message];
  });
}

export function collectProjectedMessages(ctx: ExtensionCommandContext): CopyableMessage[] {
  const entries = ctx.sessionManager
    .buildSessionProjection()
    .entries.flatMap(({ sourceEntry, messages }): unknown[] => {
      // Retain saved fork boundaries for legacy response-snapshot coalescing.
      if (savedForkBoundary(sourceEntry)) {
        return [sourceEntry];
      }
      return messages
        .filter((message) => !(sourceEntry.type === "compaction" && message.role === "system"))
        .map((message) => Object.assign({}, sourceEntry, { type: "message", message }));
    });
  return collectCopyableMessages({ sessionManager: { getBranch: () => entries } });
}

export type MostRecentUserMessageResult =
  | { kind: "message"; message: CopyableMessage }
  | { kind: "no-user-message" }
  | { kind: "no-text" };

export function getMostRecentUserMessage(ctx: {
  sessionManager: { getBranch: () => unknown[] };
}): MostRecentUserMessageResult {
  const branch = ctx.sessionManager.getBranch();
  let sawUserMessage = false;

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (!isRecord(entry) || entry.type !== "message" || !isMessage(entry.message)) {
      continue;
    }
    const message = entry.message;
    if (message.role !== "user") {
      continue;
    }

    sawUserMessage = true;
    const copyable = copyableFrom(entry, "user", textFromMessage(message));
    if (copyable === undefined) {
      continue;
    }
    return { kind: "message", message: copyable };
  }

  return sawUserMessage ? { kind: "no-text" } : { kind: "no-user-message" };
}

function isToolMessage(message: CopyableMessage): boolean {
  return message.role === "toolResult" || message.role === "bashExecution";
}

export interface MessageVisibility {
  showAssistant: boolean;
  showUser: boolean;
  showTools: boolean;
  showCustom: boolean;
}

function isVisibleMessage(message: CopyableMessage, visibility: MessageVisibility): boolean {
  if (isToolMessage(message)) {
    return visibility.showTools;
  }
  if (message.role === "assistant") {
    return visibility.showAssistant;
  }
  if (message.role === "user") {
    return visibility.showUser;
  }
  if (message.role === "custom") {
    return visibility.showCustom;
  }
  return true;
}

function messageSearchText(message: CopyableMessage): string {
  return [roleLabel(message.role), message.text].join(" ").toLowerCase();
}

function messageMatchesSearch(message: CopyableMessage, search: string): boolean {
  const terms = search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");
  if (terms.length === 0) {
    return true;
  }
  const haystack = messageSearchText(message);
  const time = formatTime(message.timestamp).toLowerCase();
  return terms.every((term) => {
    if (term.startsWith("time:")) {
      return time.includes(term.slice("time:".length));
    }
    return haystack.includes(term);
  });
}

export function filteredMessages(
  messages: CopyableMessage[],
  visibility: MessageVisibility,
  search = "",
): CopyableMessage[] {
  return messages.filter(
    (message) => isVisibleMessage(message, visibility) && messageMatchesSearch(message, search),
  );
}

export function defaultVisibleMessages(messages: CopyableMessage[]): CopyableMessage[] {
  return filteredMessages(messages, {
    showAssistant: true,
    showUser: true,
    showTools: false,
    showCustom: true,
  });
}

export function latestDefaultMessage(messages: CopyableMessage[]): CopyableMessage | undefined {
  return defaultVisibleMessages(messages).at(-1) ?? messages.at(-1);
}

export function messageByDefaultNumber(
  messages: CopyableMessage[],
  number: number,
): CopyableMessage | undefined {
  if (!Number.isInteger(number) || number < 1) {
    return undefined;
  }
  return defaultVisibleMessages(messages)[number - 1];
}

export function formatMessageForCopy(message: CopyableMessage, format: CopyFormat): string {
  if (format === "raw") {
    return message.text;
  }
  const time = formatTime(message.timestamp);
  const label = roleLabel(message.role);
  return time === "" ? `${label}: ${message.text}` : `${label} at ${time}: ${message.text}`;
}
