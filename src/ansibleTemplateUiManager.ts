import * as child_process from "child_process";
import * as yaml from "yaml";
import * as util from "util";
import * as vscode from "vscode";
import { ExtensionContext, OutputChannel, Uri, Webview, WebviewPanel } from "vscode";
import { PrintTemplateResultMessage, RequestTemplateResultMessage } from "./@types/messageTypes";
import { isObject } from "./@types/assertions";

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

  public activate(context: ExtensionContext) {
    context.subscriptions.concat([
      vscode.commands.registerCommand("tortenairbag.ansibleTemplateUi.open", this.open.bind(this, context)),
    ]);
  }

  private open(context: ExtensionContext) {
    if (this.panel === undefined) {
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
    }

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

    let res = "Error :/";
    let stdout = undefined;

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
      }
    } else {
      res = "Unable to interpret ansible result...";
    }

    const payload: PrintTemplateResultMessage = { command: "printTemplateResult", result: res, debug: yaml.stringify(result) };
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
    const webviewUri = this.getUri(webview, extensionUri, [AnsibleTemplateUiManager.VIEW_RESOURCES_DIR, "webview.js"]);
    const styleUri = this.getUri(webview, extensionUri, [AnsibleTemplateUiManager.VIEW_RESOURCES_DIR, "style.css"]);
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
          <section id="formTemplate">
            <vscode-text-area id="txaVariables" value="" placeholder="foo: &quot;bar&quot;" resize="vertical" rows=15>Variables</vscode-text-area>
            <vscode-text-area id="txaTemplate" value="" placeholder="{{ foo }}" resize="vertical" rows=15>Template</vscode-text-area>
            <vscode-button id="btnRender">Render</vscode-button>
            <vscode-text-area id="txaRendered" value="" placeholder="bar" resize="vertical" rows=15 disabled>Result</vscode-text-area>
            <vscode-text-area id="txaDebug" value="" placeholder="" resize="vertical" rows=15 disabled>Debug output</vscode-text-area>
          </section>
          <script type="module" nonce="${nonce}" src="${webviewUri.toString()}"></script>
        </body>
      </html>
    `;
  }
}
