import * as child_process from "child_process";
import * as yaml from "yaml";
import * as util from "util";
import * as vscode from "vscode";
import { ExtensionContext, OutputChannel, Uri, Webview, WebviewPanel } from "vscode";
import { PrintTemplateResultMessage, RequestTemplateResultMessage } from "../@types/messageTypes";
import { isObject } from "../@types/assertions";

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
          msg: string;
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
          && typeof value.msg === "string"
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

  private channel: OutputChannel | undefined;
  private panel: WebviewPanel | undefined;

  private prefOutputRegexSanitizeRules: string[] = [];

  public activate(context: ExtensionContext) {
    context.subscriptions.concat([
      vscode.commands.registerCommand("tortenairbag.ansibleTemplateUi.open", this.open.bind(this, context)),
    ]);
  }

  private open(context: ExtensionContext) {
    const conf = vscode.workspace.getConfiguration();
    this.prefOutputRegexSanitizeRules = conf.get<string[]>("tortenairbag.ansibleTemplateUi.outputRegexSanitizeRules", []);

    if (this.panel !== undefined) {
      this.panel.reveal();
    } else {
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
        if (isObject(payload, ["command"])
        && typeof payload.command === "string") {
          /* Message */
          if (payload.command === "requestTemplateResult"
              && "template" in payload
              && "variables" in payload
              && typeof payload.template === "string"
              && typeof payload.variables === "string") {
            /* RequestRenderMessage */
            await this.renderTemplate({ command: payload.command, variables: payload.variables, template: payload.template });
          }
        }
      });

      this.panel.onDidDispose(() => { this.panel = undefined; });
    }
  }

  private async renderTemplate(templateMessage: RequestTemplateResultMessage) {
    const host = "localhost";
    const cmdPlaybook = yaml.stringify([
      {
        name: AnsibleTemplateUiManager.PLAYBOOK_TITLE,
        hosts: host,
        gather_facts: false,
        tasks: [
          {
            name: AnsibleTemplateUiManager.PLAYBOOK_TITLE,
            debug: {
              msg: templateMessage.template,
            },
          },
        ],
      },
    ]);
    const cmdVariables = JSON.stringify(yaml.parse(templateMessage.variables));
    const command = `echo '${cmdPlaybook}' | ansible-playbook --extra-vars '${cmdVariables}' -i localhost, /dev/stdin`;
    const result = await this.runAnsible(command);

    let res = "Unknown error...";
    let isSuccessful = false;
    let stdout: unknown | undefined = undefined;

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
      const msgs: { failed?: boolean; msg: string; }[] = [];
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
        res = msgs[0].msg;
        isSuccessful = !(msgs[0].failed ?? false);
      }
    } else {
      res = "Unable to interpret ansible result...";
    }

    const payload: PrintTemplateResultMessage = { command: "printTemplateResult", successful: isSuccessful, result: res, debug: yaml.stringify(result) };
    await this.panel?.webview.postMessage(payload);
  }

  private async runAnsible(command: string) {
    const channel = this.getOutputChannel();
    const newEnv = { ...process.env };
    const result: ExecuteResult = { successful: false, stderr: "Unknown error", stdout: "" };
    newEnv.ANSIBLE_STDOUT_CALLBACK = "json";
    newEnv.ANSIBLE_COMMAND_WARNINGS = "0";
    newEnv.ANSIBLE_RETRY_FILES_ENABLED = "0";
    // newEnv["PATH"] = `${pathEntry}:${process.env.PATH}`;
    try {
      channel.appendLine(command);
      const { stdout, stderr } = await execAsPromise(command, {
        // cwd: "",
        env: newEnv,
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
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
          <link rel="stylesheet" href="${styleUri.toString()}">
          <title>${AnsibleTemplateUiManager.VIEW_TITLE}</title>
        </head>
        <body id="bodyWebview">
          <header>
            <h1>${AnsibleTemplateUiManager.VIEW_TITLE}</h1>
          </header>
          <section class="container">
            <label for="txaVariables">Variables</label>
            <textarea id="txaVariables"></textarea>
            <label for="txaTemplate">Template</label>
            <textarea id="txaTemplate"></textarea>
            <vscode-button id="btnRender">Render</vscode-button>
            <vscode-panels id="pnlResult">
              <vscode-panel-tab id="vptOutput">OUTPUT</vscode-panel-tab>
              <vscode-panel-tab id="vptDebug">DEBUG</vscode-panel-tab>
              <vscode-panel-view id="vppOutput">
                <section class="container">
                  <div id="divFailed" class="hidden">An error ocurred executing the command.</div>
                  <textarea id="txaRendered"></textarea>
                </section>
              </vscode-panel-view>
              <vscode-panel-view id="vppDebug">
                <section class="container">
                  <textarea id="txaDebug"></textarea>
                </section>
              </vscode-panel-view>
            </vscode-panels>
          </section>
          <script type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>
        </body>
      </html>
    `;
  }
}
