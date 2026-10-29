# markompose

A framework-free Markdown composer element. You edit plain Markdown source, and it renders WYSIWYG-style, showing the Markdown syntax only where it is needed (similar to Obsidian's live preview).

The plain Markdown string is the source of truth. Selection offsets, `value`, and copy/paste all work on that string. Rendering is only a view over it.

```ts
import { Composer } from "markompose";

const composer = new Composer();
composer.value = "# Hello";
document.body.append(composer);
```

```html
<markompose-composer name="body" placeholder="Write…">Initial **markdown**</markompose-composer>
```

`Composer` exposes the same API as `<textarea>`: `value`, `defaultValue`, `selectionStart`/`selectionEnd`, `setSelectionRange()`, `select()`, `placeholder`, `disabled`, `readOnly`, and `name`. It also takes part in forms (submit, reset, and disabled fieldsets), and fires `input` and `change`.

## Syntax highlighting

Code blocks are highlighted by the language after their opening fence, like ```` ```ts ````. No languages are built in; you register them globally. With [Lezer](https://lezer.codemirror.net) parsers, install `@lezer/common` and `@lezer/highlight` along with the grammars you want, then:

```ts
import { registerLanguage } from "markompose/lezer";
import { parser as javascript } from "@lezer/javascript";
import { parser as rust } from "@lezer/rust";

registerLanguage(["ts", "typescript"], javascript.configure({ dialect: "ts" }));
registerLanguage(["rs", "rust"], rust);
```

Any other highlighter can register with `Composer.registerHighlighter(languages, highlighter)`. A highlighter is a function from code to non-overlapping `{ start, end, tag }` ranges.

Each token is styled by its tag's names. Override the default colours with `--md-tok-keyword`, `--md-tok-string`, `--md-tok-literal`, `--md-tok-type`, `--md-tok-name`, `--md-tok-special` and `--md-tok-comment`, or style the tokens directly with `markompose-composer::part(tok-keyword)` and so on.

## Development

Run `nix develop` to get a shell with Node, then:

```sh
npm install
npm run dev        # playground at index.html with scenarios in dev/
npm run build      # library build to dist/
npm run typecheck
```
