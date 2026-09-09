import CodeMirror from "codemirror";
import "codemirror/addon/comment/comment.js";
import {
  createHelixEngine,
  type HelixChange,
  type HelixCommandDefinition,
  type HelixConfig,
  type HelixEditorAdapter,
  type HelixExternalCommand,
  type HelixMode,
  type HelixPromptRequest,
  type HelixSelection,
  type HelixSnapshot,
  type HelixStatusEvent,
} from "codemirror-helix-core";

export type {
  HelixCommandDefinition,
  HelixConfig,
  HelixExternalCommand,
  HelixMode,
  HelixSnapshot,
  HelixStatusEvent,
} from "codemirror-helix-core";

export interface HelixCm5Options {
  config?: HelixConfig;
  init?: HelixSnapshot;
  globalInit?: HelixSnapshot;
  commands?: readonly HelixCommandDefinition[];
  externalCommands?: Record<string, HelixExternalCommand>;
  themes?: Record<string, string>;
  onStatus?: (event: HelixStatusEvent) => void;
  onModeChange?: (mode: HelixMode) => void;
}

export interface HelixCm5Controller {
  getMode(): HelixMode;
  resetMode(): void;
  snapshot(global?: boolean): HelixSnapshot;
  applyGlobalSnapshot(snapshot: HelixSnapshot): void;
  readRegister(name: string): readonly string[] | undefined;
  changeTheme(theme: string): boolean;
  destroy(): void;
}

const directEditOrigins = new Set(["+input", "+delete", "paste", "cut"]);

function normalizeKey(event: KeyboardEvent): string {
  let key = event.key;
  if (key === " ") {
    key = "Space";
  }
  if (key === "Esc") {
    key = "Escape";
  }
  const modifiers: string[] = [];
  if (event.ctrlKey) {
    modifiers.push("Ctrl");
  }
  if (event.altKey) {
    modifiers.push("Alt");
  }
  if (event.metaKey) {
    modifiers.push("Meta");
  }
  if (event.shiftKey && key.length > 1) {
    modifiers.push("Shift");
  }
  return modifiers.length > 0 ? `${modifiers.join("-")}-${key}` : key;
}

