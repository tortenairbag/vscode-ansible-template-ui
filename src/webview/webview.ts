import { provideVSCodeDesignSystem, Button, vsCodeButton, vsCodePanels, vsCodePanelTab, vsCodePanelView, Panels, vsCodeLink, Link } from "@vscode/webview-ui-toolkit";
import { TemplateResultResponseMessage, TemplateResultRequestMessage, HostListResponseMessage, HostListRequestMessage } from "../@types/messageTypes";
import { isObject, isStringArray } from "../@types/assertions";
import * as codemirror from "codemirror";
import { EditorConfiguration, EditorFromTextArea } from "codemirror";
import "codemirror/addon/display/placeholder";
import "codemirror/mode/yaml/yaml";
import "codemirror/mode/jinja2/jinja2";
import "codemirror/lib/codemirror.css";
import "codemirror/theme/material-darker.css";
import "@vscode/codicons/dist/codicon.css";
import "./style.css";

interface WebviewState {
  variables: string;
  template: string;
}

// In order to use the Webview UI Toolkit web components they
// must be registered with the browser (i.e. webview) using the
// syntax below.
provideVSCodeDesignSystem().register(
  vsCodeButton(),
  vsCodeLink(),
  vsCodePanels(),
  vsCodePanelTab(),
  vsCodePanelView()
);

// Get access to the VS Code API from within the webview context
const vscode = acquireVsCodeApi();

// Just like a regular webpage we need to wait for the webview
// DOM to load before we can reference any of the HTML elements
// or toolkit components
window.addEventListener("load", main);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cmrVariables: EditorFromTextArea | undefined;
let cmrTemplate: EditorFromTextArea | undefined;
let cmrRendered: EditorFromTextArea | undefined;
let cmrDebug: EditorFromTextArea | undefined;
let divRenderedError: HTMLDivElement | undefined;
let divHostListError: HTMLDivElement | undefined;
let selHost: HTMLSelectElement | undefined;

let hostListRequestMessage: TemplateResultRequestMessage | undefined;
let isStateOutdated = false;
let isStateUpdateRunning = false;

function main() {
  setVSCodeMessageListener();
  divRenderedError = document.getElementById("divFailed") as HTMLDivElement;
  divHostListError = document.getElementById("divHostListFailed") as HTMLDivElement;
  selHost = document.getElementById("selHost") as HTMLSelectElement;
  const btnRender = document.getElementById("btnRender") as Button;
  const lnkHostListDebug = document.getElementById("lnkHostListDebug") as Link;
  const txaVariables = document.getElementById("txaVariables") as HTMLTextAreaElement;
  const txaTemplate = document.getElementById("txaTemplate") as HTMLTextAreaElement;
  const txaRendered = document.getElementById("txaRendered") as HTMLTextAreaElement;
  const txaDebug = document.getElementById("txaDebug") as HTMLTextAreaElement;
  const pnlResult = document.getElementById("pnlResult") as Panels;

  btnRender.addEventListener("click", () => requestTemplateResult());
  lnkHostListDebug.addEventListener("click", () => setHostListTemplate());
  pnlResult.addEventListener("click", () => {
    // All non-visible editors are sized with height 0px during initialization,
    cmrRendered?.refresh();
    cmrDebug?.refresh();
  });

  const state = vscode.getState();
  let webviewState: WebviewState = { template: "", variables: "" };
  if (isObject(state, ["variables", "template"])
      && typeof state.variables === "string"
      && typeof state.template === "string") {
    /* WebviewState */
    webviewState = {
      template: state.template,
      variables: state.variables,
    };
  }

  const baseConfig: EditorConfiguration = {
    theme: "material-darker",
    lineNumbers: false,
    indentUnit: 4,
    indentWithTabs: false,
    extraKeys: {
      Tab: function(cm) {
        const spaces = Array((cm.getOption("indentUnit") ?? 4) + 1).join(" ");
        cm.replaceSelection(spaces);
      },
    },
  };
  cmrVariables = codemirror.fromTextArea(txaVariables, {
    ...baseConfig,
    mode: "yaml",
    placeholder: "foo: bar",
  });
  cmrTemplate = codemirror.fromTextArea(txaTemplate, {
    ...baseConfig,
    mode: "jinja2",
    placeholder: "{{ foo }}",
  });
  cmrRendered = codemirror.fromTextArea(txaRendered, {
    ...baseConfig,
    mode: undefined,
    readOnly: true,
  });
  cmrDebug = codemirror.fromTextArea(txaDebug, {
    ...baseConfig,
    mode: undefined,
    readOnly: true,
  });
  cmrVariables.setValue(webviewState.variables);
  cmrTemplate.setValue(webviewState.template);
  cmrVariables.on("change", () => { updateState(); });
  cmrTemplate.on("change", () => { updateState(); });

  requestHostList();
}

