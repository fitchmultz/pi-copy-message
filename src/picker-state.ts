import {
  decodeKittyPrintable,
  matchesKey,
  truncateToWidth,
  type TuiMode,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { isPrintableSearchInput, splitGraphemes } from "./display-text.ts";
import {
  type CopyMessageTheme,
  MAX_VISIBLE_MESSAGES,
  type PickerKeybindings,
  type ViewContext,
  filterLabel,
  helpLines,
  hotkeyHint,
  renderEmptyListLine,
  renderFooterLine,
  renderMessageLine,
  renderPeekLines,
  renderTitleLine,
} from "./picker-view.ts";
import {
  type CopyFormat,
  type CopyableMessage,
  type MessageVisibility,
  filteredMessages,
  formatMessageForCopy,
} from "./session-content.ts";

export type PickerInputResult = "copy" | "cancel" | "render" | "none";

/** Rule guards report no match with undefined so handleInput can chain them in priority order. */
type RuleResult = PickerInputResult | undefined;

function step(action: (typeof SELECT_ACTIONS)[number]): number {
  return action.startsWith("page") ? MAX_VISIBLE_MESSAGES : 1;
}

function backwards(action: (typeof SELECT_ACTIONS)[number]): boolean {
  return action === "up" || action === "pageUp";
}

type FilterField = keyof MessageVisibility;

/** A key the picker owns outright, independent of the configured selection bindings. */
type MatchKey = Parameters<typeof matchesKey>[1];

const FILTER_KEYS: ReadonlyArray<readonly [key: MatchKey, field: FilterField]> = [
  ["ctrl+t", "showTools"],
  ["ctrl+a", "showAssistant"],
  ["ctrl+u", "showUser"],
  ["alt+c", "showCustom"],
];

const SELECT_ACTIONS = ["up", "down", "pageUp", "pageDown"] as const;

export class CopyMessagePickerState {
  readonly visibility: MessageVisibility = {
    showAssistant: true,
    showUser: true,
    showTools: false,
    showCustom: true,
  };
  search = "";
  visibleMessages: CopyableMessage[];
  selectedIndex: number;
  format: CopyFormat;
  peek = false;
  private searchAnchorId: string | undefined;
  private readonly messages: CopyableMessage[];
  private firstVisibleIndex = 0;

  constructor(messages: CopyableMessage[], initialFormat: CopyFormat = "raw") {
    this.messages = messages;
    this.format = initialFormat;
    this.visibleMessages = filteredMessages(messages, this.visibility, this.search);
    this.selectedIndex = Math.max(0, this.visibleMessages.length - 1);
  }

  selectedMessage(): CopyableMessage | undefined {
    return this.visibleMessages[this.selectedIndex];
  }

  selectedCopyText(): string | undefined {
    const selected = this.selectedMessage();
    return selected === undefined ? undefined : formatMessageForCopy(selected, this.format);
  }

  render(
    width: number,
    theme: CopyMessageTheme,
    keybindings?: PickerKeybindings,
    tuiMode: TuiMode = "regular",
  ): string[] {
    const view: ViewContext = {
      width,
      theme,
      keybindings,
      tuiMode,
      total: this.visibleMessages.length,
    };
    const lines = [renderTitleLine(theme), "", ...this.listLines(view)];
    const selected = this.selectedMessage();
    if (this.peek && selected !== undefined) {
      lines.push("", ...renderPeekLines(selected, width, theme, this.format));
    }
    lines.push(
      renderFooterLine(view, {
        position: this.positionLabel(),
        filters: this.filterLabels(view),
        search: this.searchState(view),
        format: this.formatState(theme),
      }),
    );
    lines.push(
      "",
      ...helpLines(view, this.hasCustomMessages()).map((line) => hotkeyHint(theme, line)),
      "",
    );
    return lines.map((line) => truncateToWidth(line, width, ""));
  }

  handleInput(data: string, keybindings?: PickerKeybindings): PickerInputResult {
    // Order is the contract: pasted text, then configured bindings, then picker keys, then search
    // editing, then the fallback navigation the picker only owns without configured bindings.
    return (
      this.pastedText(data) ??
      this.configuredActions(data, keybindings) ??
      this.filterShortcut(data) ??
      this.searchEditing(data) ??
      this.fallbackMovement(data, keybindings) ??
      this.jumpKeys(data) ??
      this.fallbackConfirmOrCancel(data, keybindings) ??
      "none"
    );
  }

  handleMouse(event: TuiMouseEvent): PickerInputResult {
    if (event.type === "wheel" && event.wheelDelta !== undefined) {
      this.move(1, event.wheelDelta < 0 ? -1 : 1);
      return "render";
    }
    const index = this.clickedIndex(event);
    if (index === undefined) {
      return "none";
    }
    this.selectedIndex = index;
    return event.type === "click" ? "copy" : "render";
  }

  /** Rows below the title and spacer address the visible window; rows outside it select nothing. */
  private clickedIndex(event: TuiMouseEvent): number | undefined {
    if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) {
      return undefined;
    }
    const row = event.y - 2;
    if (row < 0 || row >= MAX_VISIBLE_MESSAGES) {
      return undefined;
    }
    const index = this.firstVisibleIndex + row;
    return index < this.visibleMessages.length ? index : undefined;
  }

  /** Bracketed paste arrives as one input event; it is search text, never a key. */
  private pastedText(data: string): RuleResult {
    if (!data.startsWith("\x1b[200~") || !data.endsWith("\x1b[201~")) {
      return undefined;
    }
    const text = data.slice(6, -6).replace(/\s+/gu, " ");
    if (!isPrintableSearchInput(text)) {
      return "none";
    }
    this.setSearch(this.search + text);
    return "render";
  }

  private configuredActions(data: string, keybindings: PickerKeybindings | undefined): RuleResult {
    if (!keybindings) {
      return undefined;
    }
    for (const action of SELECT_ACTIONS) {
      if (keybindings.matches(data, `tui.select.${action}`)) {
        this.move(step(action), backwards(action) ? -1 : 1);
        return "render";
      }
    }
    if (keybindings.matches(data, "tui.select.confirm")) {
      return this.visibleMessages.length > 0 ? "copy" : "none";
    }
    if (keybindings.matches(data, "tui.select.cancel")) {
      return "cancel";
    }
    return undefined;
  }

  private filterShortcut(data: string): RuleResult {
    for (const [key, field] of FILTER_KEYS) {
      if (matchesKey(data, key)) {
        this.visibility[field] = !this.visibility[field];
        this.refreshMessages();
        return "render";
      }
    }
    if (matchesKey(data, "alt+m")) {
      this.format = this.format === "metadata" ? "raw" : "metadata";
      return "render";
    }
    if (matchesKey(data, "tab")) {
      this.peek = !this.peek;
      return "render";
    }
    return undefined;
  }

  private searchEditing(data: string): RuleResult {
    if (matchesKey(data, "backspace") || data === "\x7f") {
      this.setSearch(splitGraphemes(this.search).slice(0, -1).join(""));
      return "render";
    }
    const printable = decodeKittyPrintable(data) ?? data;
    if (isPrintableSearchInput(printable)) {
      this.setSearch(this.search + printable);
      return "render";
    }
    return undefined;
  }

  private fallbackMovement(data: string, keybindings: PickerKeybindings | undefined): RuleResult {
    if (keybindings) {
      return undefined;
    }
    for (const action of SELECT_ACTIONS) {
      if (matchesKey(data, action)) {
        this.move(step(action), backwards(action) ? -1 : 1);
        return "render";
      }
    }
    return undefined;
  }

  private jumpKeys(data: string): RuleResult {
    if (matchesKey(data, "ctrl+pageUp")) {
      this.move(MAX_VISIBLE_MESSAGES, -1);
      return "render";
    }
    if (matchesKey(data, "ctrl+pageDown")) {
      this.move(MAX_VISIBLE_MESSAGES, 1);
      return "render";
    }
    if (matchesKey(data, "ctrl+home") || matchesKey(data, "home")) {
      this.jumpToTop();
      return "render";
    }
    if (matchesKey(data, "ctrl+end") || matchesKey(data, "end")) {
      this.jumpToBottom();
      return "render";
    }
    return undefined;
  }

  private fallbackConfirmOrCancel(
    data: string,
    keybindings: PickerKeybindings | undefined,
  ): RuleResult {
    if (keybindings) {
      return undefined;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      return this.visibleMessages.length > 0 ? "copy" : "none";
    }
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      return "cancel";
    }
    return undefined;
  }

  private listLines(view: ViewContext): string[] {
    const maxVisible = Math.min(this.visibleMessages.length, MAX_VISIBLE_MESSAGES);
    const start = this.windowStart(maxVisible);
    this.firstVisibleIndex = start;
    if (maxVisible === 0) {
      return [renderEmptyListLine(view.theme, this.search !== "")];
    }
    const lines: string[] = [];
    for (let i = start; i < start + maxVisible; i++) {
      const message = this.visibleMessages[i];
      if (message !== undefined) {
        lines.push(renderMessageLine(message, i, i === this.selectedIndex, view));
      }
    }
    return lines;
  }

  windowStart(maxVisible: number): number {
    if (maxVisible === 0) {
      return 0;
    }
    return Math.max(
      0,
      Math.min(this.selectedIndex - maxVisible + 1, this.visibleMessages.length - maxVisible),
    );
  }

  private filterLabels(view: ViewContext): string[] {
    const labels = [
      filterLabel(view.theme, "user", this.visibility.showUser, "warning"),
      filterLabel(view.theme, "assistant", this.visibility.showAssistant, "accent"),
      filterLabel(view.theme, "tools", this.visibility.showTools, "dim"),
    ];
    if (this.hasCustomMessages()) {
      labels.push(filterLabel(view.theme, "custom", this.visibility.showCustom, "dim"));
    }
    return labels;
  }

  private searchState(view: ViewContext): string {
    return this.search === ""
      ? view.theme.fg("dim", "type to filter")
      : view.theme.fg("accent", `search “${this.search}”`);
  }

  private formatState(theme: CopyMessageTheme): string {
    const metadata = this.format === "metadata";
    return theme.fg(metadata ? "accent" : "dim", metadata ? "copy metadata" : "copy raw");
  }

  positionLabel(): string {
    return this.visibleMessages.length === 0
      ? "0/0"
      : `${this.selectedIndex + 1}/${this.visibleMessages.length}`;
  }

  hasCustomMessages(): boolean {
    return this.messages.some((message) => message.role === "custom");
  }

  private refreshMessages(preferredId?: string): void {
    const selectedId = preferredId ?? this.visibleMessages[this.selectedIndex]?.id;
    this.visibleMessages = filteredMessages(this.messages, this.visibility, this.search);
    const nextIndex =
      selectedId === undefined
        ? -1
        : this.visibleMessages.findIndex((message) => message.id === selectedId);
    this.selectedIndex = nextIndex >= 0 ? nextIndex : Math.max(0, this.visibleMessages.length - 1);
  }

  private setSearch(nextSearch: string): void {
    if (this.search === "" && nextSearch !== "") {
      this.searchAnchorId = this.visibleMessages[this.selectedIndex]?.id;
    }

    this.search = nextSearch;

    if (this.search === "") {
      const anchorId = this.searchAnchorId;
      this.searchAnchorId = undefined;
      this.refreshMessages(anchorId);
      return;
    }

    this.refreshMessages();
  }

  private move(rows: number, direction: 1 | -1): void {
    if (this.visibleMessages.length === 0) {
      return;
    }
    this.selectedIndex = Math.max(
      0,
      Math.min(this.visibleMessages.length - 1, this.selectedIndex + rows * direction),
    );
  }

  private jumpToTop(): void {
    if (this.visibleMessages.length === 0) {
      return;
    }
    this.selectedIndex = 0;
  }

  private jumpToBottom(): void {
    if (this.visibleMessages.length === 0) {
      return;
    }
    this.selectedIndex = this.visibleMessages.length - 1;
  }
}
