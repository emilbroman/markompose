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

## Releasing

Releases are managed by [Changesets](https://changesets.dev) and GitHub Actions. CI typechecks the project and builds the npm package on pull requests and pushes to `main`.

### One-time setup

1. In the npm package settings for `markompose`, configure a [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for **GitHub Actions** with these exact values:
   - Organization or user: **`emilbroman`**
   - Repository: **`markompose`**
   - Workflow filename: **`release.yml`** (not the full `.github/workflows/` path)
   - Environment name: **leave blank** (the release job does not use a GitHub environment)
   - Allowed actions: enable **`npm publish`**. Changesets publishes directly; a stage-only trusted publisher is not sufficient.
2. No **`NPM_TOKEN`** or **`NODE_AUTH_TOKEN`** secret is needed or used. The workflow runs on a GitHub-hosted runner with Node 26 (including npm with trusted-publishing support), requests `id-token: write`, and lets npm authenticate via OIDC. Release builds do not restore dependency caches or configure token-based npm authentication. After confirming a successful OIDC publish, revoke any old npm automation token and delete its unused Actions secret.
3. Under [Settings → Actions → General → Workflow permissions](https://github.com/emilbroman/markompose/settings/actions), enable **Allow GitHub Actions to create and approve pull requests**. If the repository option is disabled, an organization owner must first allow it in the [organization's Actions settings](https://github.com/organizations/emilbroman/settings/actions). The workflow requests its own `contents: write` and `pull-requests: write` permissions and uses GitHub's built-in token; no extra GitHub token secret is needed. This GitHub PR permission is separate from npm's OIDC authentication.

### Release flow

1. For a publishable change, run `npm run changeset`, choose a patch/minor/major bump, and describe the change. Commit the generated `.changeset/*.md` file with the code. CI-only or documentation-only changes do not need a changeset.
2. Push or merge to `main`. The **Release** workflow opens or updates a **chore: release** pull request with the new version, changelog, and synchronized npm lockfile.
3. Review and merge that release PR when ready to publish. The next Release run publishes the new version publicly to npm with provenance, pushes a version tag, and creates a GitHub release. The `prepack` hook always rebuilds JavaScript and TypeScript declarations before packaging or publishing.

The initial changeset queues **`markompose@0.1.0`**. Verify the npm trusted-publisher configuration before merging its release PR. To retry a failed release after fixing npm or GitHub settings, rerun the failed job or manually run **Release** from the Actions tab on `main`.
