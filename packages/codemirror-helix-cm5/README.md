# codemirror-helix-cm5

CodeMirror 5 adapter for
[`codemirror-helix`](https://gitlab.com/_rvidal/codemirror-helix).

```ts
import CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror-helix-cm5/style.css";
import { helix } from "codemirror-helix-cm5";

const editor = CodeMirror(document.querySelector("#editor")!, {
  value: "Hello, Helix!",
});

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
```

Requires CodeMirror `>=5.65.0 <6`. Import both CSS files shown above. See the
[CM5 parity notes](https://github.com/EastSun5566/codemirror-helix/blob/master/packages/codemirror-helix-cm5/PARITY.md)
for the syntax-tree limitation.
