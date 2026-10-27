import { parse, type LinkSpan, type QuoteMarkerSpan, type Span } from "./markdown";

function tagFor(span: Span): string {
  switch (span.type) {
    case "bold":
      return "strong";
    case "italic":
      return "em";
    case "code":
      return "code";
    case "link":
      return "a";
    case "heading":
      return `h${span.level}`;
    case "blockquote":
      return "blockquote";
    case "quote-marker":
      return "span";
  }
}

/** Block-level spans keep the newline that ends them inside their element. */
function isBlock(span: Span): boolean {
  return span.type === "heading" || span.type === "blockquote";
}

/**
 * Spans whose syntax is at the start of a line. A caret after that syntax is
 * where the user means to type, and their tokens don't stack with inline ones.
 */
function isLineSyntax(span: Span): boolean {
  return isBlock(span) || span.type === "quote-marker";
}

/** The range a selection must touch for the span's syntax to show. */
function revealRange(span: Span): [number, number] {
  // A quote's markers show while any of the quote is touched.
  return span.type === "quote-marker" ? [span.quote.start, span.quote.end] : [span.start, span.end];
}

// Schemes that run code rather than navigate.
const UNSAFE_HREF = /^\s*(?:javascript|vbscript|data):/i;

function linkify(anchor: HTMLAnchorElement, span: LinkSpan): void {
  if (!UNSAFE_HREF.test(span.href)) anchor.setAttribute("href", span.href);
  if (span.title !== undefined) anchor.title = span.title;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
}

/** A `<br>` for layout only, that isn't part of the source. */
function sentinel(): HTMLBRElement {
  const br = document.createElement("br");
  br.setAttribute(SENTINEL, "");
  return br;
}

/** A caret just inside a span's tokens, moved to just outside them. */
function outside(span: Span, caret: number): number {
  // Opening side first: for a span that's all syntax, like a quote's `>`,
  // after it is both, and the line's syntax starts before it.
  if (caret === span.start + span.open) return span.start;
  if (caret === span.end - span.close) return span.end;
  return caret;
}

/** Whether a span is all of its line's text, like a lone `#` or `>`. */
function isWholeLineSyntax(span: Span): boolean {
  if (span.type === "heading") return span.start + span.open === span.end - span.close;
  return span.type === "quote-marker" && span.end === span.lineEnd;
}

