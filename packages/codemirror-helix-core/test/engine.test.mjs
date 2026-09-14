import assert from "node:assert/strict";
import test from "node:test";
import { createHelixEngine, nextGraphemeBreak } from "../dist/index.js";

function memoryAdapter(initial) {
  let document = initial;
  let selections = [{ anchor: 0, head: 0 }];
  let mode = "normal";
  return {
    adapter: {
      getDocument: () => document,
      getSelections: () => selections,
      getMainSelectionIndex: () => 0,
      setSelections(value) {
        selections = value.map((selection) => ({ ...selection }));
      },
      applyChanges(changes) {
        for (const change of [...changes].sort((a, b) => b.from - a.from)) {
          document =
            document.slice(0, change.from) + change.insert + document.slice(change.to);
        }
      },
      operation: (callback) => callback(),
      setMode(value) {
        mode = value;
      },
      undo: () => true,
      redo: () => true,
      readClipboard: async () => "clipboard",
      writeClipboard: async () => {},
      indent: () => true,
      toggleComment: () => true,
      scroll: () => true,
      changeTheme: () => true,
    },
    get document() {
      return document;
    },
    get selections() {
      return selections;
    },
    get mode() {
      return mode;
    },
  };
}

test("moves by Unicode grapheme clusters", () => {
  const memory = memoryAdapter("a👨‍👩‍👧‍👦b");
  const engine = createHelixEngine(memory.adapter);
  engine.handleKey("l");
  engine.handleKey("l");
  assert.equal(memory.selections[0].head, nextGraphemeBreak("a👨‍👩‍👧‍👦b", 1));
});

test("group motions match Roberto's CM6 selection behavior", () => {
  const memory = memoryAdapter("one two three");
  const engine = createHelixEngine(memory.adapter);
  engine.handleKey("2");
  engine.handleKey("w");
  assert.deepEqual(memory.selections, [{ anchor: 0, head: 3 }]);
  assert.equal(engine.snapshot().version, 1);
});

test("word deletion removes the CM6-selected group", () => {
  const memory = memoryAdapter("move to     test");
  memory.adapter.setSelections([{ anchor: 5, head: 5 }]);
  const engine = createHelixEngine(memory.adapter);

  engine.handleKey("w");
  assert.deepEqual(memory.selections, [{ anchor: 5, head: 7 }]);
  engine.handleKey("d");

  assert.equal(memory.document, "move      test");
  assert.deepEqual(engine.readRegister('"'), ["to"]);
});

test("yank and paste use editor-local registers", () => {
  const memory = memoryAdapter("abc");
  const engine = createHelixEngine(memory.adapter);
  engine.handleKey("y");
  assert.deepEqual(engine.readRegister('"'), ["a"]);
  engine.handleKey("p");
  assert.equal(memory.document, "aabc");
});

test("selects the document and delimiter contents with Helix match keys", () => {
  const memory = memoryAdapter("x(one)y");
  const engine = createHelixEngine(memory.adapter);
  memory.adapter.setSelections([{ anchor: 3, head: 3 }]);
  engine.handleKey("m");
  engine.handleKey("i");
  engine.handleKey("m");
  assert.deepEqual(memory.selections, [{ anchor: 2, head: 5 }]);
  engine.handleKey("%");
  assert.deepEqual(memory.selections, [{ anchor: 0, head: 7 }]);
});

test("supports portable surround, replace, and case commands", () => {
  const memory = memoryAdapter("abc");
  const engine = createHelixEngine(memory.adapter);
  engine.handleKey("m");
  engine.handleKey("s");
  engine.handleKey("(");
  assert.equal(memory.document, "(a)bc");
  assert.deepEqual(memory.selections, [{ anchor: 0, head: 3 }]);

  memory.adapter.setSelections([{ anchor: 1, head: 2 }]);
  engine.handleKey("r");
  engine.handleKey("Z");
  assert.equal(memory.document, "(Z)bc");
  engine.handleKey("Alt-`");
  assert.equal(memory.document, "(Z)bc");
  engine.handleKey("`");
  assert.equal(memory.document, "(z)bc");

  memory.adapter.setSelections([{ anchor: 0, head: 3 }]);
  engine.handleKey("r");
  engine.handleKey("x");
  assert.equal(memory.document, "xxxbc");
});

test("consumes an invalid prefix without executing the following normal key", () => {
  const memory = memoryAdapter("abc");
  const engine = createHelixEngine(memory.adapter);
  engine.handleKey("m");
  assert.equal(engine.handleKey("d"), true);
  assert.equal(memory.document, "abc");
});
