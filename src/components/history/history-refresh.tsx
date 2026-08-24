"use client";

/**
 * How the chat tells the history list that a new answer just landed (issue
 * #138). The chat renders as `children` of `HistoryShell`, so context is the
 * seam: the shell provides its refetch, the chat calls it on a completed
 * exchange, and neither imports the other.
 *
 * The default is a no-op so the signed-out tree — where the shell renders only
 * its children and `/api/history` is never called — needs no branch of its own.
 */

import { createContext, useContext } from "react";

const HistoryRefreshContext = createContext<() => void>(() => {});

export const HistoryRefreshProvider = HistoryRefreshContext.Provider;

export function useHistoryRefresh(): () => void {
  return useContext(HistoryRefreshContext);
}
