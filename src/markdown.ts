/**
 * A span of inline Markdown, in source offsets. `start`/`end` cover the whole
 * span including its syntax tokens; `open`/`close` are the token lengths.
 */
export interface InlineSpan {
  type: "bold";
  start: number;
  end: number;
  open: number;
  close: number;
}

// `**text**` or `__text__` on a single line, not starting or ending with
// whitespace inside the delimiters.
const BOLD = /(\*\*|__)(?!\s)([^\n]*?\S)\1/g;

/** Finds inline spans in the source, ordered by start offset. */
export function parseInline(source: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  for (const match of source.matchAll(BOLD)) {
    const start = match.index;
    const delimiter = match[1]!.length;
    spans.push({ type: "bold", start, end: start + match[0].length, open: delimiter, close: delimiter });
  }
  return spans;
}
