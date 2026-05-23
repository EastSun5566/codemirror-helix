/// <reference types="@wdio/mocha-framework" />
import { expect, browser, $ } from "@wdio/globals";
import { Key } from "webdriverio";

// An expectation is either:
// - The final contents of the the document, or
// - A { selection, text } object.
//
type Expectation =
  // shorthand for  a { text } expectation
  | Text
  | {
      // the final selection, described as an [anchor, head], or an array of such (for multi-selections).
      selection?: [anchor: number, head: number] | Array<[anchor: number, head: number]>;
      // the final contents of the editor
      text?: Text;
      // the contents of the clipboard
      clipboard?: Text;
    };

// set this to `true` to make tests go real slow and help debugging
const SLOW = false;

const FIXME = Symbol();

// represents text as a string or optionally as an array of lines
type Text = string | string[];

// the editor source described as text or, optionally,
// as text plus a language to be added to the editor config
type Source = Text | { lang: string; source: Text };

// a command to send to the editor
type Command =
  // a key to send to the editor (e.g. "a" or "Alt-C")
  | string
  // instructs the browser to enter that text into the clipboard
  | { copy: string };

// How to write a test case
//
// A test case is just an array with:
// [ initialEditorSource, commandsOrKeys, expectation ]
//
// Optionally, the array can have one more element, a boolean as the first field
// to single out focused/skipped tests (a la `it.only()`/`it.skip()`).
type Case =
  | [Source, Command[], Expectation]
  | [boolean | typeof FIXME, Source, Command[], Expectation];

