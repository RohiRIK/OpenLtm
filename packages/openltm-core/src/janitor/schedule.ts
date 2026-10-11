/**
 * janitor/schedule.ts — Portable (non-Honker) scheduling helpers for the janitor.
 *
 * Pure functions: interval resolution, "is a run due?", and renderers for a
 * systemd user timer, a launchd agent, and a crontab line. The rendered units
 * fire on a short *check* cadence (hourly by default) and call
 * `ltm janitor run --if-due`, which compares `ltm.janitor.lastRunAt` against
 * the *run* interval (6h by default). That keeps timer, SessionEnd hook, and
 * manual runs from doubling up, and needs no Honker binary on any platform.
 */
import { homedir } from "os";
import { dirname, join } from "path";

/** Default minutes between janitor runs when nothing else is configured. */
export const DEFAULT_JANITOR_RUN_INTERVAL_MINUTES = 360;
/** Default minutes between scheduler wake-ups that check whether a run is due. */
export const DEFAULT_JANITOR_CHECK_MINUTES = 60;

export const SYSTEMD_UNIT_NAME = "openltm-janitor";
export const LAUNCHD_LABEL = "com.rohirik.openltm.janitor";

function positiveInt(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Resolve the run interval in minutes.
 * Priority: explicit flag > LTM_JANITOR_INTERVAL_MINUTES > `ltm.janitor.intervalMinutes`
 * setting (when > 0) > 360 (6h). The setting's own default is 0 ("server
 * auto-run off"), which must not mean "run on every check" here.
 */
export function resolveRunIntervalMinutes(opts: {
  flag?: number | null;
  env?: string | undefined;
  setting?: string | null;
}): number {
  return positiveInt(opts.flag) ?? positiveInt(opts.env) ?? positiveInt(opts.setting) ?? DEFAULT_JANITOR_RUN_INTERVAL_MINUTES;
}

/** A run is due when there is no recorded run, or the last one is at least `intervalMinutes` old. */
export function isJanitorDue(lastRunAt: string | null | undefined, intervalMinutes: number, now = Date.now()): boolean {
  if (!lastRunAt) return true;
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return true;
  return now - last >= intervalMinutes * 60_000;
}

export function nextJanitorDueAt(lastRunAt: string | null | undefined, intervalMinutes: number): string | null {
  if (!lastRunAt) return null;
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last)) return null;
  return new Date(last + intervalMinutes * 60_000).toISOString();
}

export interface ScheduleSpec {
  /** Absolute path to the runtime (bun). */
  runtime: string;
  /** Absolute path to the ltm CLI entrypoint (cli/bin.ts). */
  bin: string;
  /** Absolute DB path baked into the unit as LTM_DB_PATH. */
  dbPath: string;
  /**
   * Baked into the unit as --interval-minutes only when the user chose one; otherwise
   * each run resolves it (LTM_JANITOR_INTERVAL_MINUTES > ltm.janitor.intervalMinutes > 6h).
   */
  runIntervalMinutes?: number;
  checkMinutes: number;
  /** PATH for the unit (so the janitor can find e.g. ollama/llama-server helpers). */
  pathEnv?: string;
}

export type ScheduleKind = "systemd" | "launchd" | "cron";

export interface RenderedFile {
  path: string;
  content: string;
}

export interface RenderedSchedule {
  kind: ScheduleKind;
  files: RenderedFile[];
  /** Commands the user runs to activate it. Printed, never executed by ltm. */
  activate: string[];
  /** Commands to undo it. */
  deactivate: string[];
}

/**
 * Command line for every unit. `--no-env-file` + a working directory of the
 * DB's own folder (security S6): systemd user units default to $HOME, cron to
 * $HOME, launchd to `/`. Without these, Bun would auto-load a `.env` (or a
 * `bunfig.toml` preload) from there and could redirect provider URLs/keys.
 */
function runArgs(spec: ScheduleSpec): string[] {
  const interval = spec.runIntervalMinutes ? ["--interval-minutes", String(spec.runIntervalMinutes)] : [];
  return [spec.runtime, "--no-env-file", spec.bin, "janitor", "run", "--if-due", "--quiet", ...interval];
}

/** Neutral working directory for the janitor process: the DB's folder. */
export function janitorWorkingDirectory(spec: ScheduleSpec): string {
  return dirname(spec.dbPath);
}

/** systemd expands `%` specifiers in every setting; `%%` is a literal percent. */
function systemdEscapeSpecifiers(value: string): string {
  return value.replace(/%/g, "%%");
}

/** Quote one word for systemd Environment= (unquoted by systemd; `$` is literal there). */
function systemdQuote(arg: string): string {
  const escaped = systemdEscapeSpecifiers(arg);
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(escaped) ? escaped : `"${escaped.replace(/(["\\])/g, "\\$1")}"`;
}

/** Quote one ExecStart= argument: as Environment=, plus `$$` because ExecStart expands `$VAR`. */
function systemdExecQuote(arg: string): string {
  return systemdQuote(arg.replace(/\$/g, "$$$$"));
}

