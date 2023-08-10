/// <reference lib="dom" />

import {
  provideVSCodeDesignSystem,
  Button,
  TextArea,
  vsCodeButton,
  vsCodeTag,
  vsCodeTextArea,
  vsCodeTextField,
} from "@vscode/webview-ui-toolkit";
import { PrintTemplateResultMessage, RequestTemplateResultMessage } from "../@types/messageTypes";
import { isObject } from "../@types/assertions";

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

function main() {
  setVSCodeMessageListener();
  const btnRender = document.getElementById("btnRender") as Button;
  btnRender.addEventListener("click", () => requestTemplateResult());
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
  const txaVariables = document.getElementById("txaVariables") as TextArea;
  const txaTemplate = document.getElementById("txaTemplate") as TextArea;
  const inpVariables = txaVariables.value;
  const inpTemplate = txaTemplate.value;
  const payload: RequestTemplateResultMessage = { command: "requestTemplateResult", variables: inpVariables, template: inpTemplate };
  vscode.postMessage(payload);
}

function printTemplateResult(result: PrintTemplateResultMessage) {
  const txaDebug = document.getElementById("txaDebug") as TextArea;
  const txaRendered = document.getElementById("txaRendered") as TextArea;
  txaDebug.value = result.debug;
  txaRendered.value = result.result;
}