const cases: Record<string, Case> = {
  "moves to line end": [["foo", "bar"], ["g", "l"], { selection: [3, 2] }],
  "moves to line end, back from linebreak": [
    ["foo", "bar"],
    ["g", "l", "l", "g", "l"],
    { selection: [3, 2] },
  ],
  "moves to first non-whitespace": ["  foo", ["g", "s"], { selection: [3, 2] }],
  "deletes a line": [["foo", "bar"], ["x", "d"], "bar"],
  "selects lines": [["foo", "bar", "baz"], ["x", "x"], { selection: [0, 8] }],
  "reverse selection": ["foo", ["x", "Alt-;"], { selection: [3, 0] }],
  "surrounds with parens": ["foo", ["x", "m", "s", "<"], "<foo>"],
  "selects a line on linebreak": [
    ["foo", "bar"],
    ["g", "l", "l", "x"],
    { selection: [0, 4] },
  ],
  "surrounds moves selection": ["foo", ["x", "m", "s", "<"], { selection: [0, 5] }],
  "surrounds respects selection dir": ["foo", ["x", "Alt-;", "m", "s", "<"], "<foo>"],
  "cancels surrounds": ["foo", ["x", "m", "s", "Escape", "a", "i"], "fooi"],
  "find characters": ["hello world", ["f", "w"], { selection: [0, 7] }],
  "find characters, repeat": ["hello world", ["f", "o", "f", "o"], { selection: [4, 8] }],
  "find characters, turn around": [
    "hello world",
    ["f", "w", "F", "e"],
    { selection: [7, 1] },
  ],
  "find characters, select & repeat": [
    "hello world hello world",
    ["v", "f", "o", "f", "o", "f", "e", "F", "d"],
    { selection: [0, 11] },
  ],
  "search cancellation": [
    Array.from({ length: 200 }, (_, count) => String(count + 1).padStart(3, "0")),
    ["/", "0", "5", "0", "Enter", "/", "1", "3", "0", "Escape"],
    { selection: [196, 199] },
  ],
  "delete repeatedly": ["hello world", ["5", "l", "d", "d", "d"], "hellorld"],
  "join lines": [
    ["hello world", "helix rocks", "plugins when"],
    ["5", "l", "v", "j", "J"],
    {
      selection: [5, 18],
      text: ["hello world helix rocks", "plugins when"],
    },
  ],
  "join lines, trimming": [
    ["hello world", "   helix rocks", "plugins when"],
    ["7", "l", "v", "j", "J"],
    {
      selection: [7, 17],
      text: ["hello world helix rocks", "plugins when"],
    },
  ],
  "join lines, trimming partially": [
    ["hello world", "   helix rocks", "plugins when"],
    ["l", "v", "j", "J"],
    {
      selection: [1, 12],
      text: ["hello world helix rocks", "plugins when"],
    },
  ],
  "insert line and edit, at line break": [
    ["hello world", "helix rocks"],
    ["g", "l", "l", "o", "Escape"],
    {
      selection: [13, 12],
      text: ["hello world", "", "helix rocks"],
    },
  ],
  "yank and paste after": [
    ["hello", "world"],
    ["v", "g", "l", "y", "g", "h", "j", "l", "p"],
    ["hello", "wohellorld"],
  ],
  "yank and paste before": [
    ["hello", "world"],
    ["x", "_", "y", "Alt-;", ";", "j", "l", "P"],
    ["hello", "whelloorld"],
  ],
  "paste from clipboard": ["", [{ copy: "foobar" }, "Space", "p"], "foobar"],
  "paste from clipboard, multiple selections": [
    ["hello", "world", "helix"],
    ["C", "C", "Space", "y", "g", "l", "Space", "p"],
    { text: ["helloh", "worldw", "helixh"], clipboard: ["h", "w", "h"] },
  ],
  "paste from clipboard, external override": [
    ["hello", "world", "helix"],
    ["C", "C", "Space", "y", "g", "l", { copy: "xx" }, "Space", "p"],
    ["helloxx", "worldxx", "helixxx"],
  ],
  "paste from clipboard, multiple selections, collapse": [
    ["hello", "world", "helix"],
    ["C", "C", "Space", "y", "%", "d", "Space", "p"],
    "h",
  ],
  "paste from clipboard, multiple selections, explicit register": [
    ["hello", "world", "helix"],
    ["C", "C", `"`, "+", "y", "g", "l", `"`, "+", "p"],
    { text: ["helloh", "worldw", "helixh"], clipboard: ["h", "w", "h"] },
  ],
  "paste from clipboard, external override, explicit register": [
    ["hello", "world", "helix"],
    ["C", "C", `"`, "+", "y", "g", "l", { copy: "xx" }, `"`, "+", "p"],
    ["helloxx", "worldxx", "helixxx"],
  ],
  "surround add multiple selections": [
    ["xxxeyyy", "xxxxeyyy"],
    ["%", "s", "e", "Enter", "v", "l", "l", "m", "s", ")"],
    {
      text: ["xxx(eyy)y", "xxxx(eyy)y"],
      selection: [
        [3, 8],
        [14, 19],
      ],
    },
  ],
  "select inside": [
    "abc(xyz)abc",
    ["x", "s", "y", "Enter", "m", "i", "("],
    {
      selection: [4, 7],
    },
  ],
  "select around": [
    "abc(xy(z)w)abc",
    ["x", "s", "y", "Enter", "v", "h", "m", "a", "("],
    {
      selection: [11, 3],
    },
  ],
  "select inside, no surrunding parens": [
    "(ab)cd(ef)gh",
    ["4", "l", "m", "i", "("],
    {
      selection: [5, 4],
    },
  ],
  "insert at line end": [
    ["abc", "xyz"],
    ["A", "Escape"],
    {
      selection: [4, 3],
    },
  ],
  "insert at line end, editing": [
    ["abc", "xyz", ""],
    ["A", "u", "Escape"],
    {
      selection: [5, 4],
      text: ["abcu", "xyz", ""],
    },
  ],
  "insert at line end, on line end": [
    ["abc", "xyz"],
    ["A", "Escape", "A", "Escape"],
    {
      selection: [4, 3],
    },
  ],
  "insert at line end, document end": [
    ["abc", "xyz"],
    ["A", "Escape"],
    {
      selection: [4, 3],
    },
  ],
  "insert at start of the line": [
    ["abc", "  xyz", "uvw"],
    ["j", "I", "a", "Escape"],
    {
      selection: [8, 7],
      text: ["abc", "  axyz", "uvw"],
    },
  ],
  "go to last line": [
    ["abc", "xyz"],
    ["g", "e"],
    {
      selection: [5, 4],
    },
  ],
  "go to last line, select mode": [
    ["abc", "xyz"],
    ["v", "g", "e"],
    {
      selection: [0, 5],
    },
  ],
  "go to last line, final empty line": [
    ["abc", "xyz", ""],
    ["g", "e"],
    {
      selection: [5, 4],
    },
  ],
  "go to last line, extra empty line": [
    ["abc", "xyz", "", ""],
    ["g", "e"],
    {
      selection: [9, 8],
    },
  ],
  "duplicate cursor": [
    ["hello world", "helix rocks"],
    ["w", "C", "C", "d"],
    {
      selection: [
        [1, 0],
        [8, 7],
      ],
      text: [" world", " rocks"],
    },
  ],
  "duplicate cursor, multiplier": [
    FIXME,
    ["hello world", "helix rocks", "hummus yum"],
    ["w", "2", "C", "d"],
    {
      text: [" world", " rocks", " yum"],
    },
  ],
  "expand selection": [
    { lang: "js", source: ["const hello = 'world';"] },
    ["f", "e", ";", "Alt-o"],
    {
      selection: [11, 6],
    },
  ],
  "match in brackets": [
    ["hello (world, {what is up}) xyz"],
    ["w", "w", "w", "m", "i", "m"],
    {
      selection: [7, 26],
    },
  ],
  "match in quotes": [
    ['hello "world, what is up" xyz'],
    ["w", "w", "w", "m", "i", "m"],
    {
      selection: [7, 24],
    },
  ],
  "match in nested brakets": [
    ["[[xyz] [abc]]"],
    ["l", "l", "l", "l", "l", "l", "m", "i", "m"],
    {
      selection: [1, 12],
    },
  ],
  "match around quotes": [
    ['hello "world, what is up" xyz'],
    ["w", "w", "w", "m", "a", "m"],
    {
      selection: [6, 25],
    },
  ],
  "match in paragraph": [
    [
      "hello world",
      "",
      "helix rocks",
      "second line of the paragraph",
      "",
      "another line outside",
    ],
    ["j", "j", "m", "i", "p"],
    {
      selection: [13, 54],
    },
  ],
  "match in paragraph with multiple cursor": [
    ["hello world", "", "second line of the paragraph"],
    ["C", "C", "m", "i", "p"],
    {
      selection: [
        [0, 12],
        [13, 41],
      ],
    },
  ],
};

