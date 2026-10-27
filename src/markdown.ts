/**
 * A span of Markdown, in source offsets. `start`/`end` cover the whole span
 * including its syntax tokens; `open`/`close` are the token lengths.
 */
export type Span = InlineSpan | HeadingSpan;

interface SpanBase {
  start: number;
  end: number;
  open: number;
  close: number;
}

export interface InlineSpan extends SpanBase {
  type: "bold" | "italic" | "code";
}

/** An ATX heading. It ends at the end of its line, before the newline. */
export interface HeadingSpan extends SpanBase {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

interface Delimiter {
  char: "*" | "_";
  /** Offset of the run in the source. */
  pos: number;
  /** Original run length. */
  length: number;
  /**
   * Unmatched characters, starting at `pos + closeConsumed`. Closing consumes
   * from the left end of what remains, opening from the right end.
   */
  remaining: number;
  closeConsumed: number;
  canOpen: boolean;
  canClose: boolean;
}

const WHITESPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;

// https://spec.commonmark.org/0.31.2/#atx-headings
const HEADING_OPEN = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const HEADING_CLOSE = /(?:^|[ \t]+)#+[ \t]*$/;
const BLANK_LINE = /^[ \t]*$/;

/**
 * Finds the spans in the source, following CommonMark
 * (https://spec.commonmark.org/0.31.2/). Spans are properly nested, ordered by
 * start offset with outer spans first.
 */
export function parse(source: string): Span[] {
  const spans: Span[] = [];
  // Start of the paragraph being collected, if any.
  let paragraph: number | null = null;
  let lineStart = 0;
  for (const line of source.split("\n")) {
    const lineEnd = lineStart + line.length;
    const heading = HEADING_OPEN.exec(line);
    if (heading || BLANK_LINE.test(line)) {
      // Headings and blank lines end paragraphs; inlines never cross them.
      if (paragraph !== null) parseInlines(source, paragraph, lineStart - 1, spans);
      paragraph = null;
    } else {
      paragraph ??= lineStart;
    }
    if (heading) {
      const open = heading[0].length;
      const close = HEADING_CLOSE.exec(line.slice(open))?.[0].length ?? 0;
      const level = heading[1]!.length as HeadingSpan["level"];
      spans.push({ type: "heading", level, start: lineStart, end: lineEnd, open, close });
      parseInlines(source, lineStart + open, lineEnd - close, spans);
    }
    lineStart = lineEnd + 1;
  }
  if (paragraph !== null) parseInlines(source, paragraph, source.length, spans);
  return spans.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** Finds inline spans in source[from, to). */
function parseInlines(source: string, from: number, to: number, spans: Span[]): void {
  // Code spans bind tighter than emphasis: delimiters inside them are literal.
  const code = scanCodeSpans(source, from, to);
  spans.push(...code);
  parseEmphasis(source, from, to, code, spans);
}

/** https://spec.commonmark.org/0.31.2/#code-spans */
function scanCodeSpans(source: string, from: number, to: number): InlineSpan[] {
  const spans: InlineSpan[] = [];
  for (let i = from; i < to; i++) {
    if (source[i] === "\\") {
      i++; // An escaped backtick can't open a code span.
      continue;
    }
    if (source[i] !== "`") continue;

    const length = runLength(source, i, to);
    // The closer is the next backtick run of exactly the same length.
    let close = i + length;
    while (close < to && !(source[close] === "`" && runLength(source, close, to) === length)) {
      close += source[close] === "`" ? runLength(source, close, to) : 1;
    }
    if (close >= to) {
      i += length - 1; // No closer: the run is literal.
      continue;
    }

    // One space of padding on each side is stripped, unless the content is all
    // spaces; treat it as part of the syntax.
    const content = source.slice(i + length, close);
    const padded = /^[ \n]/.test(content) && /[ \n]$/.test(content) && /[^ \n]/.test(content);
    const token = length + (padded ? 1 : 0);
    spans.push({ type: "code", start: i, end: close + length, open: token, close: token });
    i = close + length - 1;
  }
  return spans;
}

function runLength(source: string, i: number, to: number): number {
  let end = i;
  while (end < to && source[end] === source[i]) end++;
  return end - i;
}

/** https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis */
function parseEmphasis(source: string, from: number, to: number, code: InlineSpan[], spans: Span[]): void {
  const delimiters = scanDelimiters(source, from, to, code);

  for (let c = 0; c < delimiters.length; c++) {
    const closer = delimiters[c]!;
    if (!closer.canClose) continue;

    while (closer.remaining > 0) {
      const opener = findOpener(delimiters, c);
      if (!opener) break;
      const use = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;

      opener.remaining -= use;
      const start = opener.pos + opener.closeConsumed + opener.remaining;
      const end = closer.pos + closer.closeConsumed + use;
      closer.closeConsumed += use;
      closer.remaining -= use;
      spans.push({ type: use === 2 ? "bold" : "italic", start, end, open: use, close: use });

      // Delimiters between the pair can no longer match anything.
      for (let i = delimiters.indexOf(opener) + 1; i < c; i++) delimiters[i]!.remaining = 0;
    }
  }
}

function findOpener(delimiters: Delimiter[], c: number): Delimiter | null {
  const closer = delimiters[c]!;
  for (let o = c - 1; o >= 0; o--) {
    const opener = delimiters[o]!;
    if (opener.char !== closer.char || !opener.canOpen || opener.remaining === 0) continue;
    // The "rule of 3": a run that can both open and close can't pair with one
    // whose lengths sum to a multiple of 3, unless both are multiples of 3.
    if (
      (opener.canClose || closer.canOpen) &&
      (opener.length + closer.length) % 3 === 0 &&
      !(opener.length % 3 === 0 && closer.length % 3 === 0)
    ) {
      continue;
    }
    return opener;
  }
  return null;
}

function scanDelimiters(source: string, from: number, to: number, code: InlineSpan[]): Delimiter[] {
  const delimiters: Delimiter[] = [];
  let nextCode = 0;
  for (let i = from; i < to; i++) {
    const span = code[nextCode];
    if (span && i === span.start) {
      i = span.end - 1;
      nextCode++;
      continue;
    }
    const char = source[i]!;
    if (char === "\\") {
      i++; // Skip the escaped character.
      continue;
    }
    if (char !== "*" && char !== "_") continue;

    const end = i + runLength(source, i, to);
    // Line/paragraph boundaries count as whitespace.
    const before = i > from ? source[i - 1]! : " ";
    const after = end < to ? source[end]! : " ";
    const beforeSpace = WHITESPACE.test(before);
    const afterSpace = WHITESPACE.test(after);
    const beforePunct = PUNCTUATION.test(before);
    const afterPunct = PUNCTUATION.test(after);
    const leftFlanking = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
    const rightFlanking = !beforeSpace && (!beforePunct || afterSpace || afterPunct);

    const length = end - i;
    delimiters.push({
      char,
      pos: i,
      length,
      remaining: length,
      closeConsumed: 0,
      canOpen: char === "*" ? leftFlanking : leftFlanking && (!rightFlanking || beforePunct),
      canClose: char === "*" ? rightFlanking : rightFlanking && (!leftFlanking || afterPunct),
    });
    i = end - 1;
  }
  return delimiters;
}
