import * as child_process from "child_process";
import * as fs from "fs";
import * as tmp from "tmp";
import * as util from "util";
import * as vscode from "vscode";
import * as yaml from "yaml";
import { ExtensionContext, OutputChannel, Uri, Webview, WebviewPanel, WorkspaceFolder } from "vscode";
import { TemplateResultResponseMessage, TemplateResultRequestMessage, HostListResponseMessage, HostListRequestMessage, HostVarsRequestMessage, HostVarsResponseMessage, PreferenceRequestMessage, PreferenceResponseMessage, ProfileSettingsRequestMessage } from "../@types/messageTypes";
import { isObject, isStringArray, parseVariableString } from "../@types/assertions";

const execAsPromise = util.promisify(child_process.execFile);

interface ExecuteResult {
  successful: boolean
  stderr: string
  stdout: string
}

interface AnsibleProfile {
  args: string[],
  cmd: string,
  env: Record<string, string>,
}

interface AnsibleResult {
  plays: {
    play: {
      name: string;
    };
    tasks: {
      hosts: Record<string, {
          failed?: boolean;
          msg: unknown;
        }>;
        task: {
          name: string;
        }
    }[];
  }[];
}

function isAnsibleResult(data: unknown): data is AnsibleResult {
  return (
    isObject(data, ["plays"])
    && Array.isArray(data.plays)
    && data.plays.some(play =>
      isObject(play, ["play", "tasks"])
      && isObject(play.play, ["name"])
      && typeof play.play.name === "string"
      && Array.isArray(play.tasks)
      && play.tasks.some(task =>
        isObject(task, ["hosts", "task"])
        && isObject(task.hosts, [])
        && Object.entries(task.hosts).some(([key, value]) =>
          typeof key === "string"
          && isObject(value, ["msg"])
        )
        && isObject(task.task, ["name"])
        && typeof task.task.name === "string"
      )
    )
  );
}

export class AnsibleTemplateUiManager {
  private static readonly PLAYBOOK_TITLE = "Print Template";
  private static readonly PREF_ANSIBLE_PROFILES = "tortenairbag.ansibleTemplateUi.profiles";
  private static readonly TEMPLATE_HOSTLIST = "{{ groups.all | default([]) | sort | unique }}";
  private static readonly TEMPLATE_HOSTVARS = "{{ vars.keys() }}";
  private static readonly VIEW_RESOURCES_DIR = "out";
  private static readonly VIEW_SCHEMA = "tortenairbag.tabSession";
  private static readonly VIEW_TITLE = "Ansible Template UI";

  private hostListCache: { [profileKey: string]: string[] } = {};
  private hostVarsCache: { [profileKey: string]: { [host: string]: string[] } } = {};
  private channel: OutputChannel | undefined;
  private panel: WebviewPanel | undefined;
  private workspaceUri: Uri | undefined;

  private prefAnsibleProfilesDefault: Record<string, AnsibleProfile> = {};
  private prefAnsibleProfiles: Record<string, AnsibleProfile> = {};
  private prefAnsibleTimeout = 0;
  private prefTabSize = 2;
  private prefOutputRegexSanitizeRules: string[] = [];

  public activate(context: ExtensionContext) {
    const prefKeyAnsibleProfiles = AnsibleTemplateUiManager.PREF_ANSIBLE_PROFILES;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (context.extension.packageJSON.contributes.configuration as unknown[]).forEach((config) => {
      if (isObject(config, ["properties"]) && isObject(config.properties, [prefKeyAnsibleProfiles]) && isObject(config.properties[prefKeyAnsibleProfiles], ["default"])) {
        this.prefAnsibleProfilesDefault = config.properties[prefKeyAnsibleProfiles].default as Record<string, AnsibleProfile>;
      }
    });

    this.getUserSettings();
    context.subscriptions.concat([
      vscode.commands.registerCommand("tortenairbag.ansibleTemplateUi.open", this.open.bind(this, context)),
      vscode.workspace.onDidChangeConfiguration(this.getUserSettings.bind(this)),
    ]);
  }