describe("codemirror-helix", () => {
  for (const [title, case_] of Object.entries(cases)) {
    let mode: boolean | typeof FIXME | undefined;
    let source: Source;
    let rawCommands: Command[];
    let expected: Expectation;

    if (case_.length === 4) {
      [mode, source, rawCommands, expected] = case_ as any;
    } else {
      [source, rawCommands, expected] = case_ as any;
    }

    if (process.env.CI && mode != null && mode !== FIXME) {
      throw new Error("Unexpected test focusing");
    }

    const commands = parseCommands(rawCommands);

    const itFn = mode == null ? it : mode === true ? it.only : it.skip;

    itFn(title, async () => {
      await browser.url("http://localhost:45183");

      await initEditor(source);

      for (const command of commands) {
        await (SLOW ? wait(1000) : undefined);
        if ("key" in command) {
          await browser.keys(command.key);
        } else {
          await browser.execute(
            `navigator.clipboard.writeText(${JSON.stringify(command.copy)})`,
          );
        }
      }

      await (SLOW ? wait(1000) : undefined);

      const [expectedSelection, expectedText, expectedClipboard] =
        typeof expected === "string" || Array.isArray(expected)
          ? [null, textToString(expected), null]
          : [
              expected.selection,
              expected.text && textToString(expected.text),
              expected.clipboard && textToString(expected.clipboard),
            ];

      if (expectedSelection != null) {
        const selection = await getSelection();

        const expectation = (
          Array.isArray(expectedSelection[0])
            ? (expectedSelection as Array<[number, number]>)
            : [expectedSelection as [number, number]]
        ).map(([anchor, head]) => ({ anchor, head }));

        expect((selection as any).ranges).toEqual(expectation);
      }

      if (expectedText != null) {
        const doc = await getDoc();

        expect(doc).toBe(expectedText);
      }

      if (expectedClipboard != null) {
        const clipboard = await browser.execute("return navigator.clipboard.readText()");

        expect(clipboard).toBe(expectedClipboard);
      }
    });
  }
});

async function wait(timeout: number) {
  await new Promise<void>((res) => setTimeout(() => res(), timeout));
}

async function initEditor(source: Source) {
  const [text, lang] =
    typeof source === "string" || Array.isArray(source)
      ? [source, null]
      : [source.source, source.lang];

  await expect($(".ready")).toBePresent();

  return browser.execute(
    `return initEditor(${JSON.stringify(textToString(text))}, ${JSON.stringify(lang)})`,
  );
}

function getDoc() {
  return browser.execute("return view.state.doc.toString()");
}

function getSelection() {
  return browser.execute("return view.state.selection.toJSON()");
}

function parseCommands(commands: Command[]) {
  const parsed: Array<Extract<Command, { copy: string }> | { key: string | string[] }> =
    [];

  for (const command of commands) {
    if (typeof command === "object") {
      parsed.push(command);
      continue;
    }

    if (command.startsWith("Alt-")) {
      const key = command.replace("Alt-", "");
      parsed.push({ key: [Key.Alt, key] });
      continue;
    }

    if (command.startsWith("Ctrl-")) {
      const key = command.replace("Ctrl-", "");
      parsed.push({ key: [Key.Ctrl, key] });
      continue;
    }

    parsed.push({ key: command });
  }

  return parsed;
}

function textToString(text: Text) {
  return typeof text === "string" ? text : text.join("\n");
}
