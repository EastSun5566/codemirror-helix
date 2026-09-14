/// <reference types="@wdio/mocha-framework" />
import { expect, browser, $ } from "@wdio/globals";
import { Key } from "webdriverio";
import * as assert from "node:assert";
import portableCases from "../../../test/fixtures/portable-cases.json";

import {
  cases,
  FIXME,
  type Command,
  type Expectation,
  type Source,
  type Text,
} from "../../../test/fixtures/cm6-command-cases.ts";

// set this to `true` to make tests go real slow and help debugging
const SLOW = false;

for (const fixture of portableCases) {
  cases[`portable: ${fixture.name}`] = [
    fixture.initial,
    fixture.actions.map((action) => ("key" in action ? action.key : action.insert)),
    fixture.expected,
  ];
}

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

    before(async () => {
      await browser.setWindowSize(1000, 800);
    });

    itFn(title, async () => {
      await browser.url("http://localhost:45183");

      await initEditor(source);

      for (const command of commands) {
        await (SLOW ? wait(1000) : undefined);
        if ("key" in command) {
          await browser.keys(command.key);
          await browser.execute(
            "return new Promise((resolve) => requestAnimationFrame(() => resolve()))",
          );
        } else if ("copy" in command) {
          await browser.execute(
            `navigator.clipboard.writeText(${JSON.stringify(command.copy)})`,
          );
        } else {
          const lines = await browser.execute<number, []>("return lineWrap()");
          assert.equal(
            lines,
            command.wrap,
            new Error(`expected wrapping to be ${command.wrap}, got ${lines}`),
          );
        }
      }

      await (SLOW ? wait(1000) : undefined);

      const error = browser.$("#error");
      await expect(error).toHaveText("");

      const [expectedSelection, expectedText, expectedClipboard, expectedMain] =
        typeof expected === "string" || Array.isArray(expected)
          ? [null, textToString(expected), null, null]
          : [
              expected.selection,
              expected.text && textToString(expected.text),
              expected.clipboard && textToString(expected.clipboard),
              expected.main,
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

      if (expectedMain != null) {
        const selection = await getSelection();

        expect((selection as any).main).toEqual(expectedMain);
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
  const parsed: Array<Exclude<Command, string> | { key: string | string[] }> = [];

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
