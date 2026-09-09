# codemirror-helix

<a href="https://www.npmjs.com/package/codemirror-helix" target="_blank"><img src="https://flat.badgen.net/npm/v/codemirror-helix" /></a>
<a href="https://github.com/EastSun5566/codemirror-helix" target="_blank"><img src="https://flat.badgen.net/badge/icon/github?icon=github&label" /></a>

A [Codemirror](https://codemirror.net/) plugin for [Helix](https://helix-editor.com/) keybindings and general UX.

## Installation

```
npm install codemirror-helix
```

## How to

```typescript
import { EditorView } from "@codemirror/view";
import { helix, commands } from "codemirror-helix";

const customCommands = commands.of([
  {
    name: "save",
    aliases: ["s", "sv"],
    help: "Save the document to the cloud",
    handler(view, args) {
      saveDocumentToCloud(view.state.doc.toString());
    },
  },
]);

const view = new EditorView({
  doc: "",
  extensions: [helix(), customCommands],
  parent: document.querySelector("#editor"),
});
```

## External commands

This plugin only augments the behavior of a single editor element, a single "tab". Some Helix commands, however, only make sense in a "project" context, where
there are multiple files to edit, search, etc. The `externalCommands` facet allows you to define callbacks for these multi-editor commands:

```typescript
import { EditorView } from "@codemirror/view";
import { helix, externalCommands } from "codemirror-helix";

const view = new EditorView({
  doc: "",
  extensions: [
    helix(),
    externalCommands.of({
      file_picker() {
        showFilePicker();
      },
      global_search(input: string) {
        seachProjectAndShowResults(input);
      },
      // ...
    }),
  ],
  parent: document.querySelector("#editor"),
});
```

In a multi-editor setup, you will probably need to sync some global state between editors (for instance, the values of the registers). You can either:

- Serialize the state of an editor (with `snapshot()`) and pass it as initial state to `helix()`, or
- Create a set of transactions using `globalStateSync()` and dispatch them into another editor.

See the
[CM6 playground](https://github.com/EastSun5566/codemirror-helix/blob/master/apps/demo-cm6/main.ts)
for an example of a multi-editor setup.

This CM6 package remains at version `0.6.0` and is not published from this fork.

## Contributing

See the
[contribution guide](https://github.com/EastSun5566/codemirror-helix/blob/master/etc/CONTRIBUTING.md).

## License

[Mozilla Public License 2.0](LICENSE)
