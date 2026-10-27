/**
 * A span of inline Markdown, in source offsets. `start`/`end` cover the whole
 * span including its syntax tokens; `open`/`close` are the token lengths.
 */
export interface InlineSpan {
  type: "bold" | "italic";
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
 * Finds emphasis spans in the source, following CommonMark's delimiter run
 * rules (https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis).
 * Spans are properly nested, ordered by start offset with outer spans first.
 */
export function parseInline(source: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  // Emphasis never crosses a paragraph break.
  const paragraphBreak = /\n[ \t]*\n/g;
  let from = 0;
  for (const match of source.matchAll(paragraphBreak)) {
    parseEmphasis(source, from, match.index, spans);
    from = match.index + match[0].length;
  }
  parseEmphasis(source, from, source.length, spans);
  return spans.sort((a, b) => a.start - b.start || b.end - a.end);
}

function parseEmphasis(source: string, from: number, to: number, spans: InlineSpan[]): void {
  const delimiters = scanDelimiters(source, from, to);

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

function scanDelimiters(source: string, from: number, to: number): Delimiter[] {
  const delimiters: Delimiter[] = [];
  for (let i = from; i < to; i++) {
    const char = source[i]!;
    if (char === "\\") {
      i++; // Skip the escaped character.
      continue;
    }
    if (char !== "*" && char !== "_") continue;

    let end = i;
    while (end < to && source[end] === char) end++;
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
