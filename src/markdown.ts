/**
 * A span of Markdown, in source offsets. `start`/`end` cover the whole span
 * including its syntax tokens; `open`/`close` are the token lengths.
 */
export type Span = InlineSpan | LinkSpan | HeadingSpan | BlockquoteSpan | QuoteMarkerSpan;

interface SpanBase {
  start: number;
  end: number;
  open: number;
  close: number;
}

export interface InlineSpan extends SpanBase {
  type: "bold" | "italic" | "code";
}

/** An inline link, `[text](href "title")`. The close token is `](...)`. */
export interface LinkSpan extends SpanBase {
  type: "link";
  href: string;
  title?: string;
}

/**
 * A block quote. It has no tokens of its own; each of its lines starts with a
 * QuoteMarkerSpan. It ends at the end of its last line, before the newline.
 */
export interface BlockquoteSpan extends SpanBase {
  type: "blockquote";
}

/** The `>` that puts one line in a block quote; all of it is syntax. */
export interface QuoteMarkerSpan extends SpanBase {
  type: "quote-marker";
  /** Where the marker's line ends. */
  lineEnd: number;
  /** The quote the marker belongs to. */
  quote: BlockquoteSpan;
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

// https://spec.commonmark.org/0.31.2/#block-quotes
const QUOTE_MARKER = /^ {0,3}> ?/;

/** A line of source; `content` is where it starts inside its containers. */
interface Line {
  content: number;
  end: number;
}

/**
 * Finds the spans in the source, following CommonMark
 * (https://spec.commonmark.org/0.31.2/). Spans are properly nested, ordered by
 * start offset with outer spans first.
 */
export function parse(source: string): Span[] {
  const spans: Span[] = [];
  const lines: Line[] = [];
  let lineStart = 0;
  for (const line of source.split("\n")) {
    lines.push({ content: lineStart, end: lineStart + line.length });
    lineStart += line.length + 1;
  }
  parseBlocks(source, lines, spans);
  // A quote of a lone `>` covers the same range as its marker; the container
  // goes outside.
  const rank = (span: Span) => (span.type === "blockquote" ? 0 : 1);
  return spans.sort((a, b) => a.start - b.start || b.end - a.end || rank(a) - rank(b));
}

/** Parses consecutive lines as a sequence of blocks. */
function parseBlocks(source: string, lines: Line[], spans: Span[]): void {
  // Inlines never cross a block boundary, so collect paragraph lines first.
  let paragraph: Line[] = [];
  const endParagraph = () => {
    if (paragraph.length > 0) parseInlines(source, paragraph[0]!.content, paragraph.at(-1)!.end, spans);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    const text = source.slice(line.content, line.end);

    if (QUOTE_MARKER.test(text)) {
      endParagraph();
      // Consecutive marked lines form the quote. CommonMark's lazy
      // continuation lines, without a marker, aren't supported.
      const quote: BlockquoteSpan = { type: "blockquote", start: line.content, end: line.end, open: 0, close: 0 };
      const inner: Line[] = [];
      for (; i < lines.length; i++) {
        const { content, end } = lines[i]!;
        const marker = QUOTE_MARKER.exec(source.slice(content, end));
        if (!marker) break;
        const length = marker[0].length;
        spans.push({ type: "quote-marker", start: content, end: content + length, open: length, close: 0, lineEnd: end, quote });
        inner.push({ content: content + length, end });
        quote.end = end;
      }
      spans.push(quote);
      parseBlocks(source, inner, spans);
      continue;
    }

    const heading = HEADING_OPEN.exec(text);
    if (heading) {
      endParagraph();
      const open = heading[0].length;
      const close = HEADING_CLOSE.exec(text.slice(open))?.[0].length ?? 0;
      const level = heading[1]!.length as HeadingSpan["level"];
      spans.push({ type: "heading", level, start: line.content, end: line.end, open, close });
      parseInlines(source, line.content + open, line.end - close, spans);
    } else if (BLANK_LINE.test(text)) {
      endParagraph();
    } else {
      paragraph.push(line);
    }
    i++;
  }
  endParagraph();
}

/** Finds inline spans in source[from, to). */
function parseInlines(source: string, from: number, to: number, spans: Span[]): void {
  // Precedence: code spans, then link brackets, then emphasis. Brackets and
  // delimiters inside code spans are literal, and emphasis can't cross a
  // link's boundary, though it can wrap a whole link.
  const code = scanCodeSpans(source, from, to);
  const links = scanLinks(source, from, to, code);
  spans.push(...code, ...links);

  const inside = (outer: Range) => (inner: Range) => inner.start >= outer.start && inner.end <= outer.end;
  const opaque = [...code.filter((c) => !links.some((link) => inside(link)(c))), ...links];
  parseEmphasis(source, from, to, opaque.sort((a, b) => a.start - b.start), spans);
  for (const link of links) {
    const text: Range = { start: link.start + link.open, end: link.end - link.close };
    parseEmphasis(source, text.start, text.end, code.filter(inside(text)), spans);
  }
}

interface Range {
  start: number;
  end: number;
}

/** https://spec.commonmark.org/0.31.2/#links (inline links only) */
function scanLinks(source: string, from: number, to: number, code: Range[]): LinkSpan[] {
  const links: LinkSpan[] = [];
  const openers: { pos: number; active: boolean }[] = [];
  let nextCode = 0;
  for (let i = from; i < to; i++) {
    const span = code[nextCode];
    if (span && i === span.start) {
      i = span.end - 1;
      nextCode++;
      continue;
    }
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "[") {
      openers.push({ pos: i, active: true });
      continue;
    }
    if (char !== "]") continue;

    // The nearest opener is used up either way.
    const opener = openers.pop();
    if (!opener?.active) continue;
    const destination = source[i + 1] === "(" ? parseDestination(source, i + 1, to) : null;
    if (!destination) continue;

    links.push({
      type: "link",
      start: opener.pos,
      end: destination.end,
      open: 1,
      close: destination.end - i,
      href: destination.href,
      ...(destination.title !== undefined && { title: destination.title }),
    });
    // Links can't contain links.
    for (const outer of openers) outer.active = false;
    i = destination.end - 1;
  }
  return links.sort((a, b) => a.start - b.start);
}

