import type { PiExtensionAPI } from "@earendil-works/pi-ai";
import { registerTools } from "./tools.js";
import { registerHooks } from "./hooks.js";

export default function ltmExtension(pi: PiExtensionAPI): void {
  registerTools(pi);
  registerHooks(pi);
}
