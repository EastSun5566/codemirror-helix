import portableCases from "../../../test/fixtures/portable-cases.json";

declare global {
  interface Window {
    cm5Test: {
      reset(): void;
      create(value?: string): number;
      key(index: number, value: string, modifiers?: KeyboardEventInit): void;
      value(index: number): string;
      mode(index: number): string;
      replace(index: number, value: string): void;
      snapshot(index: number): unknown;
      setSelections(
        index: number,
        ranges: Array<{ anchor: number; head: number }>,
        mainIndex?: number,
      ): void;
      selections(index: number): Array<{ anchor: number; head: number }>;
      mainIndex(index: number): number;
      clipboard(): string;
      setClipboard(value: string): void;
      submitPrompt(value: string): void;
      messages(index: number): string[];
      setWrapping(index: number, enabled: boolean): void;
      theme(index: number): string;
      changeTheme(index: number, theme: string): boolean;
      destroy(index: number): void;
      reenable(index: number): void;
      hasPanel(index: number): boolean;
      hasClass(index: number): boolean;
    };
  }
}

async function call<T>(callback: (api: Window["cm5Test"]) => T): Promise<T> {
  return browser.execute((source) => {
    const callback = Function("api", `return (${source})(api)`) as (
      api: Window["cm5Test"],
    ) => T;
    return callback(window.cm5Test);
  }, callback.toString());
}

