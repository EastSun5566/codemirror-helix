import {
  lineBounds,
  nextGraphemeBreak,
  offsetAtLine,
  previousGraphemeBreak,
  rangeFrom,
  rangeTo,
  wordBackward,
  wordEnd,
  wordForward,
} from "./text.js";
import type {
  HelixChange,
  HelixCommandContext,
  HelixEditorAdapter,
  HelixEngine,
  HelixEngineOptions,
  HelixMode,
  HelixSelection,
  HelixSnapshot,
} from "./types.js";

const DEFAULT_REGISTER = '"';

function copySnapshot(snapshot: HelixSnapshot): HelixSnapshot {
  return {
    version: 1,
    mode: snapshot.mode,
    selections: snapshot.selections?.map((selection) => ({ ...selection })),
    mainIndex: snapshot.mainIndex,
    registers: Object.fromEntries(
      Object.entries(snapshot.registers).map(([name, values]) => [name, [...values]]),
    ),
    search: snapshot.search,
    theme: snapshot.theme,
    history: snapshot.history,
  };
}

function initialSnapshot(adapter: HelixEditorAdapter): HelixSnapshot {
  return {
    version: 1,
    mode: "normal",
    selections: adapter.getSelections().map((selection) => ({ ...selection })),
    mainIndex: adapter.getMainSelectionIndex(),
    registers: {},
    search: "",
  };
}

