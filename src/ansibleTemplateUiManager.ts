import * as child_process from "child_process";
import * as os from "os";
import * as util from "util";
import * as vscode from "vscode";
import { ExtensionContext, Uri, Webview, WebviewPanel } from "vscode";
import { PrintTemplateResultMessage, RequestTemplateResultMessage } from "./@types/MessageTypes";

export class AnsibleTemplateUiManager {

  private static readonly VIEW_RESOURCES_DIR = "out";
  private static readonly VIEW_SCHEMA = "tortenairbag.tabSession";
  private static readonly VIEW_TITLE = "Ansible Template UI";

  public panel: WebviewPanel | undefined;

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
    this.panel.webview.html = this.getWebviewContent(this.panel.webview, context.extensionUri);

    this.panel.webview.onDidReceiveMessage(async (payload: unknown) => {
      if (!!payload /* eslint-disable-line @typescript-eslint/strict-boolean-expressions */
          && typeof payload === "object"
          && "command" in payload
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

  private async renderTemplate(template: RequestTemplateResultMessage) {
    // const result = `variables: ${template.variables}    template: ${template.template}`; /* eslint-disable-line @typescript-eslint/restrict-template-expressions */ /* eslint-disable-line @typescript-eslint/no-unsafe-member-access */
    const result = await this.runAnsible(template); /* eslint-disable-line @typescript-eslint/restrict-template-expressions */ /* eslint-disable-line @typescript-eslint/no-unsafe-member-access */

    const payload: PrintTemplateResultMessage = { command: "printTemplateResult", result: result };

    await this.panel?.webview.postMessage(payload);
  }

  private _channel: vscode.OutputChannel | undefined;
  private getOutputChannel() {
    if (!this._channel) {
      this._channel = vscode.window.createOutputChannel("Ansible Tox Auto Detection");
    }
    return this._channel;
  }

  private async runAnsible(template: RequestTemplateResultMessage) {
    /* eslint-disable */
    const exec = util.promisify(child_process.exec);
    const newEnv = { ...process.env };
    // newEnv["PATH"] = `${pathEntry}:${process.env.PATH}`;
    newEnv["ANSIBLE_STDOUT_CALLBACK"] = "json";
    newEnv["ANSIBLE_COMMAND_WARNINGS"] = "0";
    newEnv["ANSIBLE_RETRY_FILES_ENABLED"] = "0";
    try {
      const command = `
      echo '
- hosts: localhost
  gather_facts: no
  tasks:
    - name: Print a message
      debug:
        msg: "${template.template}"
' | ansible-playbook -i localhost, /dev/stdin
      `;

      const { stdout, stderr } = await exec(command, {
        // cwd: ,
        env: newEnv,
      });
      if (stderr && stderr.length > 0) {
        const channel = this.getOutputChannel();
        channel.appendLine(stderr);
        channel.show(true);
      }
      console.log("stdout", stdout);
      return stdout?.trim();
    } catch (err: any) {
      const channel = this.getOutputChannel();
      channel.appendLine(err.stderr || "");
      channel.appendLine(err.stdout || "");
      if (err.stderr.includes("unrecognized arguments: --ansible")) {
        channel.appendLine(
          "Ansible Tox plugin is not installed in Python environment. Install tox-ansible plugin by running command 'pip install tox-ansible'."
        );
      }
      channel.appendLine("Error running ansible template commands.");
      channel.show(true);
    }
    return "Error :/";
  }


  private getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private getUri(webview: Webview, extensionUri: Uri, pathList: string[]) {
    return webview.asWebviewUri(Uri.joinPath(extensionUri, ...pathList));
  }

  private getWebviewContent(webview: Webview, extensionUri: Uri) {
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
