/**
 * cli/configHome.ts — which config directory belongs to a given home.
 *
 * $XDG_CONFIG_HOME describes the home of the user running the process. When a
 * caller passes a different home (tests, scripted installs into another home),
 * that variable does not belong to it: reading or writing there would touch the
 * real user's config. So it only applies when `homedir` is the process home.
 */
import os from "os";
import { isAbsolute, join, resolve } from "path";

/** True when `homedir` is the home of the running process. */
export function isProcessHome(homedir: string): boolean {
  return resolve(homedir) === resolve(os.homedir());
}

/** `$XDG_CONFIG_HOME` for the process home (absolute values only, per the spec), else `<homedir>/.config`. */
export function configHomeFor(homedir: string, env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env["XDG_CONFIG_HOME"];
  return xdg && isAbsolute(xdg) && isProcessHome(homedir) ? xdg : join(homedir, ".config");
}
