import CodeMirror from "codemirror";
import "codemirror-helix-cm5/style.css";
import { helix } from "codemirror-helix-cm5";
import type { HelixEditorAdapter } from "codemirror-helix-core";

declare const host: HTMLElement;
declare const adapter: HelixEditorAdapter;

const editor = CodeMirror(host, { value: "Hello" });
const controller = helix(editor, {
  config: { "editor.default-yank-register": '"' },
  commands: [],
  externalCommands: {},
});

controller.snapshot();
controller.readRegister('"');
controller.changeTheme("default");
controller.resetMode();
controller.destroy();
adapter.getDocument();
