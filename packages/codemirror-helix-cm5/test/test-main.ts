import CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/mode/javascript/javascript.js";
import "../src/style.css";
import { helix, type HelixCm5Controller } from "../src/index";

interface TestEditor {
  editor: CodeMirror.Editor;
  controller: HelixCm5Controller;
  messages: string[];
}

const instances: TestEditor[] = [];
let clipboard = "";
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    readText: async () => clipboard,
    writeText: async (value: string) => {
      clipboard = value;
    },
  },
});

function create(value = "one two\nthree") {
  const host = document.createElement("div");
  document.querySelector("#editors")!.append(host);
  const editor = CodeMirror(host, { value, lineNumbers: true, mode: "javascript" });
  const messages: string[] = [];
  const controller = helix(editor, {
    onStatus(event) {
      if (event.type !== "mode") {
        messages.push(event.message);
      }
    },
  });
  instances.push({ editor, controller, messages });
  editor.focus();
  return instances.length - 1;
}

function key(index: number, value: string, modifiers: Partial<KeyboardEventInit> = {}) {
  const { editor } = instances[index]!;
  const prompt = document.querySelector<HTMLInputElement>(".cm-helix-prompt input");
  if (prompt) {
    if (value === "Enter") {
      prompt.form!.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    } else if (value === "Escape") {
      prompt.dispatchEvent(
        new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
      );
    } else {
      const start = prompt.selectionStart ?? prompt.value.length;
      const end = prompt.selectionEnd ?? start;
      if (value === "Backspace") {
        const from = start === end ? Math.max(0, start - 1) : start;
        prompt.setRangeText("", from, end, "end");
      } else {
        prompt.setRangeText(value, start, end, "end");
      }
      prompt.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    return;
  }
  const input = editor.getInputField();
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  input.dispatchEvent(event);
  if (
    !event.defaultPrevented &&
    value.length === 1 &&
    !modifiers.altKey &&
    !modifiers.ctrlKey &&
    !modifiers.metaKey
  ) {
    editor.replaceSelection(value, "end", "+input");
  }
}

Object.assign(window, {
  cm5Test: {
    reset() {
      for (const { controller, editor } of instances.splice(0)) {
        controller.destroy();
        editor.getWrapperElement().parentElement?.remove();
      }
    },
    create,
    key,
    value: (index: number) => instances[index]!.editor.getValue(),
    mode: (index: number) => instances[index]!.controller.getMode(),
    replace: (index: number, value: string) =>
      instances[index]!.editor.replaceSelection(value),
    snapshot: (index: number) => instances[index]!.controller.snapshot(),
    setSelections(
      index: number,
      ranges: Array<{ anchor: number; head: number }>,
      mainIndex = ranges.length - 1,
    ) {
      const editor = instances[index]!.editor;
      editor.setSelections(
        ranges.map((range) => ({
          anchor: editor.posFromIndex(range.anchor),
          head: editor.posFromIndex(range.head),
        })),
        mainIndex,
      );
    },
    selections(index: number) {
      const editor = instances[index]!.editor;
      return editor.listSelections().map((range) => ({
        anchor: editor.indexFromPos(range.anchor),
        head: editor.indexFromPos(range.head),
      }));
    },
    mainIndex: (index: number) => {
      const editor = instances[index]!.editor;
      const primary = editor
        .listSelections()
        .findIndex(
          (selection) =>
            selection.anchor.line === editor.getCursor("anchor").line &&
            selection.anchor.ch === editor.getCursor("anchor").ch &&
            selection.head.line === editor.getCursor("head").line &&
            selection.head.ch === editor.getCursor("head").ch,
        );
      return primary < 0 ? editor.listSelections().length - 1 : primary;
    },
    clipboard: () => clipboard,
    setClipboard: (value: string) => {
      clipboard = value;
    },
    submitPrompt(value: string) {
      const input = document.querySelector<HTMLInputElement>(".cm-helix-prompt input");
      if (!input) {
        throw new Error("Prompt is not open");
      }
      input.value = value;
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      input.form!.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    },
    messages: (index: number) => [...instances[index]!.messages],
    setWrapping(index: number, enabled: boolean) {
      const editor = instances[index]!.editor;
      editor.setSize(160, 100);
      editor.setOption("lineWrapping", enabled);
      editor.refresh();
    },
    theme: (index: number) => instances[index]!.editor.getOption("theme"),
    changeTheme: (index: number, theme: string) =>
      instances[index]!.controller.changeTheme(theme),
    destroy: (index: number) => instances[index]!.controller.destroy(),
    reenable(index: number) {
      const instance = instances[index]!;
      instance.controller = helix(instance.editor);
    },
    hasPanel: (index: number) =>
      Boolean(
        instances[index]!.editor.getWrapperElement().querySelector(".cm-helix-panel"),
      ),
    hasClass: (index: number) =>
      instances[index]!.editor.getWrapperElement().classList.contains("cm-helix"),
  },
});