  private async open(context: ExtensionContext) {
    if (this.panel !== undefined) {
      this.panel.reveal();
    } else {
      this.workspaceUri = await this.pickWorkspace();
      if (this.workspaceUri === undefined) {
        void vscode.window.showErrorMessage("Unable to open Ansible Template UI: No workspace selected.");
        return;
      }

      this.panel = vscode.window.createWebviewPanel(
        AnsibleTemplateUiManager.VIEW_SCHEMA,
        AnsibleTemplateUiManager.VIEW_TITLE,
        vscode.ViewColumn.One,
        {
          // Enable JavaScript in the webview
          enableScripts: true,
          // Restrict the webview to only load resources from the `out` directory
          localResourceRoots: [Uri.joinPath(context.extensionUri, AnsibleTemplateUiManager.VIEW_RESOURCES_DIR)],
        }
      );

      this.panel.title = AnsibleTemplateUiManager.VIEW_TITLE;
      this.panel.webview.html = AnsibleTemplateUiManager.getWebviewContent(this.panel.webview, context.extensionUri);

      this.panel.webview.onDidReceiveMessage(async (payload: unknown) => {
        if (isObject(payload, ["command"]) && typeof payload.command === "string") {
          /* Message */
          if (payload.command === "TemplateResultRequestMessage"
              && isObject(payload, ["profile", "host", "template", "variables"])
              && typeof payload.profile === "string"
              && payload.profile in this.prefAnsibleProfiles
              && typeof payload.host === "string"
              && typeof payload.template === "string"
              && typeof payload.variables === "string") {
            /* TemplateResultRequestMessage */
            await this.renderTemplate({ command: payload.command, profile: payload.profile, host: payload.host, variables: payload.variables, template: payload.template });
          } else if (payload.command === "PreferenceRequestMessage") {
            /* PreferenceRequestMessage */
            this.lookupProfiles({ command: payload.command });
          } else if (payload.command === "ProfileSettingsRequestMessage") {
            this.openProfileSettings({ command: payload.command });
          } else if (payload.command === "HostListRequestMessage"
              && isObject(payload, ["profile"])
              && typeof payload.profile === "string"
              && payload.profile in this.prefAnsibleProfiles) {
            /* HostListRequestMessage */
            await this.lookupInventoryHosts({ command: payload.command, profile: payload.profile });
          } else if (payload.command === "HostVarsRequestMessage"
              && isObject(payload, ["profile", "host"])
              && typeof payload.profile === "string"
              && payload.profile in this.prefAnsibleProfiles
              && typeof payload.host === "string") {
            /* HostVarsRequestMessage */
            await this.lookupHostVars({ command: payload.command, profile: payload.profile, host: payload.host });
          }
        }
      });

      this.panel.onDidDispose(() => { this.panel = undefined; });
    }
  }

  private getUserSettings() {
    const conf = vscode.workspace.getConfiguration();

    this.prefTabSize = conf.get("tortenairbag.ansibleTemplateUi.tabSize", 0);
    if (this.prefTabSize < 1) {
      this.prefTabSize = conf.get("editor.tabSize", 2);
    }

    this.prefAnsibleTimeout = conf.get<number>("tortenairbag.ansibleTemplateUi.ansibleTimeout", 0);
    this.prefOutputRegexSanitizeRules = conf.get<string[]>("tortenairbag.ansibleTemplateUi.outputRegexSanitizeRules", []);

    this.prefAnsibleProfiles = {};
    const profiles = conf.get("tortenairbag.ansibleTemplateUi.profiles");
    let isSuccessful = true;
    if (isObject(profiles, [])) {
      for (const [profileKey, profile] of Object.entries(profiles)) {
        if (isObject(profile, ["args", "cmd", "env"])
            && isStringArray(profile.args)
            && typeof profile.cmd === "string"
            && isObject(profile.env, [])) {
          this.prefAnsibleProfiles[profileKey] = { args: profile.args, cmd: profile.cmd, env: profile.env };
        } else {
          isSuccessful = false;
        }
      }
    }
    if (!isSuccessful && Object.keys(this.prefAnsibleProfiles).length < 1) {
      this.prefAnsibleProfiles = this.prefAnsibleProfilesDefault;
    }
    if (!isSuccessful) {
      void vscode.window.showErrorMessage("Malformed configuration about Ansible Profiles, please fix your settings.", "Open settings").then((value) => {
        if (value === "Open settings") {
          this.openProfileSettings({ command: "ProfileSettingsRequestMessage" });
        }
      });
    }
  }

  private lookupProfiles(_message: PreferenceRequestMessage) {
    const profiles: Record<string, string> = {};
    for (const [profileKey, profile] of Object.entries(this.prefAnsibleProfiles)) {
      profiles[profileKey] = JSON.stringify(profile, undefined, this.prefTabSize);
    }
    const payload: PreferenceResponseMessage = { command: "PreferenceResponseMessage", profiles: profiles, tabSize: this.prefTabSize };
    void this.panel?.webview.postMessage(payload);
  }

