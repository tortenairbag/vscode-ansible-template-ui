import { ExtensionContext } from "vscode";
import { AnsibleTemplateUiManager } from "./ansibleTemplateUiManager";

export function activate(context: ExtensionContext) {
  const ansibleTemplateUiManager = new AnsibleTemplateUiManager();

  Promise.all([
    ansibleTemplateUiManager.activate(context),
  ]).catch(() => { /* swallow */ });
}
