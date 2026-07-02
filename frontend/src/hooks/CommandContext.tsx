import { createContext, useContext } from "react";
import type { ClientCommand } from "@/types";

/** Provides the transport `send` to control widgets anywhere in the tree. */
export const CommandContext = createContext<(cmd: ClientCommand) => void>(() => {
  console.warn("CommandContext used outside provider");
});

export function useCommand(): (cmd: ClientCommand) => void {
  return useContext(CommandContext);
}