  private openProfileSettings(_message: ProfileSettingsRequestMessage) {
    void vscode.commands.executeCommand("workbench.action.openSettings", "@id:tortenairbag.ansibleTemplateUi.profiles");
  }

  private async lookupInventoryHosts(message: HostListRequestMessage) {
    const templateMessage: TemplateResultRequestMessage = {
      command: "TemplateResultRequestMessage",
      profile: message.profile,
      host: "localhost",
      template: AnsibleTemplateUiManager.TEMPLATE_HOSTLIST,
      variables: "",
    };
    if (message.profile in this.hostListCache && this.hostListCache[message.profile].length > 1) {
      const payload: HostListResponseMessage = { command: "HostListResponseMessage", status: "cache", hosts: this.hostListCache[message.profile], templateMessage: templateMessage };
      void this.panel?.webview.postMessage(payload);
    }
    const result = await this.runAnsibleDebug(templateMessage);
    const hosts: string[] = [];
    let isSuccessful = false;
    try {
      const stdout = JSON.parse(result.result) as unknown;
      if (isStringArray(stdout)) {
        hosts.push(...stdout);
        isSuccessful = true;
      }
    } catch (err: unknown) { /* swallow */ }
    if (!hosts.includes("localhost")) {
      hosts.unshift("localhost");
    }
    this.hostListCache[message.profile] = hosts;
    const payload: HostListResponseMessage = { command: "HostListResponseMessage", status: isSuccessful ? "successful" : "failed", hosts: hosts, templateMessage: templateMessage };
    await this.panel?.webview.postMessage(payload);
  }

  private async lookupHostVars(message: HostVarsRequestMessage) {
    const templateMessage: TemplateResultRequestMessage = {
      command: "TemplateResultRequestMessage",
      profile: message.profile,
      host: message.host,
      template: AnsibleTemplateUiManager.TEMPLATE_HOSTVARS,
      variables: "",
    };
    if (message.profile in this.hostVarsCache && message.host in this.hostVarsCache[message.profile]) {
      const payload: HostVarsResponseMessage = { command: "HostVarsResponseMessage", status: "cache", host: message.host, vars: this.hostVarsCache[message.profile][message.host], templateMessage: templateMessage };
      void this.panel?.webview.postMessage(payload);
    }
    const result = await this.runAnsibleDebug(templateMessage);
    const vars: string[] = [];
    let isSuccessful = false;
    try {
      const stdout = JSON.parse(result.result) as unknown;
      if (isStringArray(stdout)) {
        vars.push(...stdout);
        isSuccessful = true;
      }
    } catch (err: unknown) { /* swallow */ }
    if (!(message.profile in this.hostVarsCache)) {
      this.hostVarsCache[message.profile] = {};
    }
    this.hostVarsCache[message.profile][message.host] = vars;
    const payload: HostVarsResponseMessage = { command: "HostVarsResponseMessage", status: isSuccessful ? "successful" : "failed", host: message.host, vars: vars, templateMessage: templateMessage };
    await this.panel?.webview.postMessage(payload);
  }

  private async renderTemplate(templateMessage: TemplateResultRequestMessage) {
    const payload = await this.runAnsibleDebug(templateMessage);
    await this.panel?.webview.postMessage(payload);
  }

