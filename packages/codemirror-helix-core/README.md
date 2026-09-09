# codemirror-helix-core

Editor-independent Helix engine with no DOM or CodeMirror dependency.

```ts
import { createHelixEngine, type HelixEditorAdapter } from "codemirror-helix-core";

const engine = createHelixEngine(adapter satisfies HelixEditorAdapter);
engine.handleKey("w");
```

Adapters provide document, selection, edit, clipboard, history, scrolling, and
optional syntax capabilities.
