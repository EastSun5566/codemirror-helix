export { EditorState } from "@codemirror/state";
export { EditorView, ViewPlugin, lineNumbers } from "@codemirror/view";
export { javascript } from "@codemirror/lang-javascript";
export { oneDark } from "@codemirror/theme-one-dark";
export { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";

export {
  commands,
  externalCommands,
  helix,
  globalStateSync,
  resetMode,
  pathRegister,
  themeListener,
  changeTheme,
} from "../../packages/codemirror-helix/src/lib";
export { historyField, registersField } from "../../packages/codemirror-helix/src/state";