  private async runAnsibleDebug(templateMessage: TemplateResultRequestMessage) {
    const profile = this.prefAnsibleProfiles[templateMessage.profile];
    const host = templateMessage.host;
    const template = templateMessage.template;
    const variables = templateMessage.variables;
    const playbook = yaml.stringify([
      {
        name: AnsibleTemplateUiManager.PLAYBOOK_TITLE,
        hosts: host,
        gather_facts: false,
        tasks: [
          {
            name: AnsibleTemplateUiManager.PLAYBOOK_TITLE,
            "ansible.builtin.debug": {
              msg: template,
            },
          },
        ],
      },
    ]);

    if (profile === undefined) {
      const payload: TemplateResultResponseMessage = { command: "TemplateResultResponseMessage", successful: false, type: "unknown", result: "Profile cannot be found.", debug: "" };
      return payload;
    }
    if (variables.trim() !== "" && parseVariableString(variables) === undefined) {
      const payload: TemplateResultResponseMessage = { command: "TemplateResultResponseMessage", successful: false, type: "unknown", result: "Variables are malformed, must be JSON- or yaml-decodable object.", debug: "" };
      return payload;
    }

    const tmpFilePlaybook = tmp.fileSync();
    const tmpFileVariables = tmp.fileSync();

    fs.writeFileSync(tmpFilePlaybook.name, playbook);
    fs.writeFileSync(tmpFileVariables.name, variables);

    const args: string[] = [...profile.args, tmpFilePlaybook.name];
    if (variables.trim() !== "") {
      args.push("--extra-vars", `@${tmpFileVariables.name}`);
    }
    const result = await this.runAnsible(profile.cmd, profile.env, args);

    tmpFilePlaybook.removeCallback();
    tmpFileVariables.removeCallback();

    let res = "Unknown error...";
    let isSuccessful = false;
    let stdout: unknown;

    for (const pattern of this.prefOutputRegexSanitizeRules) {
      const regex = new RegExp(pattern, "my");
      result.stdout = result.stdout.replace(regex, "");
    }

    try {
      stdout = JSON.parse(result.stdout) as unknown;
    } catch (err: unknown) {
      res = "Unable to parse ansible output...";
    }

    let type: "string" | "structure" | "unknown" = "unknown";
    if (isAnsibleResult(stdout)) {
      const msgs: { failed?: boolean; msg: unknown; }[] = [];
      stdout.plays.forEach(play => {
        if (play.play.name !== AnsibleTemplateUiManager.PLAYBOOK_TITLE) {
          return;
        }
        play.tasks.forEach(task => {
          if (task.task.name !== AnsibleTemplateUiManager.PLAYBOOK_TITLE) {
            return;
          }
          if (host in task.hosts) {
            msgs.push(task.hosts[host]);
          }
        });
      });
      if (msgs.length === 1) {
        if (typeof msgs[0].msg === "string") {
          type = "string";
          res = msgs[0].msg;
        } else {
          type = "structure";
          res = JSON.stringify(msgs[0].msg, undefined, this.prefTabSize);
        }
        isSuccessful = !(msgs[0].failed ?? false);
      }
    } else {
      res = "Unable to interpret ansible result...";
    }

    const payload: TemplateResultResponseMessage = { command: "TemplateResultResponseMessage", successful: isSuccessful, type: type, result: res, debug: yaml.stringify(result) };
    return payload;
  }

  private async runAnsible(command: string, env: Record<string, string>, args: string[]) {
    const channel = this.getOutputChannel();
    const newEnv = { ...process.env, ...env };
    const result: ExecuteResult = { successful: false, stderr: "Unknown error", stdout: "" };
    newEnv.ANSIBLE_STDOUT_CALLBACK = "json";
    newEnv.ANSIBLE_COMMAND_WARNINGS = "0";
    newEnv.ANSIBLE_RETRY_FILES_ENABLED = "0";
    try {
      channel.appendLine(JSON.stringify(newEnv));
      channel.appendLine(command);
      const { stdout, stderr } = await execAsPromise(command, args, {
        cwd: this.workspaceUri?.fsPath,
        env: newEnv,
        timeout: this.prefAnsibleTimeout,
      });
      if (stderr.length > 0) {
        channel.appendLine(stderr);
      }
      result.stderr = stderr.trim();
      result.stdout = stdout.trim();
      result.successful = true;
    } catch (err: unknown) {
      channel.appendLine("Error running ansible command.");
      channel.appendLine(yaml.stringify(err));
      if (isObject(err, [])) {
        if ("stderr" in err) {
          result.stderr = yaml.stringify(err.stderr);
        }
        if ("stdout" in err && typeof err.stdout === "string") {
          result.stdout = err.stdout;
        }
      }
    }
    return result;
  }

  private async pickWorkspace() {
    const workspaceFolders: readonly WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders;
    let targetWorkspaceFolder: WorkspaceFolder | undefined = undefined;

    if (workspaceFolders === undefined) {
      return undefined;
    } else if (workspaceFolders.length === 1) {
      targetWorkspaceFolder = workspaceFolders[0];
    } else if (workspaceFolders.length > 1) {
      targetWorkspaceFolder = await vscode.window.showWorkspaceFolderPick();
    }

    if (targetWorkspaceFolder === undefined) {
      return undefined;
    }

    return targetWorkspaceFolder.uri;
  }

  private getOutputChannel() {
    if (this.channel === undefined) {
      this.channel = vscode.window.createOutputChannel(AnsibleTemplateUiManager.VIEW_TITLE);
    }
    return this.channel;
  }

  private static getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private static getUri(webview: Webview, extensionUri: Uri, pathList: string[]) {
    return webview.asWebviewUri(Uri.joinPath(extensionUri, ...pathList));
  }

