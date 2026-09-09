import type { HelixSelection } from "./types.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function rangeFrom(selection: HelixSelection): number {
  return Math.min(selection.anchor, selection.head);
}

export function rangeTo(selection: HelixSelection): number {
  return Math.max(selection.anchor, selection.head);
}

export function nextGraphemeBreak(text: string, offset: number): number {
  const start = clamp(offset, 0, text.length);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const segment of segmenter.segment(text.slice(start))) {
    if (segment.index > 0) {
      return start + segment.index;
    }
  }
  return text.length;
}

export function previousGraphemeBreak(text: string, offset: number): number {
  const end = clamp(offset, 0, text.length);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let previous = 0;
  for (const segment of segmenter.segment(text.slice(0, end))) {
    if (segment.index >= end) {
      break;
    }
    previous = segment.index;
  }
  return previous;
}

export interface LineBounds {
  from: number;
  to: number;
  number: number;
}

export function lineBounds(text: string, offset: number): LineBounds {
  const at = clamp(offset, 0, text.length);
  const from = text.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const next = text.indexOf("\n", at);
  const to = next < 0 ? text.length : next;
  let number = 0;
  for (let i = 0; i < from; i += 1) {
    if (text.charCodeAt(i) === 10) {
      number += 1;
    }
  }
  return { from, to, number };
}

export function offsetAtLine(text: string, targetLine: number, column: number): number {
  const wanted = Math.max(0, targetLine);
  let line = 0;
  let from = 0;
  for (let i = 0; i < text.length && line < wanted; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      from = i + 1;
    }
  }
  const to = text.indexOf("\n", from);
  return clamp(from + Math.max(0, column), from, to < 0 ? text.length : to);
}

export function wordForward(text: string, offset: number): number {
  let position = clamp(offset, 0, text.length);
  const kind = characterKind(text[position] ?? "");
  while (position < text.length && characterKind(text[position] ?? "") === kind) {
    position = nextGraphemeBreak(text, position);
  }
  while (position < text.length && /\s/u.test(text[position] ?? "")) {
    position = nextGraphemeBreak(text, position);
  }
  return position;
}

export function wordBackward(text: string, offset: number): number {
  let position = previousGraphemeBreak(text, offset);
  while (position > 0 && /\s/u.test(text[position] ?? "")) {
    position = previousGraphemeBreak(text, position);
  }
  const kind = characterKind(text[position] ?? "");
  while (position > 0) {
    const previous = previousGraphemeBreak(text, position);
    if (characterKind(text[previous] ?? "") !== kind) {
      break;
    }
    position = previous;
  }
  return position;
}

export function wordEnd(text: string, offset: number): number {
  let position = clamp(offset, 0, text.length);
  while (position < text.length && /\s/u.test(text[position] ?? "")) {
    position = nextGraphemeBreak(text, position);
  }
  const kind = characterKind(text[position] ?? "");
  let next = nextGraphemeBreak(text, position);
  while (next < text.length && characterKind(text[next] ?? "") === kind) {
    position = next;
    next = nextGraphemeBreak(text, next);
  }
  return position;
}

function characterKind(character: string): "word" | "space" | "punctuation" {
  if (/\s/u.test(character)) {
    return "space";
  }
  if (/[\p{L}\p{N}_]/u.test(character)) {
    return "word";
  }
  return "punctuation";
}
