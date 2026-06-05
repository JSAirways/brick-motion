export type UserMessageKind = "info" | "error";

type Notifier = (message: string, kind: UserMessageKind) => void;

let notify: Notifier = (message, kind) => {
  if (kind === "error") {
    console.error(message);
  } else {
    console.info(message);
  }
};

export const setUserNotifier = (fn: Notifier): void => {
  notify = fn;
};

export const reportError = (message: string): void => {
  notify(message, "error");
};

export const reportInfo = (message: string): void => {
  notify(message, "info");
};

export const reportCaughtError = (error: unknown, fallback: string): string => {
  const message =
    typeof error === "string"
      ? error.trim() || fallback
      : error instanceof Error
        ? error.message.trim() || fallback
        : fallback;
  reportError(message);
  return message;
};