  private static getWebviewContent(webview: Webview, extensionUri: Uri) {
    const scriptUri = this.getUri(webview, extensionUri, [AnsibleTemplateUiManager.VIEW_RESOURCES_DIR, "webview.js"]);
    const styleUri = this.getUri(webview, extensionUri, [AnsibleTemplateUiManager.VIEW_RESOURCES_DIR, "webview.css"]);

    const nonce = this.getNonce();
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; img-src 'self' data:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'nonce-${nonce}';">
          <meta property="csp-nonce" content="${nonce}">
          <link rel="stylesheet" href="${styleUri.toString()}">
          <title>${AnsibleTemplateUiManager.VIEW_TITLE}</title>
        </head>
        <body id="bodyWebview">
          <header>
            <h1>${AnsibleTemplateUiManager.VIEW_TITLE}</h1>
          </header>
          <section id="sectionContent" class="containerVertical">
            <label>Profile</label>
            <div class="containerHorizontal">
              <select id="selProfile" class="containerFill"></select>
              <vscode-button id="btnProfileInfoToggle" appearance="icon">
                <span class="codicon codicon-info" title="Show/Hide profile info"></span>
              </vscode-button>
              <vscode-button id="btnProfileSettings" appearance="icon">
                <span class="codicon codicon-settings" title="Open settings"></span>
              </vscode-button>
              <vscode-button id="btnProfileRefresh" appearance="icon">
                <span class="codicon codicon-refresh" title="Reload profile configuration"></span>
              </vscode-button>
            </div>
            <div id="divProfiles" class="hidden">
              <span id="spnProfile" class="placeholderCodeMirror"></span>
            </div>
            <label>Host</label>
            <div class="containerHorizontal">
              <select id="selHost" class="containerFill"></select>
              <vscode-button id="btnHostListRefresh" appearance="icon">
                <span class="codicon codicon-refresh" title="Reload hosts"></span>
              </vscode-button>
            </div>
            <div id="divHostListFailed" class="containerHorizontal messageBox hidden">
              <span class="codicon codicon-warning"></span>
              <span>Unable to detect any hosts in inventory.<br/><vscode-link id="lnkHostListDebug" href="#">Click here</vscode-link> to replace the current template with the template used to lookup hosts for debugging purposes.</span>
            </div>
            <div class="containerHorizontal">
              <label class="containerFill">Variables</label>
              <vscode-button id="btnHostVarsRefresh" appearance="icon">
                <span class="codicon codicon-refresh" title="Reload host variables"></span>
              </vscode-button>
            </div>
            <span id="spnVariables" class="placeholderCodeMirror"></span>
            <div id="divHostVarsFailed" class="containerHorizontal messageBox hidden">
              <span class="codicon codicon-warning"></span>
              <span>Unable to detect any variables for selected host.<br/><vscode-link id="lnkHostVarsDebug" href="#">Click here</vscode-link> to replace the current template with the template used to lookup host variables for debugging purposes.</span>
            </div>
            <label>Template</label>
            <span id="spnTemplate" class="placeholderCodeMirror"></span>
            <vscode-button id="btnRender" appearance="primary">Render template</vscode-button>
            <div id="divRenderLoading" class="containerHorizontal messageBox hidden">
              <vscode-progress-ring></vscode-progress-ring>
              <span>Running template render...</span>
            </div>
            <vscode-panels>
              <vscode-panel-tab id="vptOutput">OUTPUT</vscode-panel-tab>
              <vscode-panel-tab id="vptDebug">DEBUG</vscode-panel-tab>
              <vscode-panel-view id="vppOutput">
                <section class="containerVertical">
                  <div id="divFailed" class="errorBox hidden">An error ocurred executing the command.</div>
                  <div id="divHostVarsFailed" class="containerHorizontal">
                    <span id="spnRendered" class="placeholderCodeMirror"></span>
                    <div class="containerVertical resultType">
                      <span id="spnResultTypeString" class="codicon codicon-symbol-key inactive" title="Results a string"></span>
                      <span id="spnResultTypeStructure" class="codicon codicon-symbol-namespace inactive" title="Results a data structure"></span>
                    </div>
                  </div>
                </section>
              </vscode-panel-view>
              <vscode-panel-view id="vppDebug">
                <section class="containerVertical">
                  <span id="spnDebug" class="placeholderCodeMirror"></span>
                </section>
              </vscode-panel-view>
            </vscode-panels>
          </section>
          <script id="webviewScript" type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>
        </body>
      </html>
    `;
  }
}