/** Quote one argument for a POSIX shell (crontab). */
function shQuote(arg: string): string {
  return /^[A-Za-z0-9_@+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** cron turns an unescaped `%` into a newline, even inside quotes. */
function cronEscape(command: string): string {
  return command.replace(/%/g, "\\%");
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderSystemd(spec: ScheduleSpec, home = homedir()): RenderedSchedule {
  const dir = join(home, ".config", "systemd", "user");
  const env = [`Environment=${systemdQuote(`LTM_DB_PATH=${spec.dbPath}`)}`];
  if (spec.pathEnv) env.push(`Environment=${systemdQuote(`PATH=${spec.pathEnv}`)}`);
  const service = [
    "[Unit]",
    "Description=OpenLTM janitor (embed backfill, decay, archive, promote, dedup suggestions)",
    "",
    "[Service]",
    "Type=oneshot",
    // WorkingDirectory= is a bare path: systemd does not unquote it (a quoted
    // path is "not absolute" and the unit fails to load), so only escape `%`.
    `WorkingDirectory=${systemdEscapeSpecifiers(janitorWorkingDirectory(spec))}`,
    ...env,
    `ExecStart=${runArgs(spec).map(systemdExecQuote).join(" ")}`,
    "# 4 = another janitor run holds the lock; not a failure.",
    "SuccessExitStatus=4",
    "Nice=10",
    "IOSchedulingClass=idle",
    "",
  ].join("\n");
  const timer = [
    "[Unit]",
    "Description=Check every " + spec.checkMinutes + " min whether an OpenLTM janitor run is due",
    "",
    "[Timer]",
    "OnBootSec=10min",
    `OnUnitActiveSec=${spec.checkMinutes}min`,
    "RandomizedDelaySec=2min",
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
  return {
    kind: "systemd",
    files: [
      { path: join(dir, `${SYSTEMD_UNIT_NAME}.service`), content: service },
      { path: join(dir, `${SYSTEMD_UNIT_NAME}.timer`), content: timer },
    ],
    activate: [
      "systemctl --user daemon-reload",
      `systemctl --user enable --now ${SYSTEMD_UNIT_NAME}.timer`,
      `systemctl --user list-timers ${SYSTEMD_UNIT_NAME}.timer`,
      "# optional: keep the timer running while logged out",
      "loginctl enable-linger \"$USER\"",
    ],
    deactivate: [
      `systemctl --user disable --now ${SYSTEMD_UNIT_NAME}.timer`,
      `rm ${join(dir, `${SYSTEMD_UNIT_NAME}.service`)} ${join(dir, `${SYSTEMD_UNIT_NAME}.timer`)}`,
      "systemctl --user daemon-reload",
    ],
  };
}

export function renderLaunchd(spec: ScheduleSpec, home = homedir()): RenderedSchedule {
  const plistPath = join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
  const logPath = join(home, "Library", "Logs", "openltm-janitor.log");
  const args = runArgs(spec).map((a) => `    <string>${xmlEscape(a)}</string>`).join("\n");
  const envEntries = [`    <key>LTM_DB_PATH</key>\n    <string>${xmlEscape(spec.dbPath)}</string>`];
  if (spec.pathEnv) envEntries.push(`    <key>PATH</key>\n    <string>${xmlEscape(spec.pathEnv)}</string>`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(janitorWorkingDirectory(spec))}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries.join("\n")}
  </dict>
  <key>StartInterval</key>
  <integer>${spec.checkMinutes * 60}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>Nice</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`;
  return {
    kind: "launchd",
    files: [{ path: plistPath, content: plist }],
    activate: [
      `launchctl bootstrap gui/$(id -u) ${plistPath}`,
      `launchctl print gui/$(id -u)/${LAUNCHD_LABEL} | head -20`,
    ],
    deactivate: [
      `launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL}`,
      `rm ${plistPath}`,
    ],
  };
}

export function renderCron(spec: ScheduleSpec): RenderedSchedule {
  const minutes = spec.checkMinutes;
  const when = minutes >= 60 && minutes % 60 === 0
    ? (minutes === 60 ? "0 * * * *" : `0 */${minutes / 60} * * *`)
    : `*/${Math.min(Math.max(minutes, 1), 59)} * * * *`;
  const line = `${when} ${cronEscape(`cd ${shQuote(janitorWorkingDirectory(spec))} && LTM_DB_PATH=${shQuote(spec.dbPath)} ${runArgs(spec).map(shQuote).join(" ")} >/dev/null 2>&1`)}`;
  return {
    kind: "cron",
    files: [],
    activate: ["# add this line with `crontab -e`:", line],
    deactivate: ["# remove the openltm janitor line with `crontab -e`"],
  };
}

export function renderSchedule(kind: ScheduleKind, spec: ScheduleSpec, home = homedir()): RenderedSchedule {
  switch (kind) {
    case "systemd": return renderSystemd(spec, home);
    case "launchd": return renderLaunchd(spec, home);
    case "cron":    return renderCron(spec);
  }
}

/** Platform default: launchd on macOS, systemd elsewhere. */
export function defaultScheduleKind(platform: NodeJS.Platform = process.platform): ScheduleKind {
  return platform === "darwin" ? "launchd" : "systemd";
}
