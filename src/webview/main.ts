/// <reference lib="dom" />
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import {
  provideVSCodeDesignSystem,
  Button,
  TextArea,
  vsCodeButton,
  vsCodeTag,
  vsCodeTextArea,
  vsCodeTextField,
} from "@vscode/webview-ui-toolkit";
import { PrintTemplateResultMessage, RequestTemplateResultMessage } from "../@types/MessageTypes";

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
    if (!!payload /* eslint-disable-line @typescript-eslint/strict-boolean-expressions */
        && typeof payload === "object"
        && "command" in payload
        && typeof payload.command === "string") {
      /* Message */
      if (payload.command === "printTemplateResult"
          && "result" in payload
          && typeof payload.result === "string") {
        /* PrintTemplateResultMessage */
        printTemplateResult({ command: payload.command, result: payload.result });
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
  txaDebug.value = result.result;
  const res = JSON.parse(result.result);
  txaRendered.value = res.plays[0].tasks[0].hosts.localhost.msg;
}
