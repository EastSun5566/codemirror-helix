import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHelixEngine } from "../dist/index.js";

const fixtures = JSON.parse(
  readFileSync(new URL("../../../test/fixtures/portable-cases.json", import.meta.url)),
);

function createMemoryEditor(initial) {
  let document = initial;
  let selections = [{ anchor: 0, head: 0 }];
  let mode = "normal";
  const adapter = {
    getDocument: () => document,
    getSelections: () => selections,
    getMainSelectionIndex: () => 0,
    setSelections(value) {
      selections = value.map((selection) => ({ ...selection }));
    },
    applyChanges(changes) {
      for (const change of [...changes].sort((left, right) => right.from - left.from)) {
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
    readClipboard: async () => "",
    writeClipboard: async () => {},
    indent: () => true,
    toggleComment: () => true,
    scroll: () => true,
    changeTheme: () => true,
  };
  return {
    adapter,
    insert(value) {
      assert.equal(mode, "insert");
      const changes = selections.map((selection) => ({
        from: Math.min(selection.anchor, selection.head),
        to: Math.max(selection.anchor, selection.head),
        insert: value,
      }));
      adapter.applyChanges(changes);
      selections = changes.map((change) => ({
        anchor: change.from + value.length,
        head: change.from + value.length,
      }));
    },
    value: () => document,
    selections: () => selections,
  };
}

for (const fixture of fixtures) {
  test(`portable: ${fixture.name}`, () => {
    const memory = createMemoryEditor(fixture.initial);
    const engine = createHelixEngine(memory.adapter);
    for (const action of fixture.actions) {
      if (action.key) {
        engine.handleKey(action.key);
      } else {
        memory.insert(action.insert);
      }
    }
    const expected =
      typeof fixture.expected === "string"
        ? { text: fixture.expected }
        : fixture.expected;
    assert.equal(memory.value(), expected.text);
    if (expected.selection) {
      const selections = Array.isArray(expected.selection[0])
        ? expected.selection
        : [expected.selection];
      assert.deepEqual(
        memory.selections(),
        selections.map(([anchor, head]) => ({ anchor, head })),
      );
    }
  });
}
