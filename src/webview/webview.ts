import { Button, Link, provideVSCodeDesignSystem, vsCodeButton, vsCodeLink, vsCodePanels, vsCodePanelTab, vsCodePanelView, vsCodeProgressRing } from "@vscode/webview-ui-toolkit";
import { TemplateResultResponseMessage, TemplateResultRequestMessage, HostListResponseMessage, HostListRequestMessage } from "../@types/messageTypes";
import { isObject, isStringArray } from "../@types/assertions";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentUnit, LanguageSupport, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, highlightWhitespace, keymap, placeholder} from "@codemirror/view";
import { jinja2 as jinja2Mode } from "@codemirror/legacy-modes/mode/jinja2";
import { yaml as yamlMode } from "@codemirror/legacy-modes/mode/yaml";
import { oneDark, oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
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
  vsCodePanelView(),
  vsCodeProgressRing()
);

// Get access to the VS Code API from within the webview context
const vscode = acquireVsCodeApi();

// Just like a regular webpage we need to wait for the webview
// DOM to load before we can reference any of the HTML elements
// or toolkit components
window.addEventListener("load", main);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let btnRender: Button | undefined;
let cmrVariables: EditorView | undefined;
let cmrTemplate: EditorView | undefined;
let cmrRendered: EditorView | undefined;
let cmrDebug: EditorView | undefined;
let divRenderLoading: HTMLDivElement | undefined;
let divRenderedError: HTMLDivElement | undefined;
let divHostListError: HTMLDivElement | undefined;
let selHost: HTMLSelectElement | undefined;

let hostListRequestMessage: TemplateResultRequestMessage | undefined;
let isStateOutdated = false;
let isStateUpdateRunning = false;

function main() {
  setVSCodeMessageListener();
  divRenderLoading = document.getElementById("divRenderLoading") as HTMLDivElement;
  divRenderedError = document.getElementById("divFailed") as HTMLDivElement;
  divHostListError = document.getElementById("divHostListFailed") as HTMLDivElement;
  selHost = document.getElementById("selHost") as HTMLSelectElement;
  btnRender = document.getElementById("btnRender") as Button;
  const lnkHostListDebug = document.getElementById("lnkHostListDebug") as Link;
  const spnVariables = document.getElementById("spnVariables") as HTMLSpanElement;
  const spnTemplate = document.getElementById("spnTemplate") as HTMLSpanElement;
  const spnRendered = document.getElementById("spnRendered") as HTMLSpanElement;
  const spnDebug = document.getElementById("spnDebug") as HTMLSpanElement;
  const scriptElement = document.getElementById("webviewScript") as HTMLScriptElement;

  btnRender.addEventListener("click", () => requestTemplateResult());
  lnkHostListDebug.addEventListener("click", () => setHostListTemplate());

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

  const jinja2Language = new LanguageSupport(StreamLanguage.define(jinja2Mode));
  const yamlLanguage = new LanguageSupport(StreamLanguage.define(yamlMode));

  const indentSize = 4;
  const baseExtensions = [
    history(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    oneDark,
    syntaxHighlighting(oneDarkHighlightStyle),
    EditorState.tabSize.of(indentSize),
    indentUnit.of(Array(indentSize + 1).join(" ")),
    highlightWhitespace(),
    EditorView.cspNonce.of(scriptElement.nonce ?? ""),
  ];

  cmrVariables = new EditorView({
    doc: webviewState.variables,
    extensions: [
      ...baseExtensions,
      placeholder("foo: bar"),
      yamlLanguage,
      EditorView.updateListener.of(() => { updateState(); }),
    ],
  });
  spnVariables.parentElement?.insertBefore(cmrVariables.dom, spnVariables);

  cmrTemplate = new EditorView({
    doc: webviewState.template,
    extensions: [
      ...baseExtensions,
      placeholder("{{ foo }}"),
      jinja2Language,
      EditorView.updateListener.of(() => { updateState(); }),
    ],
  });
  spnTemplate.parentElement?.insertBefore(cmrTemplate.dom, spnTemplate);

  cmrRendered = new EditorView({
    extensions: [
      ...baseExtensions,
      EditorState.readOnly.of(true),
    ],
  });
  spnRendered.parentElement?.insertBefore(cmrRendered.dom, spnRendered);

  cmrDebug = new EditorView({
    extensions: [
      ...baseExtensions,
      EditorState.readOnly.of(true),
    ],
  });
  spnDebug.parentElement?.insertBefore(cmrDebug.dom, spnDebug);

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
      variables: cmrVariables.state.doc.toString(),
      template: cmrTemplate.state.doc.toString(),
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
  cmrVariables.dispatch({
    changes: { from: 0, to: cmrVariables.state.doc.length, insert: hostListRequestMessage.variables },
  });
  cmrTemplate.dispatch({
    changes: { from: 0, to: cmrVariables.state.doc.length, insert: hostListRequestMessage.template },
  });
  requestTemplateResult();
}

function requestTemplateResult() {
  if (selHost === undefined || cmrVariables === undefined || cmrTemplate === undefined || btnRender === undefined) {
    return;
  }
  btnRender.disabled = true;
  divRenderLoading?.classList.remove("hidden");
  const inpHost = selHost.value;
  const inpVariables = cmrVariables.state.doc.toString();
  const inpTemplate = cmrTemplate.state.doc.toString();
  const payload: TemplateResultRequestMessage = { command: "TemplateResultRequestMessage", host: inpHost, variables: inpVariables, template: inpTemplate };
  vscode.postMessage(payload);
}

function printTemplateResult(result: TemplateResultResponseMessage) {
  if (cmrRendered === undefined || cmrDebug === undefined || btnRender === undefined) {
    return;
  }
  btnRender.disabled = false;
  divRenderLoading?.classList.add("hidden");
  cmrRendered.dispatch({
    changes: { from: 0, to: cmrRendered.state.doc.length, insert: result.result },
  });
  cmrDebug.dispatch({
    changes: { from: 0, to: cmrDebug.state.doc.length, insert: result.debug },
  });
  if (result.successful) {
    divRenderedError?.classList.add("hidden");
  } else {
    divRenderedError?.classList.remove("hidden");
  }
}
