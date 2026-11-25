/** Sign-in and account-recovery pages never ask. */
const NEVER_ON = /^\/(login|forgot-password|reset-password|confirm-email|verify-email|support-login)(\/|$)/;

/** The prompt shows only on a device that can turn alerts on right now, never on sign-in pages, and once per device. */
export const mayAskForPush = (mode: string, path: string, alreadyAsked: boolean) => mode === "ready" && !NEVER_ON.test(path) && !alreadyAsked;
