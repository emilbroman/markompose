/**
 * A span of inline Markdown, in source offsets. `start`/`end` cover the whole
 * span including its syntax tokens; `open`/`close` are the token lengths.
 */
export interface InlineSpan {
  type: "bold" | "italic" | "code";
  start: number;
  end: number;
  open: number;
  close: number;
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

/**
 * Finds inline spans in the source, following CommonMark
 * (https://spec.commonmark.org/0.31.2/#inlines). Spans are properly nested,
 * ordered by start offset with outer spans first.
 */
export function parseInline(source: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  // Inlines never cross a paragraph break.
  const paragraphBreak = /\n[ \t]*\n/g;
  let from = 0;
  for (const match of source.matchAll(paragraphBreak)) {
    parseParagraph(source, from, match.index, spans);
    from = match.index + match[0].length;
  }
  parseParagraph(source, from, source.length, spans);
  return spans.sort((a, b) => a.start - b.start || b.end - a.end);
}

function parseParagraph(source: string, from: number, to: number, spans: InlineSpan[]): void {
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
function parseEmphasis(source: string, from: number, to: number, code: InlineSpan[], spans: InlineSpan[]): void {
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
