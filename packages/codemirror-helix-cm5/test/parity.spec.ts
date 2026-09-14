import {
  cases,
  FIXME,
  type Command,
  type Expectation,
  type Source,
  type Text,
} from "../../../test/fixtures/cm6-command-cases.ts";

const syntaxOnlyCases = new Set(["expand selection"]);

async function call<T>(callback: (api: Window["cm5Test"]) => T): Promise<T> {
  return browser.execute((source) => {
    const callback = Function("api", `return (${source})(api)`) as (
      api: Window["cm5Test"],
    ) => T;
    return callback(window.cm5Test);
  }, callback.toString());
}

function textToString(text: Text): string {
  return typeof text === "string" ? text : text.join("\n");
}

function sourceText(source: Source): string {
  return textToString(
    typeof source === "string" || Array.isArray(source) ? source : source.source,
  );
}

function keyEvent(command: string): [string, KeyboardEventInit] {
  if (command.startsWith("Alt-")) {
    return [command.slice(4), { altKey: true }];
  }
  if (command.startsWith("Ctrl-")) {
    return [command.slice(5), { ctrlKey: true }];
  }
  return [command, {}];
}

async function runCommand(command: Command): Promise<void> {
  if (typeof command === "string") {
    const [key, modifiers] = keyEvent(command);
    await browser.execute(({ key, modifiers }) => window.cm5Test.key(0, key, modifiers), {
      key,
      modifiers,
    });
    return;
  }
  if ("copy" in command) {
    await browser.execute((value) => window.cm5Test.setClipboard(value), command.copy);
    return;
  }
  await call((api) => api.setWrapping(0, true));
}

function expectedParts(expected: Expectation) {
  return typeof expected === "string" || Array.isArray(expected)
    ? { text: textToString(expected) }
    : {
        selection: expected.selection,
        text: expected.text && textToString(expected.text),
        clipboard: expected.clipboard && textToString(expected.clipboard),
        main: expected.main,
      };
}

describe("codemirror-helix-cm5 CM6 parity", () => {
  beforeEach(async () => {
    await browser.url("http://localhost:45184");
    await browser.waitUntil(() => browser.execute(() => Boolean(window.cm5Test)));
  });

  for (const [name, definition] of Object.entries(cases)) {
    const [mode, source, commands, expected] =
      definition.length === 4
        ? definition
        : ([undefined, ...definition] as [undefined, Source, Command[], Expectation]);
    const test = mode === FIXME || syntaxOnlyCases.has(name) ? it.skip : it;

    test(name, async () => {
      await browser.execute(
        (initial) => window.cm5Test.create(initial),
        sourceText(source),
      );
      for (const command of commands) {
        await runCommand(command);
      }

      const parts = expectedParts(expected);
      if (parts.text !== undefined) {
        expect(await call((api) => api.value(0))).toBe(parts.text);
      }
      if (parts.selection !== undefined) {
        const selections = Array.isArray(parts.selection[0])
          ? parts.selection
          : [parts.selection];
        expect(await call((api) => api.selections(0))).toEqual(
          selections.map(([anchor, head]) => ({ anchor, head })),
        );
      }
      if (parts.main !== undefined) {
        expect(await call((api) => api.mainIndex(0))).toBe(parts.main);
      }
      if (parts.clipboard !== undefined) {
        expect(await call((api) => api.clipboard())).toBe(parts.clipboard);
      }
    });
  }
});