describe("codemirror-helix-cm5", () => {
  beforeEach(async () => {
    await browser.url("http://localhost:45184");
    await browser.waitUntil(() => browser.execute(() => Boolean(window.cm5Test)));
  });

  it("uses select mode and falls back to native input only in insert mode", async () => {
    const index = await call((api) => api.create("abc"));
    await call((api) => api.key(0, "v"));
    expect(await call((api) => api.mode(0))).toBe("select");
    await call((api) => api.replace(0, "blocked"));
    expect(await call((api) => api.value(0))).toBe("abc");
    await call((api) => api.key(0, "i"));
    await call((api) => api.replace(0, "ok"));
    expect(await call((api) => api.value(0))).toBe("okabc");
    expect(index).toBe(0);
  });

  it("isolates mode and state across editor instances", async () => {
    await call((api) => {
      api.create("one");
      api.create("two");
      api.key(0, "i");
    });
    expect(await call((api) => api.mode(0))).toBe("insert");
    expect(await call((api) => api.mode(1))).toBe("normal");
  });

  it("supports motions, counts, deletion, registers, and snapshots", async () => {
    await call((api) => {
      api.create("one two");
      api.key(0, "w");
      api.key(0, "d");
    });
    expect(await call((api) => api.value(0))).toBe(" two");
    const snapshot = (await call((api) => api.snapshot(0))) as {
      registers: Record<string, string[]>;
    };
    expect(snapshot.registers['"']).toEqual(["one"]);
  });

  it("matches CM6 word-group selections", async () => {
    await call((api) => {
      api.create("move to     test");
      api.setSelections(0, [{ anchor: 5, head: 5 }]);
      api.key(0, "w");
    });
    expect(await call((api) => api.selections(0))).toEqual([{ anchor: 5, head: 7 }]);

    await call((api) => api.key(0, "d"));
    expect(await call((api) => api.value(0))).toBe("move      test");
    const snapshot = (await call((api) => api.snapshot(0))) as {
      registers: Record<string, string[]>;
    };
    expect(snapshot.registers['"']).toEqual(["to"]);
  });

  it("preserves multiple selections, main index, and reverse direction", async () => {
    await call((api) => {
      api.create("abcd");
      api.setSelections(
        0,
        [
          { anchor: 0, head: 1 },
          { anchor: 4, head: 2 },
        ],
        1,
      );
    });
    const snapshot = (await call((api) => api.snapshot(0))) as {
      selections: Array<{ anchor: number; head: number }>;
      mainIndex: number;
    };
    expect(snapshot.selections).toEqual([
      { anchor: 0, head: 1 },
      { anchor: 4, head: 2 },
    ]);
    expect(snapshot.mainIndex).toBe(1);
  });

  it("handles Unicode and the system clipboard register", async () => {
    await call((api) => {
      api.create("👨‍👩‍👧‍👦x");
      api.key(0, "l");
      api.setSelections(0, [{ anchor: 0, head: 11 }]);
      api.key(0, '"');
      api.key(0, "+");
      api.key(0, "y");
    });
    await browser.waitUntil(async () => (await call((api) => api.clipboard())) !== "");
    expect(await call((api) => api.clipboard())).toBe("👨‍👩‍👧‍👦");
  });

  it("supports search panels, undo/redo, comments, and bracket scanning", async () => {
    await call((api) => {
      api.create("(one)\nconst value = 1;");
      api.key(0, "%");
      api.key(0, "Escape");
      api.key(0, "/");
      api.submitPrompt("value");
    });
    expect(await call((api) => api.selections(0))).toEqual([{ anchor: 12, head: 17 }]);
    await call((api) => {
      api.key(0, "x");
      api.key(0, "c", { ctrlKey: true });
    });
    expect(await call((api) => api.value(0))).toContain("// const value = 1;");
    await call((api) => {
      api.key(0, "u");
      api.key(0, "U");
      api.setSelections(0, [{ anchor: 0, head: 0 }]);
      api.key(0, "Escape");
      api.key(0, "m");
      api.key(0, "i");
      api.key(0, "m");
    });
    expect(await call((api) => api.selections(0))).toEqual([{ anchor: 1, head: 4 }]);
  });

  it("keeps syntax-only keys inert and works with wrapped editors", async () => {
    await call((api) => {
      api.create("a very long wrapped line that should span several visual rows");
      api.setWrapping(0, true);
      for (const key of ["o", "i", "n", "p"]) {
        api.key(0, key, { altKey: true });
      }
      api.key(0, "d", { ctrlKey: true });
    });
    expect(await call((api) => api.value(0))).toBe(
      "a very long wrapped line that should span several visual rows",
    );
    expect(await call((api) => api.messages(0))).toEqual([
      "Syntax parent selection is unsupported by this adapter",
      "Syntax selection shrinking is unsupported by this adapter",
      "Syntax sibling selection is unsupported by this adapter",
      "Syntax sibling selection is unsupported by this adapter",
    ]);
  });

  it("changes themes and fully tears down adapter UI", async () => {
    await call((api) => {
      api.create();
      api.changeTheme(0, "monokai");
    });
    expect(await call((api) => api.theme(0))).toBe("monokai");
    expect(await call((api) => api.hasPanel(0))).toBe(true);
    await call((api) => api.destroy(0));
    expect(await call((api) => api.theme(0))).toBe("default");
    expect(await call((api) => api.hasPanel(0))).toBe(false);
    expect(await call((api) => api.hasClass(0))).toBe(false);
    await call((api) => api.reenable(0));
    expect(await call((api) => api.hasPanel(0))).toBe(true);
  });

  for (const fixture of portableCases) {
    it(`portable: ${fixture.name}`, async () => {
      await browser.execute((initial) => window.cm5Test.create(initial), fixture.initial);
      for (const action of fixture.actions) {
        await browser.execute((next) => {
          if ("key" in next) {
            window.cm5Test.key(0, next.key);
          } else {
            window.cm5Test.replace(0, next.insert);
          }
        }, action);
      }
      const expected =
        typeof fixture.expected === "string"
          ? { text: fixture.expected }
          : fixture.expected;
      expect(await call((api) => api.value(0))).toBe(expected.text);
      if (expected.selection) {
        const selections = Array.isArray(expected.selection[0])
          ? expected.selection
          : [expected.selection];
        expect(await call((api) => api.selections(0))).toEqual(
          selections.map(([anchor, head]) => ({ anchor, head })),
        );
      }
    });
  }
});

export {};
