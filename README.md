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

## Development

Run `nix develop` to get a shell with Node, then:

```sh
npm install
npm run dev        # playground at index.html with scenarios in dev/
npm run build      # library build to dist/
npm run typecheck
```
