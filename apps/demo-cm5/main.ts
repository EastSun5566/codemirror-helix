import CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror-helix-cm5/style.css";
import { helix } from "codemirror-helix-cm5";
import "./style.css";

const host = document.querySelector<HTMLElement>("#editor");
if (!host) {
  throw new Error("Missing editor host");
}

const editor = CodeMirror(host, {
  lineNumbers: true,
  lineWrapping: true,
  value: `function greet(name) {
  return \`Hello, \${name}!\`;
}

greet("Helix");
`,
});

const controller = helix(editor, {
  onStatus(event) {
    if (event.type === "error") {
      console.error(event.message);
    }
  },
});

Object.assign(window, { editor, helixController: controller });
editor.focus();
