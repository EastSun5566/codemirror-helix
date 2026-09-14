export type HelixMode = "normal" | "select" | "insert";

export interface HelixSelection {
  anchor: number;
  head: number;
}

export interface HelixChange {
  from: number;
  to: number;
  insert: string;
}

export interface HelixSnapshot {
  version: 1;
  mode?: HelixMode;
  selections?: HelixSelection[];
  mainIndex?: number;
  registers: Record<string, string[]>;
  search: string;
  theme?: string;
  history?: unknown;
}

export interface HelixConfig {
  "editor.default-yank-register"?: string;
  "editor.line-number"?: "absolute" | "relative";
  [key: string]: unknown;
}

export type HelixStatusEvent =
  | { type: "mode"; mode: HelixMode }
  | { type: "message"; message: string }
  | { type: "error"; message: string };

export interface HelixPromptRequest {
  kind: "command" | "search" | "selection-search" | "global-search";
  label: string;
  initialValue: string;
  onInput(value: string): void;
  onSubmit(value: string): void;
  onCancel(): void;
}

export interface HelixCommandContext {
  readonly adapter: HelixEditorAdapter;
  readonly mode: HelixMode;
  readonly count: number;
  readonly register: string;
  readonly engine: HelixEngine;
}

export interface HelixCommandDefinition {
  name: string;
  keys: string | readonly string[];
  modes?: readonly HelixMode[];
  run(context: HelixCommandContext): boolean | void;
}

export type HelixExternalCommand = (
  context: HelixCommandContext,
  args: readonly string[],
) => boolean | void | Promise<boolean | void>;

export interface HelixEngineOptions {
  config?: HelixConfig;
  init?: HelixSnapshot;
  globalInit?: HelixSnapshot;
  commands?: readonly HelixCommandDefinition[];
  externalCommands?: Record<string, HelixExternalCommand>;
  onStatus?: (event: HelixStatusEvent) => void;
  onPrompt?: (request: HelixPromptRequest) => void;
}

export type HelixScrollCommand =
  | "cursor"
  | "line-top"
  | "line-center"
  | "line-bottom"
  | "half-page-up"
  | "half-page-down";

export interface HelixEditorAdapter {
  getDocument(): string;
  getSelections(): HelixSelection[];
  getMainSelectionIndex(): number;
  setSelections(selections: readonly HelixSelection[], mainIndex?: number): void;
  applyChanges(changes: readonly HelixChange[]): void;
  operation<T>(callback: () => T): T;
  setMode(mode: HelixMode): void;
  undo(): boolean;
  redo(): boolean;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  indent(direction: "more" | "less"): boolean;
  toggleComment(): boolean;
  scroll(command: HelixScrollCommand): boolean;
  changeTheme(theme: string): boolean;
  /** Move from an offset to the next CodeMirror character-group boundary. */
  moveByGroup?(offset: number, forward: boolean): number;
  /** Move by visual lines while preserving the editor's native goal column. */
  moveVertically?(
    offset: number,
    amount: number,
    goalColumn?: number,
  ): { offset: number; goalColumn: number };
  getHistory?(): unknown;
  setHistory?(history: unknown): void;
  syntax?: {
    selectParent?(): boolean;
    selectSibling?(direction: "next" | "previous"): boolean;
  };
}

export interface HelixEngine {
  getMode(): HelixMode;
  setMode(mode: HelixMode): void;
  resetMode(): void;
  handleKey(key: string): boolean;
  snapshot(global?: boolean): HelixSnapshot;
  applyGlobalSnapshot(snapshot: HelixSnapshot): void;
  readRegister(name: string): readonly string[] | undefined;
  changeTheme(theme: string): boolean;
  destroy(): void;
}
