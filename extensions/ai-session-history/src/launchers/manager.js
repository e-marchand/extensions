import { clear, h } from "@/lib/dom";
import { icon } from "@/lib/icons";
import { getCustomLaunchers, setCustomLaunchers } from "@/lib/storage";
import {
  buildLauncherCommand,
  formatEnvText,
  openLauncherTerminal,
  parseEnvText,
  validateLauncher,
} from "@/lib/launchers";

const INPUT_CLASS =
  "h-7 w-full rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary";
const BTN_CLASS =
  "flex h-7 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50";
const ICON_BTN_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-primary";

export class LaunchersManager {
  constructor(root) {
    this.root = root;
    this.launchers = [];
    this.loading = true;
    this.error = null;
    /** null when listing; a draft object when adding/editing. */
    this.draft = null;
    this.formError = null;
  }

  async start() {
    this.launchers = await getCustomLaunchers();
    this.loading = false;
    this.render();
  }

  async persist() {
    const ok = await setCustomLaunchers(this.launchers);
    if (!ok) this.error = "Could not save launchers";
  }

  startAdd() {
    this.draft = { id: null, name: "", command: "", envText: "" };
    this.formError = null;
    this.render();
  }

  startEdit(launcher) {
    this.draft = {
      id: launcher.id,
      name: launcher.name || "",
      command: launcher.command || "",
      envText: formatEnvText(launcher.env),
    };
    this.formError = null;
    this.render();
  }

  cancelDraft() {
    this.draft = null;
    this.formError = null;
    this.render();
  }

  async saveDraft() {
    const draft = this.draft;
    if (!draft) return;
    let clean;
    try {
      clean = validateLauncher({
        id: draft.id || undefined,
        name: draft.name,
        command: draft.command,
        env: parseEnvText(draft.envText),
      });
    } catch (e) {
      this.formError = e && e.message ? e.message : String(e);
      this.render();
      return;
    }
    const index = this.launchers.findIndex((l) => l.id === clean.id);
    if (index >= 0) this.launchers[index] = clean;
    else this.launchers.push(clean);
    this.draft = null;
    this.formError = null;
    await this.persist();
    this.render();
  }

  async remove(launcher) {
    this.launchers = this.launchers.filter((l) => l.id !== launcher.id);
    await this.persist();
    this.render();
  }

  async launch(launcher) {
    try {
      await openLauncherTerminal(launcher);
    } catch (e) {
      this.error = e && e.message ? e.message : String(e);
      this.render();
      return;
    }
    this.close();
  }

  close() {
    try {
      muxy.lifecycle.close();
    } catch (e) {
      /* opened outside a modal — nothing to close */
    }
  }

  render() {
    clear(this.root);
    this.root.appendChild(
      h(
        "div",
        { class: "flex h-full flex-col bg-background p-3" },
        this.header(),
        this.error ? this.banner(this.error) : null,
        h(
          "div",
          { class: "min-h-0 flex-1 overflow-y-auto" },
          this.loading
            ? this.note("Loading…")
            : this.draft
              ? this.form()
              : this.list(),
        ),
      ),
    );
  }

  header() {
    return h(
      "div",
      { class: "mb-2" },
      h(
        "div",
        { class: "text-[13px] font-semibold text-foreground" },
        "Custom Launchers",
      ),
      h(
        "div",
        { class: "text-[11px] text-muted-foreground" },
        "Command lines with options and env vars. Launch one anytime via “AI Sessions: Launch Custom…”.",
      ),
    );
  }

  banner(text) {
    return h(
      "div",
      {
        class:
          "mb-2 rounded-md border border-destructive px-2 py-1 text-[11px] text-destructive",
      },
      text,
    );
  }

  note(text) {
    return h(
      "div",
      { class: "px-1 py-6 text-center text-[12px] text-muted-foreground" },
      text,
    );
  }

