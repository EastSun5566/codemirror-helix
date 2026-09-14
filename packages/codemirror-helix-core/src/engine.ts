import {
  groupBackward,
  groupForward,
  lineBounds,
  nextGraphemeBreak,
  offsetAtLine,
  previousGraphemeBreak,
  rangeFrom,
  rangeTo,
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
  if (state.mode !== "insert") {
    const text = adapter.getDocument();
    adapter.setSelections(
      adapter
        .getSelections()
        .map((selection) =>
          rangeFrom(selection) === rangeTo(selection)
            ? toEditorSelection(selection, text)
            : selection,
        ),
      adapter.getMainSelectionIndex(),
    );
  }
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
        const initial = toInternalSelection(selection, text);
        const head = target(text, initial.head, index);
        return toEditorSelection(
          state.mode === "select"
            ? { anchor: initial.anchor, head }
            : { anchor: head, head },
          text,
        );
      });
    }
    applySelections(selections, adapter.getMainSelectionIndex());
  }

  function selectionIsForward(selection: HelixSelection): boolean {
    return selection.head > rangeFrom(selection);
  }

  function selectionIsAtomic(selection: HelixSelection, text: string): boolean {
    const from = rangeFrom(selection);
    const to = rangeTo(selection);
    return to - from <= 1 || nextGraphemeBreak(text, from) === to;
  }

  function toInternalSelection(selection: HelixSelection, text: string): HelixSelection {
    const from = rangeFrom(selection);
    const to = rangeTo(selection);
    if (from === to) {
      return selection;
    }
    const end = previousGraphemeBreak(text, to);
    return selectionIsForward(selection)
      ? { anchor: from, head: end }
      : { anchor: end, head: from };
  }

  function toEditorSelection(selection: HelixSelection, text: string): HelixSelection {
    const from = rangeFrom(selection);
    const to = rangeTo(selection);
    const end = nextGraphemeBreak(text, to);
    return selectionIsForward(selection)
      ? { anchor: from, head: end }
      : { anchor: end, head: from };
  }

  function groupBoundary(text: string, offset: number, forward: boolean): number {
    return (
      adapter.moveByGroup?.(offset, forward) ??
      (forward ? groupForward(text, offset) : groupBackward(text, offset))
    );
  }

  function moveByGroup(forward: boolean) {
    const text = adapter.getDocument();
    const selections = currentSelections().map((selection) => {
      const rangeForward = selectionIsForward(selection);
      const atomic = selectionIsAtomic(selection, text);
      const headCursor = atomic
        ? selection
        : {
            anchor: rangeForward
              ? previousGraphemeBreak(text, selection.head)
              : nextGraphemeBreak(text, selection.head),
            head: selection.head,
          };
      const anchorCursor = atomic
        ? selection
        : {
            anchor: selection.anchor,
            head: rangeForward
              ? nextGraphemeBreak(text, selection.anchor)
              : previousGraphemeBreak(text, selection.anchor),
          };

      let nextAnchor = forward ? rangeFrom(headCursor) : rangeTo(headCursor);
      let nextHead = groupBoundary(text, nextAnchor, forward);
      const oldEnd = forward ? rangeTo(headCursor) : rangeFrom(headCursor);

      if (nextHead === oldEnd) {
        nextAnchor = nextHead;
        nextHead = groupBoundary(text, nextAnchor, forward);
      }

      if (state.mode !== "select") {
        return { anchor: nextAnchor, head: nextHead };
      }

      const nextRange = { anchor: nextAnchor, head: nextHead };
      const nextHeadCursor = selectionIsAtomic(nextRange, text)
        ? nextRange
        : {
            anchor: forward
              ? previousGraphemeBreak(text, nextRange.head)
              : nextGraphemeBreak(text, nextRange.head),
            head: nextRange.head,
          };

      return rangeTo(nextHeadCursor) < rangeFrom(anchorCursor)
        ? { anchor: rangeTo(anchorCursor), head: rangeFrom(nextHeadCursor) }
        : { anchor: rangeFrom(anchorCursor), head: rangeTo(nextHeadCursor) };
    });

    applySelections(selections, adapter.getMainSelectionIndex());
  }

  function moveVertical(direction: -1 | 1) {
    const text = adapter.getDocument();
    const selections = currentSelections();
    if (!adapter.moveVertically && preferredColumns.length !== selections.length) {
      preferredColumns = selections.map((selection) => {
        const head = toInternalSelection(selection, text).head;
        const line = lineBounds(text, head);
        return head - line.from;
      });
    }
    const distance = count() * direction;
    applySelections(
      selections.map((selection, index) => {
        const initial = toInternalSelection(selection, text);
        let head: number;
        if (adapter.moveVertically) {
          const moved = adapter.moveVertically(
            initial.head,
            distance,
            preferredColumns[index],
          );
          head = moved.offset;
          preferredColumns[index] = moved.goalColumn;
        } else {
          const line = lineBounds(text, initial.head);
          head = offsetAtLine(text, line.number + distance, preferredColumns[index] ?? 0);
        }
        return toEditorSelection(
          state.mode === "select"
            ? { anchor: initial.anchor, head }
            : { anchor: head, head },
          text,
        );
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
    if (name === "+" || name === "*") {
      void adapter.writeClipboard(values.join("\n")).catch(() => {
        status("Unable to write to the clipboard", "error");
      });
    }
  }

  function yank() {
    writeRegister(selectedTexts());
    setMode("normal");
  }

  function remove(enterInsert: boolean, shouldYank = true) {
    if (shouldYank) {
      writeRegister(selectedTexts());
    }
    const changes = selectionChanges("");
    adapter.operation(() => {
      adapter.applyChanges(changes);
      const nextText = adapter.getDocument();
      let offset = 0;
      const cursors = changes.map(({ from, to, insert }) => {
        const head = from + offset;
        offset += insert.length - (to - from);
        const cursor = { anchor: head, head };
        return enterInsert ? cursor : toEditorSelection(cursor, nextText);
      });
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
      const selections = currentSelections();
      const changes = selections.map((selection, index): HelixChange => {
        const at = before ? rangeFrom(selection) : rangeTo(selection);
        return {
          from: at,
          to: at,
          insert: (values[index % values.length] ?? "").repeat(count()),
        };
      });
      let offset = 0;
      const ranges = changes.map(({ from, insert }) => {
        const anchor = from + offset;
        offset += insert.length;
        return { anchor, head: anchor + insert.length };
      });
      adapter.operation(() => {
        adapter.applyChanges(changes);
        applySelections(ranges, adapter.getMainSelectionIndex());
      });
    };
    if (name === "+" || name === "*") {
      void adapter.readClipboard().then(
        (value) => {
          const registered = state.registers[name];
          finish(registered?.join("\n") === value ? registered : [value]);
        },
        () => {
          status("Unable to read from the clipboard", "error");
        },
      );
    } else {
      finish(state.registers[name] ?? state.registers[DEFAULT_REGISTER] ?? []);
    }
  }

  function collapseSelections() {
    const text = adapter.getDocument();
    applySelections(
      currentSelections().map((selection) => {
        const head = toInternalSelection(selection, text).head;
        return toEditorSelection({ anchor: head, head }, text);
      }),
      adapter.getMainSelectionIndex(),
    );
  }

  function enterInsert(at: "before" | "after" | "line-start" | "line-end") {
    const text = adapter.getDocument();
    applySelections(
      currentSelections().map((selection) => {
        const line = lineBounds(text, rangeFrom(selection));
        let head = rangeFrom(selection);
        if (at === "after") {
          head = rangeTo(selection);
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
        let last = lineBounds(text, rangeTo(selection));
        if (
          rangeFrom(selection) !== rangeTo(selection) &&
          rangeTo(selection) === last.from
        ) {
          last = lineBounds(text, rangeTo(selection) - 1);
        }
        const ideal = {
          anchor: first.from,
          head: Math.min(text.length, last.to + 1),
        };
        const perfect =
          rangeFrom(ideal) === rangeFrom(selection) &&
          rangeTo(ideal) === rangeTo(selection);
        if (!perfect && countBuffer === "") {
          return ideal;
        }
        const next = offsetAtLine(text, last.number + count(), Number.MAX_SAFE_INTEGER);
        const nextLine = lineBounds(text, next);
        return {
          anchor: first.from,
          head: Math.min(text.length, nextLine.to + 1),
        };
      }),
      adapter.getMainSelectionIndex(),
    );
  }

  function openLine(above: boolean) {
    const text = adapter.getDocument();
    const selections = currentSelections();
    const changes = selections.map((selection): HelixChange => {
      const internal = toInternalSelection(selection, text);
      const line = lineBounds(text, above ? rangeFrom(internal) : rangeTo(internal));
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
    applySelections(
      currentSelections().map((selection) => {
        const initial = toInternalSelection(selection, text);
        const line = lineBounds(text, initial.head);
        let match = initial.head;

        for (let repetition = 0; repetition < count(); repetition += 1) {
          const next = backwards
            ? text.lastIndexOf(character, Math.max(line.from, match - 1))
            : text.indexOf(character, Math.min(line.to, match + 1));
          if (next < line.from || next > line.to) {
            return selection;
          }
          match = next;
        }

        const head = till
          ? backwards
            ? nextGraphemeBreak(text, match)
            : previousGraphemeBreak(text, match)
          : match;
        return toEditorSelection(
          state.mode === "select"
            ? { anchor: initial.anchor, head }
            : { anchor: initial.head, head },
          text,
        );
      }),
      adapter.getMainSelectionIndex(),
    );
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
    const selections = currentSelections();
    const main = selections[adapter.getMainSelectionIndex()] ?? selections[0];
    if (!main) {
      return;
    }
    const headLine = lineBounds(text, main.head);
    const anchorLine = lineBounds(text, main.anchor);
    for (let lineNumber = headLine.number + 1; ; lineNumber += 1) {
      const lineStart = offsetAtLine(text, lineNumber, 0);
      const line = lineBounds(text, lineStart);
      if (line.number !== lineNumber) {
        return;
      }
      const headColumn = main.head - headLine.from;
      const anchorColumn = main.anchor - anchorLine.from;
      if (headColumn <= line.to - line.from && anchorColumn <= line.to - line.from) {
        const head = line.from + headColumn;
        const anchor = line.from + anchorColumn;
        const range =
          main.head < main.anchor ? { anchor: head, head: anchor } : { anchor, head };
        applySelections([...selections, range], selections.length);
        return;
      }
    }
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
    const selection = currentSelections()[adapter.getMainSelectionIndex()];
    if (!selection) {
      return;
    }
    const first = lineBounds(text, rangeFrom(selection));
    let last = lineBounds(text, rangeTo(selection));
    const sameLine = last.number === first.number;
    if (sameLine) {
      const next = offsetAtLine(text, first.number + 1, 0);
      last = lineBounds(text, next);
    }
    if (last.number === first.number) {
      return;
    }
    let content = "";
    let removed = 0;
    for (let lineNumber = first.number; lineNumber <= last.number; lineNumber += 1) {
      const line = lineBounds(text, offsetAtLine(text, lineNumber, 0));
      let lineContent = text.slice(line.from, line.to);
      if (lineNumber > first.number) {
        const trimmed = lineContent.length - lineContent.trimStart().length;
        let removedHere = trimmed;
        if (
          !sameLine &&
          lineNumber === last.number &&
          rangeTo(selection) - last.from < trimmed
        ) {
          removedHere = rangeTo(selection) - last.from;
        }
        removed += removedHere;
        lineContent = lineContent.slice(trimmed);
      }
      content += lineContent;
      if (lineNumber !== last.number) {
        content += " ";
      }
    }
    const newTo = sameLine ? rangeTo(selection) : rangeTo(selection) - removed;
    const nextSelection =
      selection.anchor > selection.head
        ? { anchor: newTo, head: rangeFrom(selection) }
        : { anchor: rangeFrom(selection), head: newTo };
    adapter.operation(() => {
      adapter.applyChanges([{ from: first.from, to: last.to, insert: content }]);
      applySelections([nextSelection], 0);
    });
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
        if (from === 0) {
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
          const currentLine = lineBounds(text, rangeFrom(selection)).number;
          let before: ReturnType<typeof lineBounds> | undefined;
          let after: ReturnType<typeof lineBounds> | undefined;
          for (let lineNumber = currentLine; lineNumber >= 1; lineNumber -= 1) {
            const line = lineBounds(text, offsetAtLine(text, lineNumber, 0));
            if (line.from === line.to) {
              before = line;
              break;
            }
          }
          const totalLines = lineBounds(text, text.length).number;
          for (let lineNumber = currentLine; lineNumber <= totalLines; lineNumber += 1) {
            const line = lineBounds(text, offsetAtLine(text, lineNumber, 0));
            if (line.from === line.to) {
              after = line;
              break;
            }
          }
          return {
            anchor: before ? before.to + 1 : 0,
            head: after ? after.to : text.length,
          };
        }
        const match = enclosingDelimiter(text, selection.head, requested);
        if (!match) {
          return selection;
        }
        const [open, close] = match;
        const from = around ? open : open + 1;
        const to = around ? close + 1 : close;
        return selectionIsAtomic(selection, text) || selection.anchor <= selection.head
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
        return selectionIsAtomic(selection, text) || selection.anchor <= selection.head
          ? { anchor: start, head: end }
          : { anchor: end, head: start };
      }),
      adapter.getMainSelectionIndex(),
    );
  }

  function searchMatches(
    value: string,
    from = 0,
    to = adapter.getDocument().length,
  ): HelixSelection[] | undefined {
    let expression: RegExp;
    try {
      expression = new RegExp(value, /[A-Z]/u.test(value) ? "gu" : "giu");
    } catch (error) {
      status(error instanceof Error ? error.message : String(error), "error");
      return undefined;
    }
    const text = adapter.getDocument().slice(from, to);
    const matches: HelixSelection[] = [];
    for (const match of text.matchAll(expression)) {
      const at = from + match.index;
      const matched = match[0];
      matches.push({ anchor: at, head: at + matched.length });
    }
    return matches;
  }

  function normalizedSelections(
    selections: readonly HelixSelection[],
    main: HelixSelection,
  ): { selections: HelixSelection[]; mainIndex: number } {
    const sorted = [...selections].sort(
      (left, right) =>
        rangeFrom(left) - rangeFrom(right) || rangeTo(left) - rangeTo(right),
    );
    const unique: HelixSelection[] = [];
    let mainRange = main;
    for (const selection of sorted) {
      const previous = unique.at(-1);
      if (
        previous &&
        rangeFrom(previous) === rangeFrom(selection) &&
        rangeTo(previous) === rangeTo(selection)
      ) {
        if (selection === main) {
          mainRange = previous;
        }
        continue;
      }
      unique.push(selection);
    }
    return {
      selections: unique,
      mainIndex: Math.max(0, unique.indexOf(mainRange)),
    };
  }

  function addOrReplaceMatches(matches: readonly HelixSelection[], select: boolean) {
    if (matches.length === 0) {
      return;
    }
    let selections = currentSelections();
    let mainIndex = adapter.getMainSelectionIndex();
    let main = selections[mainIndex] ?? selections[0];
    for (const match of matches) {
      if (select) {
        selections = [...selections, match];
      } else if (main) {
        selections = selections.map((selection, index) =>
          index === mainIndex ? match : selection,
        );
      } else {
        selections = [match];
      }
      main = match;
      const normalized = normalizedSelections(selections, match);
      selections = normalized.selections;
      mainIndex = normalized.mainIndex;
    }
    applySelections(selections, mainIndex);
  }

  function activeSearch(): string {
    if (selectedRegister) {
      return state.registers[selectedRegister]?.toString() ?? "";
    }
    return state.search;
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
    const main =
      currentSelections()[adapter.getMainSelectionIndex()] ?? currentSelections()[0];
    if (!main) {
      return;
    }
    const found: HelixSelection[] = [];
    let boundary = backwards ? rangeFrom(main) : rangeTo(main);
    for (let repetition = 0; repetition < count(); repetition += 1) {
      const candidates = backwards
        ? matches.filter((match) => rangeTo(match) < boundary)
        : matches.filter((match) => rangeFrom(match) >= boundary);
      const match = backwards
        ? (candidates.at(-1) ?? matches.at(-1))
        : (candidates[0] ?? matches[0]);
      if (!match) {
        break;
      }
      found.push(match);
      boundary = backwards ? rangeFrom(match) : rangeTo(match);
    }
    addOrReplaceMatches(found, state.mode === "select");
  }

  function selectMatches(
    value: string,
    within: readonly HelixSelection[] = currentSelections(),
  ) {
    if (!value) {
      return;
    }
    state.search = value;
    const matches = within.flatMap(
      (selection) => searchMatches(value, rangeFrom(selection), rangeTo(selection)) ?? [],
    );
    if (matches && matches.length > 0) {
      applySelections(matches, 0);
    }
  }

  function prompt(kind: "command" | "search" | "selection-search" | "global-search") {
    const isCommand = kind === "command";
    const initialSelections = currentSelections();
    const initialMainIndex = adapter.getMainSelectionIndex();
    const initialMode = state.mode;
    let input = "";
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
        if (value === input) {
          return;
        }
        input = value;
        if (kind === "selection-search") {
          if (!value) {
            applySelections(initialSelections, initialMainIndex);
          } else {
            selectMatches(value, initialSelections);
          }
        } else if (kind === "search" && value) {
          const matches = searchMatches(value);
          if (!matches || matches.length === 0) {
            applySelections(initialSelections, initialMainIndex);
            return;
          }
          const main = initialSelections[initialMainIndex] ?? initialSelections[0];
          if (!main) {
            return;
          }
          const matched =
            matches.find((match) => rangeFrom(match) >= rangeTo(main)) ?? matches[0];
          if (!matched) {
            return;
          }
          if (initialMode === "select") {
            const normalized = normalizedSelections(
              [...initialSelections, matched],
              matched,
            );
            applySelections(normalized.selections, normalized.mainIndex);
          } else {
            applySelections([matched], 0);
          }
        }
      },
      onSubmit(value) {
        if (isCommand) {
          runCommandLine(value);
        } else if (kind === "search") {
          state.search = value;
        } else if (kind === "global-search") {
          runCommandLine(`global_search ${value}`);
        } else {
          state.search = value;
        }
      },
      onCancel() {
        applySelections(initialSelections, initialMainIndex);
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
        move((text) => {
          const last = lineBounds(text, text.length);
          return last.from === last.to && last.number > 1
            ? lineBounds(text, last.from - 1).from
            : last.from;
        });
      } else if (key === "h") {
        move((text, head) => lineBounds(text, head).from);
      } else if (key === "l") {
        move((text, head) => {
          const line = lineBounds(text, head);
          return line.from === line.to ? line.to : previousGraphemeBreak(text, line.to);
        });
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
      if (state.mode === "insert") {
        const text = adapter.getDocument();
        applySelections(
          currentSelections().map((selection) =>
            rangeFrom(selection) === rangeTo(selection)
              ? toEditorSelection(selection, text)
              : selection,
          ),
          adapter.getMainSelectionIndex(),
        );
      }
      setMode("normal");
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
    if (!["j", "k", "ArrowDown", "ArrowUp"].includes(key)) {
      preferredColumns = [];
    }
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
        moveByGroup(true);
        break;
      case "b":
        moveByGroup(false);
        break;
      case "e":
        moveByGroup(true);
        break;
      case "0":
        move((text, head) => lineBounds(text, head).from);
        break;
      case "$":
        move((text, head) => {
          const line = lineBounds(text, head);
          return line.from === line.to ? line.to : previousGraphemeBreak(text, line.to);
        });
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
        const selected = [...new Set(selectedTexts())].join("|");
        if (selected) {
          state.search = selected;
          state.registers["/"] = [selected];
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
        search(activeSearch());
        break;
      case "N":
        search(activeSearch(), true);
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