function createPanel(editor: CodeMirror.Editor) {
  const wrapper = editor.getWrapperElement();
  const panel = document.createElement("div");
  panel.className = "cm-helix-panel";

  const mode = document.createElement("span");
  mode.className = "cm-helix-mode";
  mode.setAttribute("aria-label", "Helix mode");

  const message = document.createElement("span");
  message.className = "cm-helix-message";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");

  const promptHost = document.createElement("div");
  promptHost.className = "cm-helix-prompt-host";
  panel.append(mode, message, promptHost);
  wrapper.append(panel);

  function showPrompt(request: HelixPromptRequest) {
    promptHost.replaceChildren();
    const form = document.createElement("form");
    form.className = "cm-helix-prompt";
    const id = `cm-helix-prompt-${Math.random().toString(36).slice(2)}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = request.label;
    const input = document.createElement("input");
    input.id = id;
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = request.initialValue;
    form.append(label, input);
    promptHost.append(form);

    const close = (restoreFocus = true) => {
      promptHost.replaceChildren();
      if (restoreFocus) {
        editor.focus();
      }
    };
    input.addEventListener("input", () => request.onInput(input.value));
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        request.onCancel();
        close();
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      request.onSubmit(input.value);
      close();
    });
    input.focus();
    input.select();
  }

  return {
    element: panel,
    setMode(value: HelixMode) {
      mode.textContent = value.toUpperCase();
    },
    setMessage(value: string) {
      message.textContent = value;
    },
    showPrompt,
    destroy() {
      panel.remove();
    },
  };
}

export function helix(
  editor: CodeMirror.Editor,
  options: HelixCm5Options = {},
): HelixCm5Controller {
  const wrapper = editor.getWrapperElement();
  const originalTheme = editor.getOption("theme");
  const originalModeAttribute = wrapper.getAttribute("data-helix-mode");
  const hadRootClass = wrapper.classList.contains("cm-helix");
  const hadFatCursorClass = wrapper.classList.contains("cm-fat-cursor");
  const panel = createPanel(editor);
  let mutationDepth = 0;
  let destroyed = false;

  function mutate<T>(callback: () => T): T {
    mutationDepth += 1;
    try {
      return callback();
    } finally {
      mutationDepth -= 1;
    }
  }

  const adapter: HelixEditorAdapter = {
    getDocument: () => editor.getValue(),
    getSelections: () =>
      editor.listSelections().map((selection) => ({
        anchor: editor.indexFromPos(selection.anchor),
        head: editor.indexFromPos(selection.head),
      })),
    getMainSelectionIndex() {
      const anchor = editor.getCursor("anchor");
      const head = editor.getCursor("head");
      const found = editor
        .listSelections()
        .findIndex(
          (selection) =>
            selection.anchor.line === anchor.line &&
            selection.anchor.ch === anchor.ch &&
            selection.head.line === head.line &&
            selection.head.ch === head.ch,
        );
      return found < 0 ? editor.listSelections().length - 1 : found;
    },
    setSelections(
      selections: readonly HelixSelection[],
      mainIndex = selections.length - 1,
    ) {
      editor.setSelections(
        selections.map(({ anchor, head }) => ({
          anchor: editor.posFromIndex(anchor),
          head: editor.posFromIndex(head),
        })),
        Math.max(0, Math.min(selections.length - 1, mainIndex)),
      );
    },
    applyChanges(changes: readonly HelixChange[]) {
      mutate(() => {
        editor.operation(() => {
          for (const change of [...changes].sort((a, b) => b.from - a.from)) {
            editor.replaceRange(
              change.insert,
              editor.posFromIndex(change.from),
              editor.posFromIndex(change.to),
              "+helix",
            );
          }
        });
      });
    },
    operation: (callback) => editor.operation(callback),
    setMode(mode) {
      wrapper.setAttribute("data-helix-mode", mode);
      wrapper.classList.toggle("cm-fat-cursor", mode !== "insert");
      panel.setMode(mode);
      options.onModeChange?.(mode);
      editor.refresh();
    },
    undo() {
      mutate(() => editor.undo());
      return true;
    },
    redo() {
      mutate(() => editor.redo());
      return true;
    },
    async readClipboard() {
      return navigator.clipboard?.readText ? navigator.clipboard.readText() : "";
    },
    async writeClipboard(text) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    },
    indent(direction) {
      mutate(() =>
        editor.execCommand(direction === "more" ? "indentMore" : "indentLess"),
      );
      return true;
    },
    toggleComment() {
      mutate(() => editor.execCommand("toggleComment"));
      return true;
    },
    scroll(command) {
      if (command === "cursor") {
        editor.scrollIntoView(editor.getCursor(), 40);
        return true;
      }
      const info = editor.getScrollInfo();
      if (command === "half-page-up" || command === "half-page-down") {
        const direction = command === "half-page-up" ? -1 : 1;
        editor.scrollTo(info.left, info.top + direction * info.clientHeight * 0.5);
        return true;
      }
      const cursor = editor.charCoords(editor.getCursor(), "local");
      const top =
        command === "line-top"
          ? cursor.top
          : command === "line-center"
            ? cursor.top - info.clientHeight / 2
            : cursor.bottom - info.clientHeight;
      editor.scrollTo(info.left, top);
      return true;
    },
    changeTheme(theme) {
      editor.setOption("theme", options.themes?.[theme] ?? theme);
      return true;
    },
    getHistory: () => editor.getHistory(),
    setHistory: (history) => editor.setHistory(history),
  };

  const engine = createHelixEngine(adapter, {
    config: options.config,
    init: options.init,
    globalInit: options.globalInit,
    commands: options.commands,
    externalCommands: options.externalCommands,
    onPrompt: panel.showPrompt,
    onStatus(event) {
      if (event.type === "mode") {
        panel.setMode(event.mode);
      } else {
        panel.setMessage(event.message);
      }
      options.onStatus?.(event);
    },
  });

  wrapper.classList.add("cm-helix");
  panel.setMode(engine.getMode());

  const localKeyMap: CodeMirror.KeyMap = {
    name: `helix-${Math.random().toString(36).slice(2)}`,
    Esc() {
      engine.resetMode();
    },
  };

  function onKeyDown(_instance: CodeMirror.Editor, event: KeyboardEvent) {
    if (
      destroyed ||
      event.defaultPrevented ||
      panel.element.contains(event.target as Node)
    ) {
      return;
    }
    const handled = engine.handleKey(normalizeKey(event));
    if (handled || engine.getMode() !== "insert") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }

  function onBeforeChange(
    _instance: CodeMirror.Editor,
    change: CodeMirror.EditorChangeCancellable,
  ) {
    if (
      mutationDepth === 0 &&
      engine.getMode() !== "insert" &&
      change.origin !== undefined &&
      directEditOrigins.has(change.origin)
    ) {
      change.cancel();
    }
  }

  editor.addKeyMap(localKeyMap);
  editor.on("keydown", onKeyDown);
  editor.on("beforeChange", onBeforeChange);

  return {
    getMode: engine.getMode,
    resetMode: engine.resetMode,
    snapshot: engine.snapshot,
    applyGlobalSnapshot: engine.applyGlobalSnapshot,
    readRegister: engine.readRegister,
    changeTheme: engine.changeTheme,
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      editor.off("keydown", onKeyDown);
      editor.off("beforeChange", onBeforeChange);
      editor.removeKeyMap(localKeyMap);
      panel.destroy();
      wrapper.classList.toggle("cm-fat-cursor", hadFatCursorClass);
      if (!hadRootClass) {
        wrapper.classList.remove("cm-helix");
      }
      if (originalModeAttribute === null) {
        wrapper.removeAttribute("data-helix-mode");
      } else {
        wrapper.setAttribute("data-helix-mode", originalModeAttribute);
      }
      editor.setOption("theme", originalTheme);
      engine.destroy();
      editor.refresh();
    },
  };
}
