// An expectation is either:
// - The final contents of the the document, or
// - A { selection, text } object.
//
export type Expectation =
  // shorthand for  a { text } expectation
  | Text
  | {
      // the final selection, described as an [anchor, head], or an array of such (for multi-selections).
      selection?: [anchor: number, head: number] | Array<[anchor: number, head: number]>;
      // the index of the main selection
      main?: number;
      // the final contents of the editor
      text?: Text;
      // the contents of the clipboard
      clipboard?: Text;
    };

export const FIXME = Symbol();

// represents text as a string or optionally as an array of lines
export type Text = string | string[];

// the editor source described as text or, optionally,
// as text plus a language to be added to the editor config
export type Source = Text | { lang: string; source: Text };

// a command to send to the editor
export type Command =
  // a key to send to the editor (e.g. "a" or "Alt-C")
  | string
  // instructs the browser to enter that text into the clipboard
  | { copy: string }
  | { wrap: number };

// How to write a test case
//
// A test case is just an array with:
// [ initialEditorSource, commandsOrKeys, expectation ]
//
// Optionally, the array can have one more element, a boolean as the first field
// to single out focused/skipped tests (a la `it.only()`/`it.skip()`).
export type Case =
  | [Source, Command[], Expectation]
  | [boolean | typeof FIXME, Source, Command[], Expectation];

export const cases: Record<string, Case> = {
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
  "search, empty input": [
    ["hello", "world"],
    ["w", "/", "w", "o", "Backspace", "Backspace"],
    {
      selection: [6, 7],
    },
  ],
  "search, custom register": [
    ["hello", "world", "helix", "rocks"],
    ["y", `"`, `"`, "n"],
    {
      selection: [12, 13],
    },
  ],
  "search, selection mode": [
    ["hello", "world", "helix", "rocks"],
    ["w", "v", "/", "r", "o", "Enter"],
    {
      selection: [
        [0, 5],
        [18, 20],
      ],
      main: 1,
    },
  ],
  "search, selection mode, multiple": [
    ["hello", "world", "helix", "rocks"],
    ["%", "s", "h", "e", "Enter", "v", "/", "w", "Enter"],
    {
      selection: [
        [0, 2],
        [6, 7],
        [12, 14],
      ],
      main: 1,
    },
  ],
  "search, selection mode, next": [
    ["hello", "world", "helix", "rocks"],
    ["/", "l", "Enter", "v", "n"],
    {
      selection: [
        [2, 3],
        [3, 4],
      ],
      main: 1,
    },
  ],
  "search, selection mode, prev": [
    ["hello", "world", "helix", "rocks"],
    ["j", "j", "/", "l", "Enter", "v", "N"],
    {
      selection: [
        [9, 10],
        [14, 15],
      ],
      main: 0,
    },
  ],
  "search, normal mode, deselect": [
    ["hello", "world", "helix", "rocks"],
    ["%", "s", "e", "|", "w", "Enter", "n"],
    {
      selection: [
        [6, 7],
        [13, 14],
      ],
      main: 0,
    },
  ],
  "search, normal mode, skip over": [
    ["hello", "world", "helix", "rocks"],
    ["v", "l", "*", "v", "h", "j", "v", "l", "N", "v", "n"],
    {
      selection: [
        [6, 8],
        [12, 14],
      ],
      main: 1,
    },
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
    ["hello world", "helix rocks", "hummus yum"],
    ["w", "2", "C", "d"],
    {
      text: [" world", " rocks", "hummus yum"],
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
  "move vertically with wrapped lines, last line": [
    ["hello", `world${"d".repeat(200)}`],
    [{ wrap: 3 }, "j", "j", "k"],
    { selection: [7, 6] },
  ],
  "move vertically with wrapped lines": [
    ["hello", `world${"d".repeat(200)}`, "bye"],
    [{ wrap: 4 }, "j", "j", "k"],
    { selection: [7, 6] },
  ],
  "move around visual line end": [
    ["hello", `world${"d".repeat(200)}`],
    [{ wrap: 3 }, "j", "j", "h", "h", "l", "l", "k"],
    { selection: [7, 6] },
  ],
  "select vertically with wrapped lines, last line": [
    ["hello", `world${"d".repeat(200)}`],
    [{ wrap: 3 }, "j", "v", "j", "k"],
    { selection: [7, 6] },
  ],
  "select vertically with wrapped lines": [
    ["hello", `world${"d".repeat(200)}`, "bye"],
    [{ wrap: 4 }, "j", "v", "j", "k"],
    { selection: [7, 6] },
  ],
  "select around visual line end": [
    ["hello", `world${"d".repeat(200)}`],
    [{ wrap: 3 }, "j", "v", "j", "h", "h", "l", "l", "k"],
    { selection: [7, 6] },
  ],
  "select vertically from last line stops": [
    ["hello", "world"],
    ["v", "j", "j"],
    { selection: [0, 11] },
  ],
};
