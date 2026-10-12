import type { EnvironmentLauncher } from "@t3tools/contracts";
import { useState, type FormEvent } from "react";

import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { randomUUID } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { EnvironmentRow } from "./EnvironmentRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { searchableSetting } from "./settingsSearch";

/**
 * Folded section listing the commands that create new machines on demand.
 * Each launcher appears under "Run on" as "New <label>". Desktop only, since
 * launchers run local commands and connect over SSH.
 */
export function EnvironmentLaunchersSettings() {
  const launchers = useClientSettings((settings) => settings.environmentLaunchers);
  const launched = useClientSettings((settings) => settings.launchedEnvironments);
  const updateSettings = useUpdateClientSettings();
  // The launcher the form edits; null adds a new one. Editing keeps the id, so
  // machines it already started keep its destroy, stop, and wake commands.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [destroyCommand, setDestroyCommand] = useState("");
  const [stopCommand, setStopCommand] = useState("");
  const [wakeCommand, setWakeCommand] = useState("");

  if (window.desktopBridge?.launchEnvironment === undefined) return null;

  const setLaunchers = (environmentLaunchers: readonly EnvironmentLauncher[]) =>
    updateSettings({ environmentLaunchers });

  const fillForm = (launcher: EnvironmentLauncher | null) => {
    setEditingId(launcher?.id ?? null);
    setLabel(launcher?.label ?? "");
    setCommand(launcher?.command ?? "");
    setDestroyCommand(launcher?.destroyCommand ?? "");
    setStopCommand(launcher?.stopCommand ?? "");
    setWakeCommand(launcher?.wakeCommand ?? "");
  };

  const saveLauncher = (event: FormEvent) => {
    event.preventDefault();
    const optional = (key: "destroyCommand" | "stopCommand" | "wakeCommand", value: string) =>
      value.trim() ? { [key]: value.trim() } : {};
    const saved: EnvironmentLauncher = {
      id: editingId ?? randomUUID(),
      label: label.trim(),
      command: command.trim(),
      ...optional("destroyCommand", destroyCommand),
      ...optional("stopCommand", stopCommand),
      ...optional("wakeCommand", wakeCommand),
    };
    setLaunchers(
      editingId === null
        ? [...launchers, saved]
        : launchers.map((entry) => (entry.id === editingId ? saved : entry)),
    );
    fillForm(null);
  };

  const { id, title } = searchableSetting("environment-launchers");
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={launchers.length === 0 ? "None" : launchers.map((entry) => entry.label).join(", ")}
    >
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        A launcher command creates a new machine, such as a cloud sandbox, and prints one JSON line
        last: <code>{'{"ssh":{"host":"my-sandbox"},"projectPath":"/home/me/app"}'}</code>. T3 Code
        connects to it over SSH and adds the project there. Commands get{" "}
        <code>T3CODE_PROJECT_TITLE</code> and <code>T3CODE_PROJECT_ROOT</code>. The destroy, stop,
        and wake commands get <code>T3CODE_SSH_HOST</code>: destroy runs when you remove a launched
        environment, stop once all its threads are settled, and wake when you send to it again.
      </p>
      {launchers.map((launcher) => (
        <EnvironmentRow
          key={launcher.id}
          kind="server"
          label={launcher.label}
          subtitle={<span className="font-mono">{launcher.command}</span>}
        >
          <Button variant="ghost" size="xs" onClick={() => fillForm(launcher)}>
            Edit
          </Button>
          {/* Its machines would lose their destroy, stop, and wake commands. */}
          <Button
            variant="ghost-destructive"
            size="xs"
            disabled={launched.some((entry) => entry.launcherId === launcher.id)}
            title={
              launched.some((entry) => entry.launcherId === launcher.id)
                ? "Remove the machines it started in Connections first"
                : undefined
            }
            onClick={() => {
              setLaunchers(launchers.filter((entry) => entry.id !== launcher.id));
              if (editingId === launcher.id) fillForm(null);
            }}
          >
            Remove
          </Button>
        </EnvironmentRow>
      ))}
      <form
        className="grid gap-2 px-3 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:px-4"
        onSubmit={saveLauncher}
      >
        <Input
          size="compact"
          aria-label="Launcher name"
          placeholder="Name, e.g. boat sandbox"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Input
          size="compact"
          aria-label="Launch command"
          placeholder="Command, e.g. ~/bin/boat-env create"
          autoCapitalize="none"
          spellCheck={false}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
        />
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="outline"
            size="xs"
            disabled={label.trim() === "" || command.trim() === ""}
          >
            {editingId === null ? "Add launcher" : "Save launcher"}
          </Button>
          {editingId === null ? null : (
            <Button type="button" variant="ghost" size="xs" onClick={() => fillForm(null)}>
              Cancel
            </Button>
          )}
        </div>
        <Input
          size="compact"
          aria-label="Destroy command"
          placeholder="Destroy command (optional), e.g. ~/bin/boat-env destroy"
          autoCapitalize="none"
          spellCheck={false}
          value={destroyCommand}
          onChange={(event) => setDestroyCommand(event.target.value)}
        />
        <span aria-hidden />
        <Input
          size="compact"
          aria-label="Stop command"
          placeholder="Stop command (optional), e.g. ~/bin/boat-env stop"
          autoCapitalize="none"
          spellCheck={false}
          value={stopCommand}
          onChange={(event) => setStopCommand(event.target.value)}
        />
        <span aria-hidden />
        <Input
          size="compact"
          aria-label="Wake command"
          placeholder="Wake command (optional), e.g. ~/bin/boat-env wake"
          autoCapitalize="none"
          spellCheck={false}
          value={wakeCommand}
          onChange={(event) => setWakeCommand(event.target.value)}
        />
      </form>
    </FoldedSettingsSection>
  );
}
