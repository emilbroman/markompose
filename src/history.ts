/**
 * One undoable change to the source: at `start`, `removed` was replaced with
 * `inserted`. The selections are where to put the selection back after undoing
 * and redoing it.
 */
export interface Change {
  start: number;
  removed: string;
  inserted: string;
  before: [number, number];
  after: [number, number];
  /** The input type that made it, like `insertText`, to group typing by. */
  kind: string;
  time: number;
}

/** Changes in quick succession of one kind, like typing, undo together. */
const GROUP_WITHIN_MS = 1000;
const LIMIT = 500;

/** The undo and redo stacks of a composer's source. */
export class History {
  #undo: Change[] = [];
  #redo: Change[] = [];

  /** Records a change, grouping it with the last if they continue each other. */
  record(change: Change): void {
    this.#redo = [];
    const last = this.#undo.at(-1);
    if (last && this.#extend(last, change)) return;
    this.#undo.push(change);
    if (this.#undo.length > LIMIT) this.#undo.shift();
  }

  /** The change to undo, which moves to the redo stack. */
  undo(): Change | undefined {
    const change = this.#undo.pop();
    if (change) this.#redo.push(change);
    return change;
  }

  /** The change to redo, which moves back to the undo stack. */
  redo(): Change | undefined {
    const change = this.#redo.pop();
    if (change) this.#undo.push(change);
    return change;
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }

  /** Grows `last` to include `next`, if it continues it: more typing, or more deleting. */
  #extend(last: Change, next: Change): boolean {
    if (next.kind !== last.kind || next.time - last.time > GROUP_WITHIN_MS) return false;
    const typed = next.removed === "" && next.start === last.start + last.inserted.length;
    // Backspacing deletes from in front of what's already gone, and deleting
    // forward from the same place.
    const backspaced = next.inserted === "" && last.inserted === "" && next.start + next.removed.length === last.start;
    const deleted = next.inserted === "" && last.inserted === "" && next.start === last.start;
    if (next.kind === "insertText" && typed) last.inserted += next.inserted;
    else if (next.kind === "deleteContentBackward" && backspaced) [last.start, last.removed] = [next.start, next.removed + last.removed];
    else if (next.kind === "deleteContentForward" && deleted) last.removed += next.removed;
    else return false;
    last.after = next.after;
    last.time = next.time;
    return true;
  }
}
