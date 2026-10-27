import { parseInline, type InlineSpan } from "./markdown";

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
  #value = "";
  #valueAtFocus = "";
  #dirty = false;
  #formDisabled = false;
  #spans: { span: InlineSpan; element: HTMLElement }[] = [];

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
    root.append(style, this.#editor);

    this.#editor.addEventListener("beforeinput", this.#onBeforeInput);
    this.#editor.addEventListener("input", this.#onInput);
    this.#editor.addEventListener("compositionend", this.#onInput);
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
    document.addEventListener("selectionchange", this.#onSelectionChange);
  }

  disconnectedCallback(): void {
    document.removeEventListener("selectionchange", this.#onSelectionChange);
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
    // Reveal syntax first, so the positions exist visibly and aren't snapped.
    this.#updateActive([Math.min(a, b), Math.max(a, b)]);
    document.getSelection()?.setBaseAndExtent(...this.#toDom(Math.min(a, b)), ...this.#toDom(Math.max(a, b)));
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

  #toSource(range: AbstractRange): [number, number] | null {
    const start = this.#fromDom(range.startContainer, range.startOffset);
    const end = this.#fromDom(range.endContainer, range.endOffset);
    return start === null || end === null ? null : [start, end];
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
    // be selected, and the syntax rules follow that selection.
    if (!this.#isEditable()) return this.#updateActive(this.#getSelection());
    if (!this.#isFocused()) return this.#updateActive(null);

    const selection = this.#getSelection();
    const snapped = selection && this.#snapOutOfHidden(selection);
    if (snapped && snapped[0] !== selection[0]) return this.setSelectionRange(...snapped);
    this.#updateActive(selection);
  };

  /**
   * The browser can only place the caret by the visible text, so beside hidden
   * syntax it ends up inside the span, e.g. `**bold|**` when clicking past the
   * end of the line. Move such a caret outside the span's tokens instead.
   */
  #snapOutOfHidden([start, end]: [number, number]): [number, number] {
    if (start !== end) return [start, end];
    for (const { span, element } of this.#spans) {
      if (element.classList.contains("active")) continue;
      if (start === span.end - span.close) return [span.end, span.end];
      if (start === span.start + span.open) return [span.start, span.start];
    }
    return [start, end];
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
    const syntax = (text: string) => {
      const element = document.createElement("span");
      element.className = "md-syntax";
      element.textContent = text;
      return element;
    };

    this.#spans = [];
    let cursor = 0;
    for (const span of parseInline(source)) {
      if (span.start < cursor) continue;
      fragment.append(source.slice(cursor, span.start));
      const element = document.createElement("strong");
      element.className = "md-span md-bold";
      element.append(
        syntax(source.slice(span.start, span.start + span.open)),
        source.slice(span.start + span.open, span.end - span.close),
        syntax(source.slice(span.end - span.close, span.end)),
      );
      fragment.append(element);
      this.#spans.push({ span, element });
      cursor = span.end;
    }
    fragment.append(source.slice(cursor));
    // A trailing newline doesn't produce a line box on its own.
    if (source.endsWith("\n")) {
      const br = document.createElement("br");
      br.setAttribute(SENTINEL, "");
      fragment.append(br);
    }

    this.#editor.replaceChildren(fragment);
    this.#editor.normalize();
    this.#updateActive(selection);
  }

  /** Marks spans touched by the selection (edges inclusive) as active. */
  #updateActive(selection: [number, number] | null): void {
    for (const { span, element } of this.#spans) {
      const active = selection !== null && selection[0] <= span.end && selection[1] >= span.start;
      element.classList.toggle("active", active);
    }
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
        const length = (leaf as Text).length;
        if (remaining <= length) return [leaf, remaining];
        remaining -= length;
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