  list() {
    if (!this.launchers.length) {
      return h(
        "div",
        { class: "flex flex-col items-center gap-3 px-1 py-8" },
        h(
          "div",
          { class: "text-center text-[12px] text-muted-foreground" },
          "No launchers yet.",
        ),
        h(
          "button",
          { type: "button", class: BTN_CLASS, onclick: () => this.startAdd() },
          icon("plus", 12),
          "Add launcher",
        ),
      );
    }

    return h(
      "div",
      { class: "flex flex-col gap-1.5" },
      ...this.launchers.map((l) => this.row(l)),
      h(
        "button",
        {
          type: "button",
          class: BTN_CLASS + " mt-1 w-full",
          onclick: () => this.startAdd(),
        },
        icon("plus", 12),
        "Add launcher",
      ),
    );
  }

  row(launcher) {
    let preview;
    try {
      preview = buildLauncherCommand(launcher);
    } catch (e) {
      preview = launcher.command || "";
    }
    return h(
      "div",
      {
        class:
          "flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5",
      },
      h(
        "div",
        { class: "min-w-0 flex-1" },
        h(
          "div",
          { class: "truncate text-[12px] font-medium text-foreground" },
          launcher.name,
        ),
        h(
          "div",
          {
            class:
              "truncate font-mono text-[10px] text-muted-foreground",
            title: preview,
          },
          preview,
        ),
      ),
      h(
        "button",
        {
          type: "button",
          class: BTN_CLASS,
          title: "Launch in a new terminal tab",
          onclick: () => this.launch(launcher),
        },
        icon("terminal", 12),
        "Launch",
      ),
      h(
        "button",
        {
          type: "button",
          class: ICON_BTN_CLASS,
          "aria-label": "Edit launcher",
          title: "Edit",
          onclick: () => this.startEdit(launcher),
        },
        icon("pencil", 12),
      ),
      h(
        "button",
        {
          type: "button",
          class: ICON_BTN_CLASS,
          "aria-label": "Delete launcher",
          title: "Delete",
          onclick: () => this.remove(launcher),
        },
        icon("trash", 12),
      ),
    );
  }

  field(label, control, hint) {
    return h(
      "label",
      { class: "flex flex-col gap-1" },
      h("span", { class: "text-[11px] text-muted-foreground" }, label),
      control,
      hint
        ? h("span", { class: "text-[10px] text-muted-foreground" }, hint)
        : null,
    );
  }

  form() {
    const draft = this.draft;
    const nameInput = h("input", {
      type: "text",
      class: INPUT_CLASS,
      placeholder: "Claude (Opus)",
      value: draft.name,
      oninput: (e) => {
        draft.name = e.target.value;
      },
    });
    const commandInput = h("input", {
      type: "text",
      class: INPUT_CLASS + " font-mono",
      placeholder: "claude --model opus --dangerously-skip-permissions",
      value: draft.command,
      oninput: (e) => {
        draft.command = e.target.value;
      },
    });
    const envInput = h("textarea", {
      class:
        "min-h-[68px] w-full resize-y rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary",
      placeholder: "ANTHROPIC_LOG=debug\nMODEL=opus",
      oninput: (e) => {
        draft.envText = e.target.value;
      },
    });
    envInput.value = draft.envText;

    return h(
      "div",
      { class: "flex flex-col gap-2.5" },
      this.field("Name", nameInput),
      this.field("Command", commandInput, "Runs in the active worktree."),
      this.field(
        "Environment variables",
        envInput,
        "One KEY=VALUE per line. Applied only to this session.",
      ),
      this.formError ? this.banner(this.formError) : null,
      h(
        "div",
        { class: "flex justify-end gap-1.5" },
        h(
          "button",
          {
            type: "button",
            class: BTN_CLASS,
            onclick: () => this.cancelDraft(),
          },
          "Cancel",
        ),
        h(
          "button",
          {
            type: "button",
            class:
              "flex h-7 items-center justify-center gap-1.5 rounded-md border border-primary bg-primary px-2.5 text-[12px] text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-1 focus-visible:ring-primary",
            onclick: () => this.saveDraft(),
          },
          icon("check", 12),
          draft.id ? "Save" : "Add",
        ),
      ),
    );
  }
}