function updateState() {
  if (isStateUpdateRunning) {
    isStateOutdated = true;
  } else {
    isStateUpdateRunning = true;
    if (cmrVariables === undefined || cmrTemplate === undefined) {
      return;
    }
    const state: WebviewState = {
      variables: cmrVariables.getValue(),
      template: cmrTemplate.getValue(),
    };
    vscode.setState(state);
    isStateOutdated = false;
    Promise.all([sleep(250)])
      .then(() => {
        isStateUpdateRunning = false;
        if (isStateOutdated) {
          updateState();
        }
      })
      .catch(() => { /* swallow */ });
  }
}

function setVSCodeMessageListener() {
  window.addEventListener("message", (event) => {
    const payload = event.data as unknown;
    if (isObject(payload, ["command"])) {
      /* Message */
      if (payload.command === "TemplateResultResponseMessage"
          && isObject(payload, ["debug", "result", "successful"])
          && typeof payload.debug === "string"
          && typeof payload.result === "string"
          && typeof payload.successful === "boolean") {
        /* TemplateResultResponseMessage */
        printTemplateResult({ command: payload.command, successful: payload.successful, result: payload.result, debug: payload.debug });
      } else if (payload.command === "HostListResponseMessage"
          && isObject(payload, ["hosts", "successful", "templateMessage"])
          && isStringArray(payload.hosts)
          && typeof payload.successful === "boolean"
          && isObject(payload.templateMessage, ["command", "host", "variables", "template"])
          && payload.templateMessage.command === "TemplateResultRequestMessage"
          && typeof payload.templateMessage.host === "string"
          && typeof payload.templateMessage.variables === "string"
          && typeof payload.templateMessage.template === "string") {
        /* HostListResponseMessage */
        updateHostList({
          command: payload.command,
          successful: payload.successful,
          hosts: payload.hosts,
          templateMessage: {
            command: payload.templateMessage.command,
            host: payload.templateMessage.host,
            template: payload.templateMessage.template,
            variables: payload.templateMessage.variables,
          },
        });
      }
    }
  });
}

function requestHostList() {
  const payload: HostListRequestMessage = { command: "HostListRequestMessage" };
  vscode.postMessage(payload);
}

function updateHostList(message: HostListResponseMessage) {
  if (divHostListError === undefined || selHost === undefined) {
    return;
  }
  hostListRequestMessage = message.templateMessage;
  while (selHost.options.length > 0) {
    selHost.options.remove(0);
  }
  for (const h of message.hosts) {
    selHost.options.add(new Option(h));
  }
  if (message.successful) {
    divHostListError.classList.add("hidden");
    selHost.disabled = false;
  } else {
    divHostListError.classList.remove("hidden");
    selHost.selectedIndex = 0;
    selHost.disabled = true;
  }
}

function setHostListTemplate() {
  if (hostListRequestMessage === undefined || selHost === undefined || cmrVariables === undefined || cmrTemplate === undefined) {
    return;
  }
  const optLocalhost = selHost.namedItem(hostListRequestMessage.host);
  // eslint-disable-next-line no-null/no-null
  if (optLocalhost !== null) {
    optLocalhost.selected = true;
  }
  cmrVariables.setValue(hostListRequestMessage.variables);
  cmrTemplate.setValue(hostListRequestMessage.template);
  requestTemplateResult();
}

function requestTemplateResult() {
  if (selHost === undefined || cmrVariables === undefined || cmrTemplate === undefined) {
    return;
  }
  const inpHost = selHost.value;
  const inpVariables = cmrVariables.getValue();
  const inpTemplate = cmrTemplate.getValue();
  const payload: TemplateResultRequestMessage = { command: "TemplateResultRequestMessage", host: inpHost, variables: inpVariables, template: inpTemplate };
  vscode.postMessage(payload);
}

function printTemplateResult(result: TemplateResultResponseMessage) {
  if (cmrRendered === undefined || cmrDebug === undefined) {
    return;
  }
  cmrRendered.setValue(result.result);
  cmrDebug.setValue(result.debug);
  if (result.successful) {
    divRenderedError?.classList.add("hidden");
  } else {
    divRenderedError?.classList.remove("hidden");
  }
}
