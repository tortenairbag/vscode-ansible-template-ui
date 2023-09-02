import * as child_process from "child_process";
import * as fs from "fs";
import * as tmp from "tmp";
import * as util from "util";
import * as vscode from "vscode";
import * as yaml from "yaml";
import { ExtensionContext, OutputChannel, Uri, Webview, WebviewPanel, WorkspaceFolder } from "vscode";
import { TemplateResultResponseMessage, TemplateResultRequestMessage, HostListResponseMessage, HostListRequestMessage, HostVarsRequestMessage, HostVarsResponseMessage } from "../@types/messageTypes";
import { isObject, isStringArray } from "../@types/assertions";

const execAsPromise = util.promisify(child_process.exec);

interface ExecuteResult {
  successful: boolean
  stderr: string
  stdout: string
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
  private static readonly VIEW_RESOURCES_DIR = "out";
  private static readonly VIEW_SCHEMA = "tortenairbag.tabSession";
  private static readonly VIEW_TITLE = "Ansible Template UI";
  private static readonly PLAYBOOK_TITLE = "Print Template";
  private static readonly TEMPLATE_HOSTLIST = "{{ groups.all | default([]) | sort | unique }}";
  private static readonly TEMPLATE_HOSTVARS = "{{ vars.keys() }}";

  private channel: OutputChannel | undefined;
  private panel: WebviewPanel | undefined;
  private workspaceUri: Uri | undefined;

  private prefAnsibleTimeout = 0;
  private prefOutputRegexSanitizeRules: string[] = [];

  public activate(context: ExtensionContext) {
    context.subscriptions.concat([
      vscode.commands.registerCommand("tortenairbag.ansibleTemplateUi.open", this.open.bind(this, context)),
    ]);
  }

  private async open(context: ExtensionContext) {
    const conf = vscode.workspace.getConfiguration();
    this.prefOutputRegexSanitizeRules = conf.get<string[]>("tortenairbag.ansibleTemplateUi.outputRegexSanitizeRules", []);
    this.prefAnsibleTimeout = conf.get<number>("tortenairbag.ansibleTemplateUi.ansibleTimeout", 5000);

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
              && isObject(payload, ["host", "template", "variables"])
              && typeof payload.host === "string"
              && typeof payload.template === "string"
              && typeof payload.variables === "string") {
            /* TemplateResultRequestMessage */
            await this.renderTemplate({ command: payload.command, host: payload.host, variables: payload.variables, template: payload.template });
          } else if (payload.command === "HostListRequestMessage") {
            /* HostListRequestMessage */
            await this.lookupInventoryHosts({ command: payload.command });
          } else if (payload.command === "HostVarsRequestMessage"
              && isObject(payload, ["host"])
              && typeof payload.host === "string") {
            /* HostVarsRequestMessage */
            await this.lookupHostVars({ command: payload.command, host: payload.host });
          }
        }
      });

      this.panel.onDidDispose(() => { this.panel = undefined; });
    }
  }

  private async lookupInventoryHosts(_message: HostListRequestMessage) {
    const templateMessage: TemplateResultRequestMessage = {
      command: "TemplateResultRequestMessage",
      host: "localhost",
      template: AnsibleTemplateUiManager.TEMPLATE_HOSTLIST,
      variables: "",
    };
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
    const payload: HostListResponseMessage = { command: "HostListResponseMessage", successful: isSuccessful, hosts: hosts, templateMessage: templateMessage };
    await this.panel?.webview.postMessage(payload);
  }

  private async lookupHostVars(message: HostVarsRequestMessage) {
    const templateMessage: TemplateResultRequestMessage = {
      command: "TemplateResultRequestMessage",
      host: message.host,
      template: AnsibleTemplateUiManager.TEMPLATE_HOSTVARS,
      variables: "",
    };
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
    const payload: HostVarsResponseMessage = { command: "HostVarsResponseMessage", successful: isSuccessful, host: message.host, vars: vars, templateMessage: templateMessage };
    await this.panel?.webview.postMessage(payload);
  }

  private async renderTemplate(templateMessage: TemplateResultRequestMessage) {
    const payload = await this.runAnsibleDebug(templateMessage);
    await this.panel?.webview.postMessage(payload);
  }

  private async runAnsibleDebug(templateMessage: TemplateResultRequestMessage) {
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

    const variablesParsed = yaml.parse(variables) as unknown;
    if (variables.trim() !== "" && !isObject(variablesParsed, [])) {
      const payload: TemplateResultResponseMessage = { command: "TemplateResultResponseMessage", successful: false, result: "Variables are malformed, must be yaml-decodable object.", debug: "" };
      return payload;
    }

    const tmpFilePlaybook = tmp.fileSync();
    const tmpFileVariables = tmp.fileSync();

    fs.writeFileSync(tmpFilePlaybook.name, playbook);
    fs.writeFileSync(tmpFileVariables.name, variables);

    let command = `ansible-playbook '${tmpFilePlaybook.name}'`;
    if (variables.trim() !== "") {
      command = `${command} --extra-vars '@${tmpFileVariables.name}'`;
    }

    const result = await this.runAnsible(command);

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
          res = msgs[0].msg;
        } else {
          res = JSON.stringify(msgs[0].msg);
        }
        isSuccessful = !(msgs[0].failed ?? false);
      }
    } else {
      res = "Unable to interpret ansible result...";
    }

    const payload: TemplateResultResponseMessage = { command: "TemplateResultResponseMessage", successful: isSuccessful, result: res, debug: yaml.stringify(result) };
    return payload;
  }

  private async runAnsible(command: string) {
    const channel = this.getOutputChannel();
    const newEnv = { ...process.env };
    const result: ExecuteResult = { successful: false, stderr: "Unknown error", stdout: "" };
    newEnv.ANSIBLE_STDOUT_CALLBACK = "json";
    newEnv.ANSIBLE_COMMAND_WARNINGS = "0";
    newEnv.ANSIBLE_RETRY_FILES_ENABLED = "0";
    try {
      channel.appendLine(command);
      const { stdout, stderr } = await execAsPromise(command, {
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
          if (result.stderr.includes("unrecognized arguments: --ansible")) {
            channel.appendLine("Ansible Tox plugin is not installed in Python environment. Install tox-ansible plugin by running command 'pip install tox-ansible'.");
          }
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
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
          <link rel="stylesheet" href="${styleUri.toString()}">
          <title>${AnsibleTemplateUiManager.VIEW_TITLE}</title>
        </head>
        <body id="bodyWebview">
          <header>
            <h1>${AnsibleTemplateUiManager.VIEW_TITLE}</h1>
          </header>
          <section class="containerVertical">
            <div class="containerHorizontal">
              <select id="selHost" class="containerFill"></select>
              <vscode-button id="btnHostListRefresh" appearance="icon">
                <span class="codicon codicon-refresh"></span>
              </vscode-button>
            </div>
            <div id="divHostListFailed" class="containerHorizontal messageBox hidden">
              <span class="codicon codicon-warning"></span>
              <span>Unable to detect any hosts in inventory. <vscode-link id="lnkHostListDebug" href="#">Click here</vscode-link> to replace the current template with the template used to lookup hosts for debugging purposes.</span>
            </div>
            <label>Variables</label>
            <span id="spnVariables" class="placeholderCodeMirror"></span>
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
                  <span id="spnRendered" class="placeholderCodeMirror"></span>
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
