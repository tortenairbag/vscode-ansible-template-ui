import { provideVSCodeDesignSystem, Button, TextArea, vsCodeButton, vsCodeTag, vsCodeTextArea, vsCodeTextField } from "@vscode/webview-ui-toolkit";
import { PrintTemplateResultMessage, RequestTemplateResultMessage } from "../@types/messageTypes";
import { isObject } from "../@types/assertions";
import * as codemirror from "codemirror";
import { EditorFromTextArea } from "codemirror";
import "codemirror/mode/yaml/yaml";
import "codemirror/mode/jinja2/jinja2";

// In order to use the Webview UI Toolkit web components they
// must be registered with the browser (i.e. webview) using the
// syntax below.
provideVSCodeDesignSystem().register(
  vsCodeButton(),
  vsCodeTag(),
  vsCodeTextArea(),
  vsCodeTextField()
);

// Get access to the VS Code API from within the webview context
const vscode = acquireVsCodeApi();

// Just like a regular webpage we need to wait for the webview
// DOM to load before we can reference any of the HTML elements
// or toolkit components
window.addEventListener("load", main);

let cmrVariables: EditorFromTextArea | undefined = undefined;
let cmrTemplate: EditorFromTextArea | undefined = undefined;

function main() {
  setVSCodeMessageListener();
  const btnRender = document.getElementById("btnRender") as Button;
  const txaVariables = document.getElementById("txaVariables") as HTMLTextAreaElement;
  const txaTemplate = document.getElementById("txaTemplate") as HTMLTextAreaElement;

  btnRender.addEventListener("click", () => requestTemplateResult());
  cmrVariables = codemirror.fromTextArea(txaVariables, {
    mode: "yaml",
    theme: "material-darker",
    lineNumbers: false,
    indentUnit: 4,
  });
  cmrTemplate = codemirror.fromTextArea(txaTemplate, {
    mode: "jinja2",
    theme: "material-darker",
    lineNumbers: false,
    indentUnit: 4,
  });
}

function setVSCodeMessageListener() {
  window.addEventListener("message", (event) => {
    const payload = event.data as unknown;
    if (isObject(payload, ["command"])
        && typeof payload.command === "string") {
      /* Message */
      if (payload.command === "printTemplateResult"
          && "debug" in payload
          && "result" in payload
          && typeof payload.debug === "string"
          && typeof payload.result === "string") {
        /* PrintTemplateResultMessage */
        printTemplateResult({ command: payload.command, result: payload.result, debug: payload.debug });
      }
    }
  });
}

function requestTemplateResult() {
  if (cmrVariables === undefined || cmrTemplate === undefined) {
    return;
  }
  const inpVariables = cmrVariables.getValue();
  const inpTemplate = cmrTemplate.getValue();
  const payload: RequestTemplateResultMessage = { command: "requestTemplateResult", variables: inpVariables, template: inpTemplate };
  vscode.postMessage(payload);
}

function printTemplateResult(result: PrintTemplateResultMessage) {
  const txaDebug = document.getElementById("txaDebug") as TextArea;
  const txaRendered = document.getElementById("txaRendered") as TextArea;
  txaDebug.value = result.debug;
  txaRendered.value = result.result;
}