/**
 * Parses `(href "title")` starting at the `(`.
 * https://spec.commonmark.org/0.31.2/#link-destination
 */
function parseDestination(
  source: string,
  paren: number,
  to: number,
): { end: number; href: string; title?: string } | null {
  const skipSpace = (i: number) => {
    while (i < to && WHITESPACE.test(source[i]!)) i++;
    return i;
  };

  let i = skipSpace(paren + 1);
  let href: string;
  if (source[i] === "<") {
    let j = i + 1;
    for (; j < to && source[j] !== ">"; j++) {
      if (source[j] === "\n" || source[j] === "<") return null;
      if (source[j] === "\\") j++;
    }
    if (j >= to) return null;
    href = source.slice(i + 1, j);
    i = j + 1;
  } else {
    let j = i;
    let depth = 0;
    for (; j < to; j++) {
      const char = source[j]!;
      if (char === "\\") {
        j++;
        continue;
      }
      if (WHITESPACE.test(char) || char < " ") break;
      if (char === "(") depth++;
      if (char === ")" && depth-- === 0) break;
    }
    if (depth > 0) return null;
    href = source.slice(i, j);
    i = j;
  }

  let title: string | undefined;
  const afterHref = i;
  i = skipSpace(i);
  const quote = source[i];
  if (i > afterHref && (quote === '"' || quote === "'" || quote === "(")) {
    const closer = quote === "(" ? ")" : quote;
    let j = i + 1;
    for (; j < to && source[j] !== closer; j++) if (source[j] === "\\") j++;
    if (j >= to) return null;
    title = unescape(source.slice(i + 1, j));
    i = skipSpace(j + 1);
  }
  if (source[i] !== ")") return null;
  return { end: i + 1, href: unescape(href), ...(title !== undefined && { title }) };
}

/** Removes backslash escapes. https://spec.commonmark.org/0.31.2/#backslash-escapes */
function unescape(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
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
/** `opaque` are sorted ranges, like code spans, whose content is skipped. */
function parseEmphasis(source: string, from: number, to: number, opaque: Range[], spans: Span[]): void {
  const delimiters = scanDelimiters(source, from, to, opaque);

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

function scanDelimiters(source: string, from: number, to: number, opaque: Range[]): Delimiter[] {
  const delimiters: Delimiter[] = [];
  let next = 0;
  for (let i = from; i < to; i++) {
    const range = opaque[next];
    if (range && i === range.start) {
      i = range.end - 1;
      next++;
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
