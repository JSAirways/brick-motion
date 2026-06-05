export interface HistoryCommandContext {
  projectRoot: string;
  /** Reserved for upcoming per-sequence history scoping. */
  sequenceId?: string;
}

export interface HistoryCommand {
  kind: string;
  label: string;
  context: HistoryCommandContext;
  coalesceKey?: string;
  coalesceWith?: (previous: HistoryCommand) => HistoryCommand | null;
  apply: () => Promise<void>;
  revert: () => Promise<void>;
}

export const HISTORY_STACK_LIMIT = 30;

const pushWithLimit = <T>(target: T[], item: T, limit: number): void => {
  target.push(item);
  if (target.length > limit) {
    target.shift();
  }
};

export class HistoryManager {
  private undoStack: Array<{ command: HistoryCommand; appliedAtMs: number }> = [];
  private redoStack: Array<{ command: HistoryCommand; appliedAtMs: number }> = [];

  constructor(private readonly limit: number = HISTORY_STACK_LIMIT) {}

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  hasUndo(): boolean {
    return this.undoStack.length > 0;
  }

  hasRedo(): boolean {
    return this.redoStack.length > 0;
  }

  async execute(command: HistoryCommand): Promise<void> {
    await command.apply();
    const now = Date.now();
    const prev = this.undoStack[this.undoStack.length - 1];
    const canCoalesce =
      prev &&
      command.coalesceKey &&
      prev.command.coalesceKey === command.coalesceKey &&
      now - prev.appliedAtMs <= 700;
    if (canCoalesce) {
      const merged = command.coalesceWith?.(prev.command) ?? command;
      this.undoStack[this.undoStack.length - 1] = { command: merged, appliedAtMs: now };
    } else {
      pushWithLimit(this.undoStack, { command, appliedAtMs: now }, this.limit);
    }
    this.redoStack = [];
  }

  async undo(matchesContext?: (command: HistoryCommand) => boolean): Promise<boolean> {
    const entry = this.undoStack.pop();
    if (!entry) {
      return false;
    }
    const command = entry.command;
    if (matchesContext && !matchesContext(command)) {
      this.clear();
      return false;
    }
    try {
      await command.revert();
      pushWithLimit(this.redoStack, { command, appliedAtMs: Date.now() }, this.limit);
      return true;
    } catch (error) {
      pushWithLimit(this.undoStack, entry, this.limit);
      throw error;
    }
  }

  async redo(matchesContext?: (command: HistoryCommand) => boolean): Promise<boolean> {
    const entry = this.redoStack.pop();
    if (!entry) {
      return false;
    }
    const command = entry.command;
    if (matchesContext && !matchesContext(command)) {
      this.clear();
      return false;
    }
    try {
      await command.apply();
      pushWithLimit(this.undoStack, { command, appliedAtMs: Date.now() }, this.limit);
      return true;
    } catch (error) {
      pushWithLimit(this.redoStack, entry, this.limit);
      throw error;
    }
  }
}
