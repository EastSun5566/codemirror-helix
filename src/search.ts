import { type SearchQuery } from "@codemirror/search";
import { cmdCount } from "./commands";
import { NonInsertMode } from "./entities";
import { EditorState } from "@codemirror/state";

type Match = { from: number; to: number };

// FIXME: this is, of course, abysmal for performance
export function backwardsSearch(
  state: EditorState,
  query: SearchQuery,
  mode: NonInsertMode,
  select: (matches: Match[], main?: number) => void,
) {
  const cursor = query.getCursor(state);
  const selection = state.selection.main;

  const count = cmdCount(mode);
  const beforeRing = new Ring<Match>(count);

  const iter = peekable(cloned(cursor));
  const beforeIter = peekingUntil(iter, (item) => item.to >= selection.from);

  for (const item of beforeIter) {
    beforeRing.push(item);
  }

  if (beforeRing.length === count) {
    select([...beforeRing]);
    return;
  }

  const afterRing = new Ring<Match>(count - beforeRing.length);

  for (const item of iter) {
    afterRing.push(item);
  }

  const total = afterRing.length + beforeRing.length;

  if (total === 0) {
    return {
      match: false as const,
    };
  }

  if (total === count) {
    select([...afterRing, ...beforeRing]);
    return {
      wrapped: true as const,
    };
  }

  const rem = count % total;

  select([...afterRing, ...beforeRing], rem);

  return {
    wrapped: true as const,
  };
}

export class Ring<T> {
  items: T[];
  head = 0;
  length = 0;
  filled = false;
  maxLength: number;

  constructor(length: number) {
    this.items = Array.from({ length });
    this.maxLength = length;
  }

  get first() {
    return this.items[this.start];
  }

  push(item: T) {
    this.items[this.head] = item;
    this.head += 1;
    this.length += 1;

    this.filled ||= this.length > this.maxLength;
    this.head %= this.maxLength;
    this.length = Math.min(this.maxLength, this.length);
  }

  merge(other: Ring<T>) {
    for (let i = 0; i < other.length; i++) {
      const item = other.items[(other.start + i) % other.maxLength];
      this.push(item);
    }
  }

  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) {
      yield this.items[(this.start + i) % this.maxLength];
    }
  }

  private get start() {
    if (this.filled) {
      return this.head;
    } else {
      return 0;
    }
  }
}

function peekingUntil<T, R, N>(
  iter: ReturnType<typeof peekable<T, R, N>>,
  check: (next: T) => boolean,
) {
  const wrapped = {
    [Symbol.iterator]() {
      return wrapped;
    },
    next() {
      const item = iter.peek();

      if (item.done) {
        return item;
      }

      if (check(item.value)) {
        return { value: undefined, done: true as const };
      }

      return iter.next();
    },
  };

  return wrapped;
}

function peekable<T, R, N>(iter: Iterator<T, R, N>) {
  let next = iter.next();

  const peekIter = {
    [Symbol.iterator]() {
      return peekIter;
    },
    next() {
      const item = next;

      if (!item.done) {
        next = iter.next();
      }

      return item;
    },
    peek() {
      return next;
    },
  };

  return peekIter;
}

function cloned<T, R, N>(iter: Iterator<T, R, N>) {
  return {
    next() {
      return { ...iter.next() };
    },
  };
}