export function createHelixEngine(
  adapter: HelixEditorAdapter,
  options: HelixEngineOptions = {},
): HelixEngine {
  let destroyed = false;
  const state = copySnapshot(options.init ?? initialSnapshot(adapter));
  if (options.globalInit) {
    state.registers = copySnapshot(options.globalInit).registers;
    state.search = options.globalInit.search;
    state.theme = options.globalInit.theme;
  }
  let countBuffer = "";
  let prefix = "";
  let selectedRegister: string | undefined;
  let preferredColumns: number[] = [];

  const defaultRegister =
    options.config?.["editor.default-yank-register"] ?? DEFAULT_REGISTER;
  state.registers = { ...state.registers };
  if (state.selections) {
    adapter.setSelections(state.selections, state.mainIndex);
  }
  if (state.history !== undefined) {
    adapter.setHistory?.(state.history);
  }
  adapter.setMode(state.mode ?? "normal");
  if (state.theme) {
    adapter.changeTheme(state.theme);
  }

  function status(message: string, type: "message" | "error" = "message") {
    options.onStatus?.({ type, message });
  }

  function resetTransient() {
    countBuffer = "";
    prefix = "";
    selectedRegister = undefined;
  }

  function count(): number {
    return Math.max(1, Number.parseInt(countBuffer || "1", 10));
  }

  function registerName(): string {
    return selectedRegister ?? defaultRegister;
  }

  function setMode(mode: HelixMode) {
    if (destroyed || state.mode === mode) {
      return;
    }
    state.mode = mode;
    adapter.setMode(mode);
    options.onStatus?.({ type: "mode", mode });
  }

  function currentSelections(): HelixSelection[] {
    return adapter.getSelections().map((selection) => ({ ...selection }));
  }

  function applySelections(selections: readonly HelixSelection[], mainIndex?: number) {
    const documentLength = adapter.getDocument().length;
    const safe = selections.length === 0 ? [{ anchor: 0, head: 0 }] : selections;
    adapter.setSelections(
      safe.map(({ anchor, head }) => ({
        anchor: Math.max(0, Math.min(documentLength, anchor)),
        head: Math.max(0, Math.min(documentLength, head)),
      })),
      mainIndex,
    );
  }

  function move(target: (text: string, head: number, index: number) => number) {
    const text = adapter.getDocument();
    let selections = currentSelections();
    for (let repetition = 0; repetition < count(); repetition += 1) {
      selections = selections.map((selection, index) => {
        const head = target(text, selection.head, index);
        return state.mode === "select"
          ? { anchor: selection.anchor, head }
          : { anchor: head, head };
      });
    }
    applySelections(selections, adapter.getMainSelectionIndex());
  }

  function moveVertical(direction: -1 | 1) {
    const text = adapter.getDocument();
    const selections = currentSelections();
    if (preferredColumns.length !== selections.length) {
      preferredColumns = selections.map((selection) => {
        const line = lineBounds(text, selection.head);
        return selection.head - line.from;
      });
    }
    const distance = count() * direction;
    applySelections(
      selections.map((selection, index) => {
        const line = lineBounds(text, selection.head);
        const head = offsetAtLine(
          text,
          line.number + distance,
          preferredColumns[index] ?? 0,
        );
        return state.mode === "select"
          ? { anchor: selection.anchor, head }
          : { anchor: head, head };
      }),
      adapter.getMainSelectionIndex(),
    );
  }

  function selectionChanges(insert: string | ((value: string, index: number) => string)) {
    const text = adapter.getDocument();
    return currentSelections().map((selection, index): HelixChange => {
      const from = rangeFrom(selection);
      let to = rangeTo(selection);
      if (from === to && to < text.length) {
        to = nextGraphemeBreak(text, to);
      }
      return {
        from,
        to,
        insert:
          typeof insert === "function" ? insert(text.slice(from, to), index) : insert,
      };
    });
  }

  function selectedTexts(): string[] {
    const text = adapter.getDocument();
    return currentSelections().map((selection) => {
      const from = rangeFrom(selection);
      const to =
        from === rangeTo(selection) ? nextGraphemeBreak(text, from) : rangeTo(selection);
      return text.slice(from, to);
    });
  }

  function writeRegister(values: string[]) {
    const name = registerName();
    state.registers[name] = [...values];
    state.registers[DEFAULT_REGISTER] = [...values];
    if (name === "+" || name === "*") {
      void adapter.writeClipboard(values.join("\n")).catch(() => {
        status("Unable to write to the clipboard", "error");
      });
    }
  }

  function yank() {
    writeRegister(selectedTexts());
    setMode("normal");
    collapseSelections();
  }

  function remove(enterInsert: boolean, shouldYank = true) {
    if (shouldYank) {
      writeRegister(selectedTexts());
    }
    const changes = selectionChanges("");
    const cursors = changes.map(({ from }) => ({ anchor: from, head: from }));
    adapter.operation(() => {
      adapter.applyChanges(changes);
      applySelections(cursors, adapter.getMainSelectionIndex());
    });
    setMode(enterInsert ? "insert" : "normal");
  }

  function paste(before: boolean) {
    const name = registerName();
    const finish = (values: readonly string[]) => {
      if (values.length === 0) {
        return;
      }
      const text = adapter.getDocument();
      const selections = currentSelections();
      const changes = selections.map((selection, index): HelixChange => {
        const from = rangeFrom(selection);
        const to = rangeTo(selection);
        const at = before ? from : from === to ? nextGraphemeBreak(text, to) : to;
        return { from: at, to: at, insert: values[index % values.length] ?? "" };
      });
      const cursors = changes.map(({ from, insert }) => ({
        anchor: from,
        head: Math.max(from, from + insert.length - 1),
      }));
      adapter.operation(() => {
        adapter.applyChanges(changes);
        applySelections(cursors, adapter.getMainSelectionIndex());
      });
    };
    if (name === "+" || name === "*") {
      void adapter.readClipboard().then(
        (value) => finish([value]),
        () => {
          status("Unable to read from the clipboard", "error");
        },
      );
    } else {
      finish(state.registers[name] ?? state.registers[DEFAULT_REGISTER] ?? []);
    }
  }

  function collapseSelections() {
    applySelections(
      currentSelections().map((selection) => ({
        anchor: rangeFrom(selection),
        head: rangeFrom(selection),
      })),
      adapter.getMainSelectionIndex(),
    );
  }

  function enterInsert(at: "before" | "after" | "line-start" | "line-end") {
    const text = adapter.getDocument();
    applySelections(
      currentSelections().map((selection) => {
        const line = lineBounds(text, selection.head);
        let head = rangeFrom(selection);
        if (at === "after") {
          head = nextGraphemeBreak(text, rangeTo(selection));
        }
        if (at === "line-start") {
          const match = /\S/u.exec(text.slice(line.from, line.to));
          head = line.from + (match?.index ?? 0);
        }
        if (at === "line-end") {
          head = line.to;
        }
        return { anchor: head, head };
      }),
      adapter.getMainSelectionIndex(),
    );
    setMode("insert");
  }

  function selectLines() {
    const text = adapter.getDocument();
    applySelections(
      currentSelections().map((selection) => {
        const first = lineBounds(text, rangeFrom(selection));
        const last = lineBounds(text, rangeTo(selection));
        return { anchor: first.from, head: Math.min(text.length, last.to + 1) };
      }),
      adapter.getMainSelectionIndex(),
    );
  }

  function openLine(above: boolean) {
    const text = adapter.getDocument();
    const selections = currentSelections();
    const changes = selections.map((selection): HelixChange => {
      const line = lineBounds(text, selection.head);
      return above
        ? { from: line.from, to: line.from, insert: "\n" }
        : { from: line.to, to: line.to, insert: "\n" };
    });
    adapter.operation(() => adapter.applyChanges(changes));
    const shift = above ? 0 : 1;
    applySelections(
      changes.map(({ from }) => ({ anchor: from + shift, head: from + shift })),
      adapter.getMainSelectionIndex(),
    );
    setMode("insert");
  }

  function insertBlankLine(above: boolean) {
    const text = adapter.getDocument();
    const changes = currentSelections().map((selection): HelixChange => {
      const line = lineBounds(text, above ? rangeFrom(selection) : rangeTo(selection));
      return {
        from: above ? line.from : line.to,
        to: above ? line.from : line.to,
        insert: "\n".repeat(count()),
      };
    });
    adapter.applyChanges(changes);
  }

  function changeNumber(increase: boolean) {
    const text = adapter.getDocument();
    const changes = currentSelections().flatMap((selection): HelixChange[] => {
      const from = rangeFrom(selection);
      const rawTo = rangeTo(selection);
      const to = from === rawTo ? nextGraphemeBreak(text, rawTo) : rawTo;
      const value = text.slice(from, to);
      const match = /-?\d+/u.exec(value);
      if (!match) {
        return [];
      }
      const number = Number(match[0]) + (increase ? count() : -count());
      return [
        {
          from: from + match.index,
          to: from + match.index + match[0].length,
          insert: String(number),
        },
      ];
    });
    if (changes.length > 0) {
      adapter.applyChanges(changes);
    }
  }

  function findCharacter(character: string, backwards: boolean, till: boolean) {
    const text = adapter.getDocument();
    move((_, head) => {
      const line = lineBounds(text, head);
      const match = backwards
        ? text.lastIndexOf(character, Math.max(line.from, head - 1))
        : text.indexOf(character, Math.min(line.to, head + 1));
      if (match < line.from || match > line.to) {
        return head;
      }
      if (!till) {
        return match;
      }
      return backwards
        ? nextGraphemeBreak(text, match)
        : previousGraphemeBreak(text, match);
    });
  }

  function matchBracket() {
    const text = adapter.getDocument();
    const pairs: Record<string, [string, number]> = {
      "(": [")", 1],
      "[": ["]", 1],
      "{": ["}", 1],
      ")": ["(", -1],
      "]": ["[", -1],
      "}": ["{", -1],
    };
    move((_, head) => {
      const current = text[head];
      const pair = current ? pairs[current] : undefined;
      if (!pair) {
        return head;
      }
      const [wanted, direction] = pair;
      let depth = 1;
      for (let at = head + direction; at >= 0 && at < text.length; at += direction) {
        if (text[at] === current) {
          depth += 1;
        }
        if (text[at] === wanted) {
          depth -= 1;
        }
        if (depth === 0) {
          return at;
        }
      }
      return head;
    });
  }

  function selectAllDocument() {
    const length = adapter.getDocument().length;
    applySelections([{ anchor: 0, head: length }], 0);
  }

  function reverseSelections(forward = false) {
    applySelections(
      currentSelections().map((selection) =>
        forward
          ? { anchor: rangeFrom(selection), head: rangeTo(selection) }
          : { anchor: selection.head, head: selection.anchor },
      ),
      adapter.getMainSelectionIndex(),
    );
  }

  function rotateMain(direction: -1 | 1) {
    const selections = currentSelections();
    if (selections.length < 2) {
      return;
    }
    const main = adapter.getMainSelectionIndex();
    const next = (main + direction + selections.length) % selections.length;
    applySelections(selections, next);
  }

  function keepMainSelection() {
    const selections = currentSelections();
    const main = adapter.getMainSelectionIndex();
    applySelections([selections[main] ?? selections[0] ?? { anchor: 0, head: 0 }], 0);
  }

  function selectLinesSeparately() {
    const text = adapter.getDocument();
    const lines = new Map<number, HelixSelection>();
    for (const selection of currentSelections()) {
      const first = lineBounds(text, rangeFrom(selection));
      const last = lineBounds(text, rangeTo(selection));
      for (let number = first.number; number <= last.number; number += 1) {
        const from = offsetAtLine(text, number, 0);
        const line = lineBounds(text, from);
        lines.set(number, { anchor: line.from, head: line.to });
      }
    }
    applySelections([...lines.values()], 0);
  }

  function duplicateSelectionsOnNextLines() {
    const text = adapter.getDocument();
    const original = currentSelections();
    const duplicated = [...original];
    for (let repetition = 0; repetition < count(); repetition += 1) {
      const source = duplicated.slice(-original.length);
      for (const selection of source) {
        const anchorLine = lineBounds(text, selection.anchor);
        const headLine = lineBounds(text, selection.head);
        const anchor = offsetAtLine(
          text,
          anchorLine.number + 1,
          selection.anchor - anchorLine.from,
        );
        const head = offsetAtLine(
          text,
          headLine.number + 1,
          selection.head - headLine.from,
        );
        if (anchor !== selection.anchor || head !== selection.head) {
          duplicated.push({ anchor, head });
        }
      }
    }
    applySelections(duplicated, duplicated.length - 1);
  }

  function trimSelections() {
    const text = adapter.getDocument();
    applySelections(
      currentSelections().map((selection) => {
        const from = rangeFrom(selection);
        const to = rangeTo(selection);
        const value = text.slice(from, to);
        const left = value.length - value.trimStart().length;
        const right = value.length - value.trimEnd().length;
        return selection.anchor <= selection.head
          ? { anchor: from + left, head: to - right }
          : { anchor: to - right, head: from + left };
      }),
      adapter.getMainSelectionIndex(),
    );
  }

  function changeCase(kind: "upper" | "lower" | "toggle") {
    adapter.applyChanges(
      selectionChanges((value) => {
        if (kind === "upper") {
          return value.toUpperCase();
        }
        if (kind === "lower") {
          return value.toLowerCase();
        }
        return [...value]
          .map((character) =>
            character === character.toUpperCase()
              ? character.toLowerCase()
              : character.toUpperCase(),
          )
          .join("");
      }),
    );
  }

  function replaceWithCharacter(character: string) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    adapter.applyChanges(
      selectionChanges((value) =>
        character.repeat(Array.from(segmenter.segment(value)).length),
      ),
    );
  }

  function replaceWithRegister() {
    const name = registerName();
    const finish = (values: readonly string[]) => {
      if (values.length === 0) {
        return;
      }
      const changes = selectionChanges((_value, index) =>
        (values[index % values.length] ?? "").repeat(count()),
      );
      adapter.applyChanges(changes);
      applySelections(
        changes.map(({ from, insert }) => ({ anchor: from, head: from + insert.length })),
        adapter.getMainSelectionIndex(),
      );
    };
    if (name === "+" || name === "*") {
      void adapter.readClipboard().then((value) => finish([value]));
    } else {
      finish(state.registers[name] ?? state.registers[DEFAULT_REGISTER] ?? []);
    }
  }

  function joinSelectedLines() {
    const text = adapter.getDocument();
    const changes: HelixChange[] = [];
    for (const selection of currentSelections()) {
      const first = lineBounds(text, rangeFrom(selection));
      let last = lineBounds(text, rangeTo(selection));
      if (last.number === first.number && last.to < text.length) {
        last = lineBounds(text, last.to + 1);
      }
      if (last.number === first.number) {
        continue;
      }
      const value = text
        .slice(first.from, last.to)
        .split("\n")
        .map((line, index) => (index === 0 ? line : line.trimStart()))
        .join(" ");
      changes.push({ from: first.from, to: last.to, insert: value });
    }
    if (changes.length > 0) {
      adapter.applyChanges(changes);
    }
  }

  const delimiterPairs: Record<string, [string, string]> = {
    "(": ["(", ")"],
    ")": ["(", ")"],
    "[": ["[", "]"],
    "]": ["[", "]"],
    "{": ["{", "}"],
    "}": ["{", "}"],
    "<": ["<", ">"],
    ">": ["<", ">"],
    '"': ['"', '"'],
    "'": ["'", "'"],
    "`": ["`", "`"],
  };

  function enclosingDelimiter(
    text: string,
    position: number,
    requested: string,
  ): [number, number] | undefined {
    const candidates =
      requested === "m"
        ? Object.values(delimiterPairs)
        : delimiterPairs[requested]
          ? [delimiterPairs[requested]]
          : [];
    let best: [number, number] | undefined;
    for (const [open, close] of candidates) {
      if (open === close) {
        const from = text.lastIndexOf(open, position);
        const to = text.indexOf(close, Math.max(position + 1, from + 1));
        if (from >= 0 && to >= position && (!best || to - from < best[1] - best[0])) {
          best = [from, to];
        }
        continue;
      }
      for (
        let from = text.lastIndexOf(open, position);
        from >= 0;
        from = text.lastIndexOf(open, from - 1)
      ) {
        let depth = 1;
        for (let to = from + 1; to < text.length; to += 1) {
          if (text[to] === open) {
            depth += 1;
          } else if (text[to] === close) {
            depth -= 1;
          }
          if (depth === 0) {
            if (to >= position && (!best || to - from < best[1] - best[0])) {
              best = [from, to];
            }
            break;
          }
        }
        if (best?.[0] === from) {
          break;
        }
      }
    }
    return best;
  }

  function selectDelimiter(requested: string, around: boolean) {
    const text = adapter.getDocument();
    applySelections(
      currentSelections().map((selection) => {
        if (requested === "p") {
          const before = text.lastIndexOf("\n\n", Math.max(0, selection.head - 1));
          const after = text.indexOf("\n\n", selection.head);
          const from = before < 0 ? 0 : before + 2;
          const to = after < 0 ? text.length : after;
          return selection.anchor <= selection.head
            ? { anchor: from, head: to }
            : { anchor: to, head: from };
        }
        const match = enclosingDelimiter(text, selection.head, requested);
        if (!match) {
          return selection;
        }
        const [open, close] = match;
        const from = around ? open : open + 1;
        const to = around ? close + 1 : close;
        return selection.anchor <= selection.head
          ? { anchor: from, head: to }
          : { anchor: to, head: from };
      }),
      adapter.getMainSelectionIndex(),
    );
  }

  function surroundSelections(delimiter: string) {
    const [open, close] = delimiterPairs[delimiter] ?? [delimiter, delimiter];
    const text = adapter.getDocument();
    const selections = currentSelections();
    const ranges = selections.map((selection) => {
      const from = rangeFrom(selection);
      const rawTo = rangeTo(selection);
      const to = from === rawTo ? nextGraphemeBreak(text, rawTo) : rawTo;
      return { selection, from, to };
    });
    const changes = ranges.flatMap(({ from, to }): HelixChange[] => {
      return [
        { from: to, to, insert: close },
        { from, to: from, insert: open },
      ];
    });
    adapter.applyChanges(changes);
    applySelections(
      ranges.map(({ selection, from, to }) => {
        const shift = ranges
          .filter((range) => range.to <= from)
          .reduce((total) => total + open.length + close.length, 0);
        const start = from + shift;
        const end = to + shift + open.length + close.length;
        return selection.anchor <= selection.head
          ? { anchor: start, head: end }
          : { anchor: end, head: start };
      }),
      adapter.getMainSelectionIndex(),
    );
  }

  function searchMatches(value: string): HelixSelection[] | undefined {
    let expression: RegExp;
    try {
      expression = new RegExp(value, /[A-Z]/u.test(value) ? "gu" : "giu");
    } catch (error) {
      status(error instanceof Error ? error.message : String(error), "error");
      return undefined;
    }
    const text = adapter.getDocument();
    const matches: HelixSelection[] = [];
    for (const match of text.matchAll(expression)) {
      const at = match.index;
      const matched = match[0];
      matches.push({ anchor: at, head: at + matched.length });
    }
    return matches;
  }

  function search(value: string, backwards = false) {
    if (!value) {
      return;
    }
    state.search = value;
    const matches = searchMatches(value);
    if (!matches || matches.length === 0) {
      status("No matches", "error");
      return;
    }
    const selections = currentSelections();
    applySelections(
      selections.map((selection) => {
        const ordered = backwards ? [...matches].reverse() : matches;
        const boundary = backwards ? rangeFrom(selection) : rangeTo(selection);
        const candidates = ordered.filter((match) =>
          backwards ? rangeTo(match) <= boundary : rangeFrom(match) >= boundary,
        );
        const pool = candidates.length > 0 ? candidates : ordered;
        return pool[(count() - 1) % pool.length] ?? selection;
      }),
      adapter.getMainSelectionIndex(),
    );
  }

  function selectMatches(value: string) {
    if (!value) {
      return;
    }
    state.search = value;
    const matches = searchMatches(value);
    if (matches && matches.length > 0) {
      applySelections(matches, 0);
    }
  }

  function prompt(kind: "command" | "search" | "selection-search" | "global-search") {
    const isCommand = kind === "command";
    options.onPrompt?.({
      kind,
      label: isCommand
        ? ":"
        : kind === "selection-search"
          ? "select /"
          : kind === "global-search"
            ? "global /"
            : "/",
      initialValue: isCommand ? "" : state.search,
      onInput(value) {
        if (kind === "selection-search") {
          selectMatches(value);
        }
      },
      onSubmit(value) {
        if (isCommand) {
          runCommandLine(value);
        } else if (kind === "search") {
          search(value);
        } else if (kind === "global-search") {
          runCommandLine(`global_search ${value}`);
        } else {
          selectMatches(value);
        }
      },
      onCancel() {
        status("Cancelled");
      },
    });
  }

  function context(): HelixCommandContext {
    return {
      adapter,
      mode: state.mode ?? "normal",
      count: count(),
      register: registerName(),
      engine,
    };
  }

  function runCommandLine(value: string) {
    const [name, ...args] = value.trim().split(/\s+/u);
    if (!name) {
      return;
    }
    const external = options.externalCommands?.[name];
    if (!external) {
      status(`Unknown command: ${name}`, "error");
      return;
    }
    void Promise.resolve(external(context(), args)).catch((error: unknown) => {
      status(error instanceof Error ? error.message : String(error), "error");
    });
  }

  function runCustomCommand(key: string): boolean {
    for (const command of options.commands ?? []) {
      const keys = typeof command.keys === "string" ? [command.keys] : command.keys;
      if (
        !keys.includes(key) ||
        (command.modes && !command.modes.includes(state.mode ?? "normal"))
      ) {
        continue;
      }
      return command.run(context()) !== false;
    }
    return false;
  }

  function handlePrefixedKey(key: string): boolean {
    if (prefix === '"') {
      selectedRegister = key;
      prefix = "";
      return true;
    }
    if (
      prefix === "find" ||
      prefix === "find-back" ||
      prefix === "till" ||
      prefix === "till-back"
    ) {
      findCharacter(key, prefix.includes("back"), prefix.includes("till"));
      resetTransient();
      return true;
    }
    if (prefix === "g") {
      if (key === "g") {
        move(() => 0);
      } else if (key === "e") {
        move((text) => lineBounds(text, text.trimEnd().length).from);
      } else if (key === "h") {
        move((text, head) => lineBounds(text, head).from);
      } else if (key === "l") {
        move((text, head) => lineBounds(text, head).to);
      } else if (key === "s") {
        move((text, head) => {
          const line = lineBounds(text, head);
          const match = /\S/u.exec(text.slice(line.from, line.to));
          return line.from + (match?.index ?? 0);
        });
      } else if (key === "j") {
        moveVertical(1);
      } else if (key === "k") {
        moveVertical(-1);
      } else if (key === "n") {
        runCommandLine(":buffer-next");
      } else if (key === "p") {
        runCommandLine(":buffer-previous");
      } else {
        return false;
      }
      resetTransient();
      return true;
    }
    if (prefix === "m") {
      if (key === "m") {
        matchBracket();
        resetTransient();
        return true;
      }
      if (key === "s") {
        prefix = "surround";
        return true;
      }
      if (key === "i") {
        prefix = "match-inside";
        return true;
      }
      if (key === "a") {
        prefix = "match-around";
        return true;
      }
      return false;
    }
    if (prefix === "surround") {
      surroundSelections(key);
      resetTransient();
      return true;
    }
    if (prefix === "match-inside" || prefix === "match-around") {
      selectDelimiter(key, prefix === "match-around");
      resetTransient();
      return true;
    }
    if (prefix === "replace") {
      replaceWithCharacter(key);
      resetTransient();
      return true;
    }
    if (prefix === "left-bracket" || prefix === "right-bracket") {
      if (key !== "Space" && key !== " ") {
        return false;
      }
      insertBlankLine(prefix === "left-bracket");
      resetTransient();
      return true;
    }
    if (prefix === "space") {
      if (key === "y") {
        selectedRegister = "+";
        yank();
      } else if (key === "p" || key === "P") {
        selectedRegister = "+";
        paste(key === "P");
      } else if (key === "R") {
        selectedRegister = "+";
        replaceWithRegister();
      } else if (key === "c") {
        adapter.toggleComment();
      } else if (key === "f") {
        runCommandLine("file_picker");
      } else if (key === "b") {
        runCommandLine("buffer_picker");
      } else if (key === "/") {
        prompt("global-search");
      } else {
        return false;
      }
      resetTransient();
      return true;
    }
    if (prefix === "z") {
      const command =
        key === "t"
          ? "line-top"
          : key === "z"
            ? "line-center"
            : key === "b"
              ? "line-bottom"
              : undefined;
      if (!command) {
        return false;
      }
      adapter.scroll(command);
      resetTransient();
      return true;
    }
    return false;
  }

  function handleKey(key: string): boolean {
    if (destroyed) {
      return false;
    }
    if (key === "Escape" || key === "Esc") {
      setMode("normal");
      collapseSelections();
      resetTransient();
      return true;
    }
    if (state.mode === "insert") {
      return false;
    }
    if (prefix) {
      if (!handlePrefixedKey(key)) {
        resetTransient();
      }
      return true;
    }
    if (runCustomCommand(key)) {
      resetTransient();
      return true;
    }
    if (/^[1-9]$/u.test(key) || (countBuffer && key === "0")) {
      countBuffer += key;
      return true;
    }
    preferredColumns = [];
    let handled = true;
    switch (key) {
      case '"':
        prefix = '"';
        break;
      case "g":
        prefix = "g";
        break;
      case "z":
        prefix = "z";
        break;
      case "m":
        prefix = "m";
        break;
      case "Space":
      case " ":
        prefix = "space";
        break;
      case "r":
        prefix = "replace";
        break;
      case "[":
        prefix = "left-bracket";
        break;
      case "]":
        prefix = "right-bracket";
        break;
      case "f":
        prefix = "find";
        break;
      case "F":
        prefix = "find-back";
        break;
      case "t":
        prefix = "till";
        break;
      case "T":
        prefix = "till-back";
        break;
      case "h":
      case "ArrowLeft":
        move((text, head) => previousGraphemeBreak(text, head));
        break;
      case "l":
      case "ArrowRight":
        move((text, head) => nextGraphemeBreak(text, head));
        break;
      case "j":
      case "ArrowDown":
        moveVertical(1);
        break;
      case "k":
      case "ArrowUp":
        moveVertical(-1);
        break;
      case "w":
        move((text, head) => wordForward(text, head));
        break;
      case "b":
        move((text, head) => wordBackward(text, head));
        break;
      case "e":
        move((text, head) => wordEnd(text, head));
        break;
      case "0":
        move((text, head) => lineBounds(text, head).from);
        break;
      case "$":
        move((text, head) => lineBounds(text, head).to);
        break;
      case "v":
        setMode(state.mode === "select" ? "normal" : "select");
        break;
      case "x":
        selectLines();
        break;
      case ";":
        collapseSelections();
        setMode("normal");
        break;
      case "%":
        selectAllDocument();
        break;
      case "Alt-s":
        selectLinesSeparately();
        break;
      case "Alt-;":
        reverseSelections();
        break;
      case "Alt-:":
        reverseSelections(true);
        break;
      case ",":
        keepMainSelection();
        break;
      case "(":
        rotateMain(-1);
        break;
      case ")":
        rotateMain(1);
        break;
      case "y":
        yank();
        break;
      case "d":
        remove(false);
        break;
      case "c":
        remove(true);
        break;
      case "Alt-d":
        remove(false, false);
        break;
      case "Alt-c":
        remove(true, false);
        break;
      case "p":
        paste(false);
        break;
      case "P":
        paste(true);
        break;
      case "R":
        replaceWithRegister();
        break;
      case "i":
        enterInsert("before");
        break;
      case "a":
        enterInsert("after");
        break;
      case "I":
        enterInsert("line-start");
        break;
      case "A":
        enterInsert("line-end");
        break;
      case "o":
        openLine(false);
        break;
      case "O":
        openLine(true);
        break;
      case "C":
        duplicateSelectionsOnNextLines();
        break;
      case "J":
        joinSelectedLines();
        break;
      case "_":
        trimSelections();
        break;
      case "*": {
        const selected = selectedTexts()[0];
        if (selected) {
          state.search = selected;
        }
        break;
      }
      case "u":
        for (let repetition = 0; repetition < count(); repetition += 1) {
          if (!adapter.undo()) {
            break;
          }
        }
        break;
      case "U":
        for (let repetition = 0; repetition < count(); repetition += 1) {
          if (!adapter.redo()) {
            break;
          }
        }
        break;
      case "Ctrl-a":
        changeNumber(true);
        break;
      case "Ctrl-x":
        changeNumber(false);
        break;
      case ">":
        adapter.indent("more");
        break;
      case "<":
        adapter.indent("less");
        break;
      case "Ctrl-c":
        adapter.toggleComment();
        break;
      case "Ctrl-u":
      case "PageUp":
        adapter.scroll("half-page-up");
        break;
      case "Ctrl-d":
      case "PageDown":
        adapter.scroll("half-page-down");
        break;
      case "/":
        prompt("search");
        break;
      case "s":
        prompt("selection-search");
        break;
      case ":":
        prompt("command");
        break;
      case "n":
        search(state.search);
        break;
      case "N":
        search(state.search, true);
        break;
      case "Alt-o":
        if (!adapter.syntax?.selectParent?.()) {
          status("Syntax parent selection is unsupported by this adapter");
        }
        break;
      case "Alt-i":
        status("Syntax selection shrinking is unsupported by this adapter");
        break;
      case "Alt-n":
        if (!adapter.syntax?.selectSibling?.("next")) {
          status("Syntax sibling selection is unsupported by this adapter");
        }
        break;
      case "Alt-p":
        if (!adapter.syntax?.selectSibling?.("previous")) {
          status("Syntax sibling selection is unsupported by this adapter");
        }
        break;
      case "~":
        changeCase("toggle");
        break;
      case "`":
        changeCase("lower");
        break;
      case "Alt-`":
        changeCase("upper");
        break;
      default:
        handled = false;
    }
    if (handled && !prefix) {
      resetTransient();
    }
    return handled;
  }

  const engine: HelixEngine = {
    getMode: () => state.mode ?? "normal",
    setMode,
    resetMode() {
      setMode("normal");
      collapseSelections();
      resetTransient();
    },
    handleKey,
    snapshot(global = false) {
      const snapshot = copySnapshot(state);
      if (global) {
        delete snapshot.mode;
        delete snapshot.selections;
        delete snapshot.mainIndex;
        delete snapshot.history;
      } else {
        snapshot.selections = currentSelections();
        snapshot.mainIndex = adapter.getMainSelectionIndex();
        snapshot.history = adapter.getHistory?.();
      }
      return snapshot;
    },
    applyGlobalSnapshot(snapshot) {
      state.registers = copySnapshot(snapshot).registers;
      state.search = snapshot.search;
      state.theme = snapshot.theme;
      if (snapshot.theme) {
        adapter.changeTheme(snapshot.theme);
      }
    },
    readRegister(name) {
      return state.registers[name] ? [...state.registers[name]] : undefined;
    },
    changeTheme(theme) {
      const changed = adapter.changeTheme(theme);
      if (changed) {
        state.theme = theme;
      }
      return changed;
    },
    destroy() {
      destroyed = true;
      resetTransient();
    },
  };

  return engine;
}