function syntax(text: string): HTMLElement {
  const element = document.createElement("span");
  element.className = "md-syntax";
  element.textContent = text;
  return element;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The offset of the grapheme boundary before `offset`. */
function graphemeBefore(text: string, offset: number): number {
  // Graphemes are short; a window around the offset is enough.
  const from = Math.max(0, offset - 32);
  const segments = [...graphemes.segment(text.slice(from, offset))];
  return from + (segments.at(-1)?.index ?? 0);
}

/** The offset of the grapheme boundary after `offset`. */
function graphemeAfter(text: string, offset: number): number {
  const [first] = graphemes.segment(text.slice(offset, offset + 32));
  return offset + (first?.segment.length ?? 0);
}

/** Marks the `<br>` that keeps a trailing newline visible; it is not source. */
const SENTINEL = "data-sentinel";

const STYLES = `
:host {
  display: inline-block;
  box-sizing: border-box;
  min-width: 12em;
  min-height: 4lh;
  overflow: auto;
  border: 1px solid #8888;
  border-radius: 4px;
  padding: 4px 6px;
  font: inherit;
  color: inherit;
  background: Field;
  cursor: text;
}
:host(:focus-within) {
  outline: 2px solid Highlight;
  outline-offset: -1px;
}
:host([disabled]) {
  opacity: 0.6;
  cursor: default;
}
.editor {
  min-height: 100%;
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.md-syntax {
  color: GrayText;
}
.md-heading {
  margin: 0.25em 0;
  /* In em, so a quote marker inside inherits the heading's line height. */
  line-height: 1.25em;
}
.md-link {
  color: LinkText;
  text-decoration: underline;
}
/* While editing, links are followed with Cmd/Ctrl + click. */
.editor.follow-links .md-link[href] {
  cursor: pointer;
}
.md-blockquote {
  position: relative;
  margin: 0;
  /* As wide as the \`> \` marker, measured, so text stays put when it shows. */
  padding-left: var(--md-quote-indent, 1em);
}
.md-blockquote::before {
  content: "";
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 2px;
  background: #8886;
}
/*
 * Markers sit in their quotes' indents: each is pulled left to its quote's
 * edge, and its right margin returns to where it started, so that whichever
 * of a line's markers show, they take no space.
 */
.md-quote-marker.active {
  margin-left: calc(-1 * var(--md-shift, 0px));
  margin-right: calc(var(--md-shift, 0px) - var(--md-width, 0px));
}
.md-heading > .md-quote-marker {
  font-size: var(--md-font-size);
  font-weight: var(--md-font-weight);
}
/*
 * A line of nothing but hidden syntax would collapse. Hold it open with
 * generated content, which isn't part of the source the way text would be.
 */
.md-syntax-line::before {
  content: "\\200b";
}
.md-measure {
  position: absolute;
  visibility: hidden;
  white-space: pre;
  pointer-events: none;
}
.md-code {
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  background: #8882;
  border-radius: 3px;
  padding: 0.1em 0.2em;
}
/* Syntax tokens are only shown while the selection touches their span. */
.md-span:not(.active) > .md-syntax {
  display: none;
}
.editor:empty::before {
  content: attr(data-placeholder);
  color: GrayText;
  pointer-events: none;
}
`;

/**
 * A Markdown composer that behaves like a `<textarea>`.
 *
 * The source of truth is always the plain Markdown string in `value`, and all
 * selection offsets refer to positions in that string. Rendering is a view
 * over the source; it never changes what the user is editing.
 */
export class Composer extends HTMLElement {
  static readonly tagName = "markompose-composer";
  static readonly formAssociated = true;
  static readonly observedAttributes = ["placeholder", "disabled", "readonly"];

  /** Registers the element under `tagName` (or a custom name). Idempotent. */
  static define(tagName: string = Composer.tagName): void {
    if (!customElements.get(tagName)) customElements.define(tagName, this);
  }

  readonly #internals: ElementInternals;
  readonly #editor: HTMLDivElement;
  /** Hidden text in the editor's font, to measure quote markers with. */
  readonly #quoteMeasure: HTMLSpanElement;
  #value = "";
  #valueAtFocus = "";
  #dirty = false;
  #formDisabled = false;
  #spans: { span: Span; element: HTMLElement }[] = [];
  /** Where the last collapsed selection was, and where it snapped to. */
  #anchorSnap: [number, number] | null = null;
  #pointerDown = false;

  constructor() {
    super();
    this.#internals = this.attachInternals();

    const root = this.attachShadow({ mode: "open", delegatesFocus: true });
    const style = document.createElement("style");
    style.textContent = STYLES;
    this.#editor = document.createElement("div");
    this.#editor.className = "editor";
    this.#editor.setAttribute("role", "textbox");
    this.#editor.setAttribute("aria-multiline", "true");
    this.#quoteMeasure = document.createElement("span");
    this.#quoteMeasure.className = "md-measure";
    this.#quoteMeasure.ariaHidden = "true";
    this.#quoteMeasure.textContent = "> ";
    root.append(style, this.#quoteMeasure, this.#editor);

    this.#editor.addEventListener("beforeinput", this.#onBeforeInput);
    this.#editor.addEventListener("input", this.#onInput);
    this.#editor.addEventListener("compositionend", this.#onInput);
    this.#editor.addEventListener("pointerdown", this.#onPointerDown);
    this.#editor.addEventListener("click", this.#onClick);
    this.#editor.addEventListener("pointermove", this.#onModifierChange);
    this.#editor.addEventListener("focus", () => (this.#valueAtFocus = this.#value));
    this.#editor.addEventListener("blur", () => {
      this.#updateActive(null);
      if (this.#value !== this.#valueAtFocus) {
        this.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }

  connectedCallback(): void {
    if (!this.#dirty) this.#setValue(this.defaultValue);
    this.#syncEditable();
    // Rendering before connection, or before web fonts load, measures wrong.
    this.#layoutQuotes();
    document.fonts.ready.then(() => {
      this.#markerWidths.clear();
      this.#layoutQuotes();
    });
    document.addEventListener("selectionchange", this.#onSelectionChange);
    document.addEventListener("pointerup", this.#onPointerUp);
    document.addEventListener("pointercancel", this.#onPointerUp);
    document.addEventListener("keydown", this.#onModifierChange);
    document.addEventListener("keyup", this.#onModifierChange);
  }

  disconnectedCallback(): void {
    document.removeEventListener("selectionchange", this.#onSelectionChange);
    document.removeEventListener("pointerup", this.#onPointerUp);
    document.removeEventListener("pointercancel", this.#onPointerUp);
    document.removeEventListener("keydown", this.#onModifierChange);
    document.removeEventListener("keyup", this.#onModifierChange);
  }

  attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
    switch (name) {
      case "placeholder":
        this.#editor.dataset.placeholder = next ?? "";
        break;
      case "disabled":
      case "readonly":
        this.#syncEditable();
        break;
    }
  }

  // --- textarea-compatible API ---------------------------------------------

  get value(): string {
    return this.#value;
  }

  set value(value: string) {
    this.#dirty = true;
    this.#setValue(String(value));
  }

  /**
   * Like `<textarea>`, the default value is the element's text content, minus
   * a single leading newline so markup can start on the line after the tag.
   */
  get defaultValue(): string {
    return (this.textContent ?? "").replace(/^\r?\n/, "");
  }

  set defaultValue(value: string) {
    this.textContent = value;
    if (!this.#dirty) this.#setValue(value);
  }

  get placeholder(): string {
    return this.getAttribute("placeholder") ?? "";
  }

  set placeholder(value: string) {
    this.setAttribute("placeholder", value);
  }

  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }

  set disabled(value: boolean) {
    this.toggleAttribute("disabled", value);
  }

  get readOnly(): boolean {
    return this.hasAttribute("readonly");
  }

  set readOnly(value: boolean) {
    this.toggleAttribute("readonly", value);
  }

  get name(): string {
    return this.getAttribute("name") ?? "";
  }

  set name(value: string) {
    this.setAttribute("name", value);
  }

  get form(): HTMLFormElement | null {
    return this.#internals.form;
  }

  get type(): string {
    return "textarea";
  }

  get textLength(): number {
    return this.#value.length;
  }

  get selectionStart(): number {
    return this.#getSelection()?.[0] ?? this.#value.length;
  }

  set selectionStart(start: number) {
    this.setSelectionRange(start, Math.max(start, this.selectionEnd));
  }

  get selectionEnd(): number {
    return this.#getSelection()?.[1] ?? this.#value.length;
  }

  set selectionEnd(end: number) {
    this.setSelectionRange(Math.min(this.selectionStart, end), end);
  }

  setSelectionRange(start: number, end: number): void {
    const clamp = (n: number) => Math.max(0, Math.min(this.#value.length, n));
    const [a, b] = [clamp(start), clamp(end)];
    this.#select(Math.min(a, b), Math.max(a, b));
  }

  select(): void {
    this.setSelectionRange(0, this.#value.length);
  }

  // --- form association ----------------------------------------------------

  formResetCallback(): void {
    this.#dirty = false;
    this.#setValue(this.defaultValue);
  }

  formDisabledCallback(disabled: boolean): void {
    this.#formDisabled = disabled;
    this.#syncEditable();
  }

  formStateRestoreCallback(state: string | File | FormData | null): void {
    if (typeof state === "string") this.value = state;
  }

  // --- internals -----------------------------------------------------------

  /**
   * Applies edits to the source ourselves instead of letting the browser
   * mutate the rendered DOM. Anything we don't recognise falls through to the
   * browser and is reconciled in #onInput.
   */
  #onBeforeInput = (event: InputEvent): void => {
    const edit = this.#editFor(event);
    if (!edit) return;
    event.preventDefault();
    const [start, end, text] = edit;
    this.#dirty = true;
    this.#value = this.#value.slice(0, start) + text + this.#value.slice(end);
    this.#internals.setFormValue(this.#value);
    const caret = start + text.length;
    this.#render([caret, caret]);
    this.setSelectionRange(caret, caret);
    // Cancelling beforeinput suppresses the native input event.
    this.dispatchEvent(
      new InputEvent("input", { bubbles: true, composed: true, inputType: event.inputType, data: event.data }),
    );
  };

  /** Translates an input event into a source edit: replace [start, end) with text. */
  #editFor(event: InputEvent): [number, number, string] | null {
    const selection = this.#getSelection();
    if (!selection) return null;
    const [target] = event.getTargetRanges();
    const range = target ? this.#toSource(target) : selection;
    if (!range) return null;

    switch (event.inputType) {
      case "insertText":
      case "insertReplacementText":
      case "insertFromPaste":
      case "insertFromDrop":
      case "insertFromYank": {
        const text = event.data ?? event.dataTransfer?.getData("text/plain");
        return text == null ? null : [...range, text.replace(/\r\n?/g, "\n")];
      }
      case "insertParagraph":
      case "insertLineBreak":
        return [...range, "\n"];
      case "deleteContentBackward":
      case "deleteContentForward": {
        // The browser measures a character on the rendered text, so next to
        // hidden syntax it would delete that too. Measure on the source.
        const [start, end] = selection;
        if (start !== end) return [start, end, ""];
        return event.inputType === "deleteContentBackward"
          ? [graphemeBefore(this.#value, start), start, ""]
          : [start, graphemeAfter(this.#value, start), ""];
      }
      default:
        // Deletions: the browser tells us what it would remove.
        if (event.inputType.startsWith("delete") && target && range[0] !== range[1]) return [...range, ""];
        return null;
    }
  }

  /**
   * Maps a range to source offsets. Ends outside the editor, e.g. when a drag
   * leaves the element, clamp to the start or end of the source. A range that
   * lies entirely outside is not ours.
   */
  #toSource(range: AbstractRange): [number, number] | null {
    const startSide = this.#sideOf(range.startContainer, range.startOffset);
    const endSide = this.#sideOf(range.endContainer, range.endOffset);
    if (startSide === null || endSide === null || (startSide !== 0 && startSide === endSide)) return null;
    const clamp = (side: number, node: Node, offset: number) =>
      side < 0 ? 0 : side > 0 ? this.#value.length : this.#fromDom(node, offset)!;
    return [
      clamp(startSide, range.startContainer, range.startOffset),
      clamp(endSide, range.endContainer, range.endOffset),
    ];
  }

  /** Whether a DOM position is before (-1), inside (0) or after (1) the editor. */
  #sideOf(node: Node, offset: number): -1 | 0 | 1 | null {
    if (node === this.#editor || this.#editor.contains(node)) return 0;
    // Outside our shadow tree; compare against the host in its own tree.
    const host = document.createRange();
    host.selectNode(this);
    try {
      const side = host.comparePoint(node, offset);
      // Inside the host but outside the editor means our own shadow root.
      return side === 0 ? null : (side as -1 | 1);
    } catch {
      return null; // A different tree entirely, e.g. another shadow root.
    }
  }

  #onInput = (event: Event): void => {
    // Let the IME finish; compositionend brings us back here.
    if ((event as InputEvent).isComposing) return;
    this.#dirty = true;
    const selection = this.#getSelection();
    this.#value = this.#serialize();
    this.#internals.setFormValue(this.#value);
    // The browser has edited the rendered DOM; rebuild it from the source and
    // put the selection back at the same source offsets.
    this.#render(selection);
    if (selection) this.setSelectionRange(...selection);
    // The native input event is composed, so it already reaches listeners on
    // the host; no need to re-dispatch.
  };

  #onSelectionChange = (): void => {
    // A disabled or read-only editor can't take focus, but its text can still
    // be selected. With no caret to edit at, only a non-empty selection
    // reveals syntax.
    const editable = this.#isEditable();
    if (editable && !this.#isFocused()) return this.#updateActive(null);
    const selection = this.#getSelection();
    if (!selection) return this.#updateActive(null);
    const [start, end] = selection;

    if (start === end) {
      if (!editable) this.#updateActive(null);
      const snapped = this.#snapCaret(start);
      const anchor = this.#snapAnchor(start);
      this.#anchorSnap = anchor !== start ? [start, anchor] : null;
      // Revealing syntax under the pointer shifts the layout mid-press, which
      // makes Chrome turn the drag into caret movement. Wait for the release.
      if (this.#pointerDown) return;
      // A read-only caret is invisible; the snap only matters if it grows.
      if (editable && snapped !== start) return this.#select(snapped, snapped);
      if (editable) this.#updateActive(selection);
      return;
    }

    // Dragging from a snapped caret, the browser keeps its own anchor at the
    // unsnapped position, e.g. `**bold|**`. Re-anchor at the snapped one.
    if (this.#anchorSnap) {
      const [from, to] = this.#anchorSnap;
      if (start !== to && end !== to) {
        if (start === from) return this.#select(to, end);
        if (end === from) return this.#select(to, start);
      }
    }
    // Nothing visible is selected. Revealing the tokens would move the text
    // under the pointer, and the browser would move the selection in turn.
    if (this.#coversOnlyHiddenSyntax(start, end)) return;
    this.#updateActive(selection);
  };

  #onPointerDown = (event: PointerEvent): void => {
    // Following a link shouldn't move the caret, or reveal the link's syntax.
    if (this.#linkToFollow(event)) return event.preventDefault();
    this.#pointerDown = true;
  };

  #onClick = (event: MouseEvent): void => {
    const link = this.#linkAt(event);
    if (!link || !this.#isEditable()) return; // Read-only links work as usual.
    event.preventDefault();
    if (this.#linkToFollow(event)) window.open(link.href, "_blank", "noopener,noreferrer");
  };

  /** While editing, a link is only followed with Cmd/Ctrl + click. */
  #linkToFollow(event: MouseEvent): HTMLAnchorElement | null {
    const link = this.#linkAt(event);
    return link && this.#isEditable() && (event.metaKey || event.ctrlKey) ? link : null;
  }

  #linkAt(event: Event): HTMLAnchorElement | null {
    const target = event.composedPath()[0];
    return target instanceof Element ? target.closest<HTMLAnchorElement>("a.md-link[href]") : null;
  }

  #onModifierChange = (event: KeyboardEvent | PointerEvent): void => {
    this.#editor.classList.toggle("follow-links", this.#isEditable() && (event.metaKey || event.ctrlKey));
  };

  #onPointerUp = (): void => {
    if (!this.#pointerDown) return;
    this.#pointerDown = false;
    // A drag that ends having selected only hidden syntax selected nothing.
    const selection = this.#getSelection();
    if (selection && selection[0] !== selection[1] && this.#coversOnlyHiddenSyntax(...selection)) {
      const to = this.#anchorSnap?.[1];
      const caret = to !== undefined && selection.includes(to) ? to : selection[0];
      return this.#select(caret, caret);
    }
    this.#onSelectionChange();
  };

  /** Whether every character in [start, end) is a token of a hidden span. */
  #coversOnlyHiddenSyntax(start: number, end: number): boolean {
    for (let p = start; p < end; p++) {
      const hidden = this.#spans.some(
        ({ span, element }) =>
          !element.classList.contains("active") &&
          ((p >= span.start && p < span.start + span.open) || (p >= span.end - span.close && p < span.end)),
      );
      if (!hidden) return false;
    }
    return true;
  }

  /** Selects from anchor to focus (in source offsets), preserving direction. */
  #select(anchor: number, focus: number): void {
    // Reveal syntax first, so the positions exist visibly and aren't snapped.
    if (this.#isEditable() || anchor !== focus) this.#updateActive([Math.min(anchor, focus), Math.max(anchor, focus)]);
    document.getSelection()?.setBaseAndExtent(...this.#toDom(anchor), ...this.#toDom(focus));
  }

  /**
   * The browser can only place the caret by the visible text, so beside hidden
   * syntax it can land on either side of it. Where the caret goes:
   *
   * - Beside an inline span's hidden tokens, outside them, e.g. `**bold**|`
   *   rather than `**bold|**` when clicking past the end of the line.
   * - Beside hidden line syntax, like a heading's `#`s or a quote's `>`, after
   *   it, where the line's text is, e.g. `> |text` rather than `|> text`.
   */
  #snapCaret(caret: number): number {
    return this.#snap(caret, (span, caret) => {
      if (!isLineSyntax(span)) return outside(span, caret);
      return caret === span.start ? span.start + span.open : caret;
    });
  }

  /**
   * Where a drag from a caret beside hidden syntax starts: outside all of it,
   * so that once the syntax shows, the selection includes it.
   */
  #snapAnchor(caret: number): number {
    return this.#snap(caret, outside);
  }

  /** Applies a snap for each hidden span until the caret settles. */
  #snap(caret: number, step: (span: Span, caret: number) => number): number {
    // Repeat: nested spans, like `***x***` or `> > x`, stack their tokens.
    for (let moved = true; moved; ) {
      moved = false;
      for (const { span, element } of this.#spans) {
        if (element.classList.contains("active") || span.open + span.close === 0) continue;
        const next = step(span, caret);
        if (next !== caret) [caret, moved] = [next, true];
      }
    }
    return caret;
  }

  #isFocused(): boolean {
    return this.shadowRoot!.activeElement === this.#editor;
  }

  #isEditable(): boolean {
    return !this.disabled && !this.#formDisabled && !this.readOnly;
  }

  #setValue(value: string): void {
    this.#value = value;
    this.#render(null);
    this.#internals.setFormValue(value);
  }

  #syncEditable(): void {
    this.#editor.contentEditable = this.#isEditable() ? "plaintext-only" : "false";
    this.#editor.setAttribute("aria-readonly", String(this.readOnly));
    this.#editor.setAttribute("aria-disabled", String(this.disabled));
  }

  /**
   * Renders the source into the editor. The text content of the rendered DOM
   * is always exactly the source; rendering only adds structure around it.
   */
  #render(selection: [number, number] | null): void {
    const source = this.#value;
    const fragment = document.createDocumentFragment();
    this.#spans = [];
    this.#renderSpans(fragment, 0, source.length, parse(source));
    // A trailing newline doesn't produce a line box on its own.
    if (source.endsWith("\n")) fragment.append(sentinel());

    this.#editor.replaceChildren(fragment);
    this.#editor.normalize();
    this.#updateActive(selection);
    this.#layoutQuotes();
  }

  /** Widths of quote marker texts in the base font, by text. */
  #markerWidths = new Map<string, number>();

  /** Sizes quote indents and marker offsets to the marker text's widths. */
  #layoutQuotes(): void {
    const markers = this.#spans.filter(({ span }) => span.type === "quote-marker");
    if (markers.length === 0) return;
    const indent = this.#markerWidth("> ");
    if (indent === 0) return; // Not rendered yet.

    const { fontSize, fontWeight } = getComputedStyle(this.#quoteMeasure);
    this.#editor.style.setProperty("--md-quote-indent", `${indent}px`);
    // Quote markers inside headings use the base font, to match the indent.
    this.#editor.style.setProperty("--md-font-size", fontSize);
    this.#editor.style.setProperty("--md-font-weight", fontWeight);

    // On a line in n nested quotes, the text starts n indents in. The marker
    // of the quote i levels out from the innermost sits i + 1 indents back.
    const lines = Map.groupBy(markers, ({ span }) => (span as QuoteMarkerSpan).lineEnd);
    for (const line of lines.values()) {
      line.sort((a, b) => a.span.start - b.span.start);
      line.forEach(({ span, element }, i) => {
        const width = this.#markerWidth(this.#value.slice(span.start, span.end));
        element.style.setProperty("--md-shift", `${(line.length - i) * indent}px`);
        element.style.setProperty("--md-width", `${width}px`);
      });
    }
  }

  #markerWidth(text: string): number {
    let width = this.#markerWidths.get(text);
    if (width === undefined) {
      this.#quoteMeasure.textContent = text;
      width = this.#quoteMeasure.getBoundingClientRect().width;
      if (width > 0) this.#markerWidths.set(text, width);
    }
    return width;
  }

  /**
   * Renders source[from, to) into parent. `spans` lie within that range,
   * properly nested, ordered by start with outer spans first. Returns how far
   * into the source it rendered, which is past `to` if a block took its newline.
   */
  #renderSpans(parent: ParentNode, from: number, to: number, spans: Span[]): number {
    const source = this.#value;
    let cursor = from;
    for (let i = 0; i < spans.length; ) {
      const span = spans[i]!;
      // Everything up to the first span starting at or after our end is nested.
      let j = i + 1;
      while (j < spans.length && spans[j]!.start < span.end) j++;

      if (span.start > cursor) parent.append(source.slice(cursor, span.start));
      const element = document.createElement(tagFor(span));
      element.className = `md-span md-${span.type}`;
      if (span.type === "link") linkify(element as HTMLAnchorElement, span);
      if (isWholeLineSyntax(span)) element.classList.add("md-syntax-line");
      // Quote markers right before a block go inside it, so they're on the
      // block's first line rather than a line of their own. The text order,
      // and so the source, is the same.
      if (isBlock(span)) {
        const markers: Element[] = [];
        for (let last = parent.lastChild; last instanceof Element && last.matches(".md-quote-marker"); ) {
          markers.unshift(last);
          last = last.previousSibling;
        }
        element.append(...markers);
        // Chrome's line navigation skips the line before a block if that line
        // ends in a newline character, but not if it ends in a <br>. Both
        // serialize as a newline.
        const before = parent.lastChild;
        if (before instanceof Text && before.data.endsWith("\n")) {
          before.deleteData(before.length - 1, 1);
          parent.append(document.createElement("br"));
        }
      }
      if (span.open > 0) element.append(syntax(source.slice(span.start, span.start + span.open)));
      const rendered = this.#renderSpans(element, span.start + span.open, span.end - span.close, spans.slice(i + 1, j));
      if (span.close > 0) element.append(syntax(source.slice(span.end - span.close, span.end)));
      // A nested block ending on the same line may already hold the newline.
      cursor = Math.max(span.end, rendered);
      // A block keeps its line's newline inside, where it doesn't add an
      // empty line the way it would after the block. In a node of its own:
      // sharing one with the block's text, Chrome's arrow keys skip the line.
      if (isBlock(span) && cursor === span.end && source[cursor] === "\n") {
        const newline = document.createElement("span");
        newline.textContent = source[cursor++]!;
        element.append(newline);
      }
      parent.append(element);
      this.#spans.push({ span, element });

      i = j;
    }
    if (to > cursor) parent.append(source.slice(cursor, to));
    return Math.max(cursor, to);
  }

  /**
   * Marks spans touched by the selection (edges inclusive) as active, along
   * with spans whose tokens run straight into an active span's tokens, so
   * that e.g. `***` is shown whole rather than as a lone `*`.
   */
  #updateActive(selection: [number, number] | null): void {
    const active = new Set(
      this.#spans.filter(({ span }) => {
        const [start, end] = revealRange(span);
        return selection !== null && selection[0] <= end && selection[1] >= start;
      }),
    );
    // Only inline tokens stack; a heading's `#` isn't part of a `**` it abuts.
    const abuts = (a: Span, b: Span) =>
      !isLineSyntax(a) &&
      !isLineSyntax(b) &&
      (a.start + a.open === b.start || a.end - a.close === b.end || b.start + b.open === a.start || b.end - b.close === a.end);
    for (let grew = active.size > 0; grew; ) {
      grew = false;
      for (const entry of this.#spans) {
        if (active.has(entry)) continue;
        if ([...active].some(({ span }) => abuts(span, entry.span))) [grew] = [true, active.add(entry)];
      }
    }
    for (const entry of this.#spans) entry.element.classList.toggle("active", active.has(entry));
  }

  /** Returns the current selection as source offsets, if it is inside us. */
  #getSelection(): [number, number] | null {
    const range = this.#getRange();
    return range ? this.#toSource(range) : null;
  }

  #getRange(): AbstractRange | null {
    const root = this.shadowRoot!;
    const selection = document.getSelection();
    if (selection && "getComposedRanges" in selection) {
      const [range] = selection.getComposedRanges({ shadowRoots: [root] });
      if (range) return range;
    }
    // Chromium before getComposedRanges exposed a per-root selection.
    const legacy = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.();
    return legacy && legacy.rangeCount > 0 ? legacy.getRangeAt(0) : null;
  }

  /**
   * Walks the nodes that carry source text: text nodes and `<br>`s. The
   * browser may insert `<br>`s for newlines while editing.
   */
  #leaves(): TreeWalker {
    return document.createTreeWalker(this.#editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) =>
        node.nodeType === Node.TEXT_NODE || node instanceof HTMLBRElement
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });
  }

  /** The source text a leaf contributes. */
  #textOf(leaf: Node): string {
    if (leaf.nodeType === Node.TEXT_NODE) return (leaf as Text).data;
    return (leaf as Element).hasAttribute(SENTINEL) ? "" : "\n";
  }

  /** Reads the source back out of the (possibly browser-edited) DOM. */
  #serialize(): string {
    let text = "";
    const walker = this.#leaves();
    for (let leaf = walker.nextNode(); leaf; leaf = walker.nextNode()) text += this.#textOf(leaf);
    return text;
  }

  /** Maps a DOM position inside the editor to a source offset. */
  #fromDom(node: Node, offset: number): number | null {
    if (node !== this.#editor && !this.#editor.contains(node)) return null;

    // Find the first node at or after the position, and count all source text
    // before it.
    let stop: Node | null;
    let extra = 0;
    if (node.nodeType === Node.TEXT_NODE) {
      stop = node;
      extra = offset;
    } else {
      stop = node.childNodes[offset] ?? null;
      for (let n: Node | null = node; !stop && n && n !== this.#editor; n = n.parentNode) stop = n.nextSibling;
    }

    let total = 0;
    const walker = this.#leaves();
    for (let leaf = walker.nextNode(); leaf; leaf = walker.nextNode()) {
      if (stop && (leaf === stop || stop.compareDocumentPosition(leaf) & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY))) break;
      total += this.#textOf(leaf).length;
    }
    return total + extra;
  }

  /** Maps a source offset to a DOM position inside the editor. */
  #toDom(offset: number): [Node, number] {
    let remaining = offset;
    const walker = this.#leaves();
    for (let leaf = walker.nextNode(); leaf; leaf = walker.nextNode()) {
      if (leaf.nodeType === Node.TEXT_NODE) {
        const { data } = leaf as Text;
        // Right after a newline is the start of the next line, which may be
        // in the next block rather than at the end of this one.
        if (remaining < data.length || (remaining === data.length && !data.endsWith("\n"))) return [leaf, remaining];
        remaining -= data.length;
      } else {
        const parent = leaf.parentNode!;
        if (remaining === 0) return [parent, Array.prototype.indexOf.call(parent.childNodes, leaf)];
        remaining -= this.#textOf(leaf).length;
      }
    }
    return [this.#editor, this.#editor.childNodes.length];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "markompose-composer": Composer;
  }
}
