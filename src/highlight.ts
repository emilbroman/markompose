/**
 * A highlighted range of code, in offsets into the code. `tag` names what the
 * range is, like `keyword` or `string`, and may hold several space-separated
 * names, like `variableName definition`.
 */
export interface Token {
  start: number;
  end: number;
  tag: string;
}

/**
 * Highlights a code block's code, its lines without the fences. Ranges must
 * not overlap. Called on every render, so it should be quick.
 */
export type Highlighter = (code: string) => Iterable<Token>;

const highlighters = new Map<string, Highlighter>();

/** Registers a highlighter for code blocks in the given languages. */
export function registerHighlighter(languages: string | string[], highlighter: Highlighter): void {
  for (const language of [languages].flat()) highlighters.set(language.toLowerCase(), highlighter);
}

/** The highlighter for a code block's info string, like `ts` or `rust {.x}`. */
export function highlighterFor(info: string): Highlighter | undefined {
  const [language] = info.split(/\s/, 1);
  return language ? highlighters.get(language.toLowerCase()) : undefined;
}
