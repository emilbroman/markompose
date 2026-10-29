import type { Parser } from "@lezer/common";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { Composer } from "./composer";
import type { Token } from "./highlight";

/**
 * Highlights code blocks in the given languages with a Lezer parser, like
 * `registerLanguage(["ts", "typescript"], parser.configure({ dialect: "ts" }))`
 * with `parser` from `@lezer/javascript`.
 */
export function registerLanguage(languages: string | string[], parser: Parser): void {
  Composer.registerHighlighter(languages, (code) => {
    const tokens: Token[] = [];
    highlightTree(parser.parse(code), classHighlighter, (start, end, classes) => {
      // `tok-keyword tok-definition` is tagged `keyword definition`.
      tokens.push({ start, end, tag: classes.replace(/\btok-/g, "") });
    });
    return tokens;
  });
}
