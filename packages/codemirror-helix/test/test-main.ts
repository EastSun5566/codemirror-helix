import { EditorView } from "@codemirror/view";
import { helix } from "../";
import { Compartment, EditorSelection, type Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";

declare global {
  interface Window {
    view?: EditorView;
    initEditor(doc: string, lang: string | null): void;
    lineWrap(): Promise<number>;
  }
}

const languages: Record<string, () => Extension> = {
  js: javascript,
};

let view: EditorView | null = null;
let compartment: Compartment | undefined;

function initEditor(doc: string, lang: string | null) {
  const language = lang != null ? languages[lang] : null;
  const parent = document.querySelector("#editor")!;

  view?.destroy();
  parent.replaceChildren();

  compartment = new Compartment();

  view = new EditorView({
    doc,
    parent,
    extensions: [helix(), ...(language ? [language()] : []), compartment.of([])],
  });

  view.focus();

  window.view = view;
}

let clipboard = "";
navigator.clipboard.readText = async () => clipboard;
navigator.clipboard.writeText = async (data) => {
  clipboard = data;
};

window.initEditor = initEditor;

window.lineWrap = async () => {
  view!.dispatch({ effects: compartment!.reconfigure(EditorView.lineWrapping) });

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  return countLines(view!);
};

window.onerror = (_event, _source, _lineno, _colno, error) => {
  document.querySelector("#error")!.textContent +=
    `onerror fired!\nmessage: ${error?.message}\n${error?.stack}\n${Math.random()}\n`;
};

function countLines(view: EditorView) {
  let lines = 0;

  for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo++) {
    const line = view.state.doc.line(lineNo);

    let cursor = line.from;

    while (true) {
      lines++;

      const next = view.moveToLineBoundary(EditorSelection.cursor(cursor, 1), true, true);

      if (next.to === line.to) {
        break;
      }

      cursor = next.to;
    }
  }

  return lines;
}

const ready = document.createElement("span");
ready.classList.add("ready");

document.body.append(ready);
