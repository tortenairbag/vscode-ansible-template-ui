import { Button, Link, provideVSCodeDesignSystem, vsCodeButton, vsCodeLink, vsCodePanels, vsCodePanelTab, vsCodePanelView, vsCodeProgressRing } from "@vscode/webview-ui-toolkit";
import { TemplateResultResponseMessage, TemplateResultRequestMessage, HostListResponseMessage, HostListRequestMessage, HostVarsRequestMessage, HostVarsResponseMessage } from "../@types/messageTypes";
import { isObject, isStringArray } from "../@types/assertions";
import { COMPLETION_JINJA_CUSTOM_VARIABLES_SECTION, COMPLETION_JINJA_CUSTOM_VARIABLES_TYPE, COMPLETION_JINJA_HOST_VARIABLES_SECTION, COMPLETION_JINJA_HOST_VARIABLES_TYPE, jinjaControlCompletions, jinjaFiltersCompletions } from "./autocomplete";
import { autocompletion, Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentUnit, LanguageSupport, StreamLanguage, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, highlightWhitespace, keymap, placeholder } from "@codemirror/view";
import { jinja2 as jinja2Mode } from "@codemirror/legacy-modes/mode/jinja2";
import { yaml as yamlMode } from "@codemirror/legacy-modes/mode/yaml";
import { oneDark, oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import "@vscode/codicons/dist/codicon.css";
import "./style.css";

interface WebviewState {
  hostname: string;
  variables: string;
  template: string;
}

class TemplateResultRefreshButton {
  private readonly animRefresh: Animation;
  private readonly btnRefresh: Button;
  private readonly divError: HTMLDivElement;
  private requestMessage: TemplateResultRequestMessage | undefined;

  constructor(buttonId: string, messageId: string, onButtonClickListener: () => void) {
    this.btnRefresh = document.getElementById(buttonId) as Button;
    this.btnRefresh.addEventListener("click", () => onButtonClickListener());
    this.divError = document.getElementById(messageId) as HTMLDivElement;
    this.animRefresh = this.btnRefresh.animate([
      { transform: "rotate(0)" },
      { transform: "rotate(360deg)" },
    ], {
      duration: 3000,
      iterations: Infinity,
    });
    this.animRefresh.cancel();
  }

  public getRequestMessage() {
    return this.requestMessage;
  }

  public setRequestMessage(message: TemplateResultRequestMessage) {
    this.requestMessage = message;
  }

  public startAnimation() {
    this.animRefresh.play();
    this.btnRefresh.disabled = true;
  }

  public stopAnimation() {
    this.animRefresh.cancel();
    this.btnRefresh.disabled = false;
  }

  public hideError() {
    this.divError.classList.add("hidden");
  }

  public showError() {
    this.divError.classList.remove("hidden");
  }
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
let selHost: HTMLSelectElement | undefined;

let hostListRefresh: TemplateResultRefreshButton | undefined;
let hostVarsRefresh: TemplateResultRefreshButton | undefined;
let isStateOutdated = false;
let isStateUpdateRunning = false;
const jinjaCustomVarsCompletions: Completion[] = [{ label: "a", type: COMPLETION_JINJA_CUSTOM_VARIABLES_TYPE, section: COMPLETION_JINJA_CUSTOM_VARIABLES_SECTION }];
let jinjaHostVarsCompletions: Completion[] = [];

function main() {
  setVSCodeMessageListener();
  btnRender = document.getElementById("btnRender") as Button;
  divRenderLoading = document.getElementById("divRenderLoading") as HTMLDivElement;
  divRenderedError = document.getElementById("divFailed") as HTMLDivElement;
  selHost = document.getElementById("selHost") as HTMLSelectElement;
  const lnkHostListDebug = document.getElementById("lnkHostListDebug") as Link;
  const lnkHostVarsDebug = document.getElementById("lnkHostVarsDebug") as Link;
  const spnVariables = document.getElementById("spnVariables") as HTMLSpanElement;
  const spnTemplate = document.getElementById("spnTemplate") as HTMLSpanElement;
  const spnRendered = document.getElementById("spnRendered") as HTMLSpanElement;
  const spnDebug = document.getElementById("spnDebug") as HTMLSpanElement;
  const scriptElement = document.getElementById("webviewScript") as HTMLScriptElement;

  hostListRefresh = new TemplateResultRefreshButton("btnHostListRefresh", "divHostListFailed", requestHostList);
  hostVarsRefresh = new TemplateResultRefreshButton("btnHostVarsRefresh", "divHostVarsFailed", requestHostVars);

  btnRender.addEventListener("click", () => requestTemplateResult());
  lnkHostListDebug.addEventListener("click", () => setRequestTemplate(hostListRefresh?.getRequestMessage()));
  lnkHostVarsDebug.addEventListener("click", () => setRequestTemplate(hostVarsRefresh?.getRequestMessage()));

  const state = vscode.getState();
  let webviewState: WebviewState = { hostname: "", template: "", variables: "" };
  if (isObject(state, ["hostname", "template", "variables"])
      && typeof state.hostname === "string"
      && typeof state.template === "string"
      && typeof state.variables === "string") {
    /* WebviewState */
    webviewState = {
      hostname: state.hostname,
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
      autocompletion({ override: [(context: CompletionContext) => { return jinja2Completions(context, "yaml"); }] }),
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
      autocompletion({ override: [(context: CompletionContext) => { return jinja2Completions(context, "jinja2"); }] }),
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

  if (webviewState.hostname !== "") {
    selHost.options.add(new Option(webviewState.hostname));
    selHost.value = webviewState.hostname;
  }
  selHost.addEventListener("change", () => { requestHostVars(); updateState(); });

  requestHostList();
  requestHostVars();
}

function jinja2Completions(context: CompletionContext, language: "jinja2" | "yaml"): CompletionResult | null {
  const nodeBefore = syntaxTree(context.state).resolveInner(context.pos, -1);
  if (language === "jinja2" && nodeBefore.name === "variableName"
      || language === "yaml" && nodeBefore.name === "string") {
    const word = context.matchBefore(/\w*/);
    const preWord = context.matchBefore(/(?:\{\{-?|\{%-?|\||\.|\(|\[|,|[^=]=)[ \t\n\r]*\w*/);
    const options = [];
    if (preWord?.text.startsWith("{{") === true || preWord?.text.startsWith("(") === true || preWord?.text.startsWith(",") === true || preWord?.text.startsWith("[") === true || (preWord?.text.match(/^.=/)?.length ?? 0) > 0 ) {
      /* expression / function parameter / attribute name / assignment */
      options.push(...jinjaCustomVarsCompletions);
      options.push(...jinjaHostVarsCompletions);
    } else if (preWord?.text.startsWith("{%") === true) {
      /* statement */
      options.push(...jinjaControlCompletions);
    } else if (preWord?.text.startsWith(".") === true) {
      /* object property - no completion available */
    } else if (preWord?.text.startsWith("|") === true) {
      /* jinja filter - no completion available */
      options.push(...jinjaFiltersCompletions);
    }
    return {
      from: word !== null ? word.from : context.pos, /* eslint-disable-line no-null/no-null */
      options: options,
    };
  } else {
    return null; /* eslint-disable-line no-null/no-null */
  }
}

function updateState() {
  if (isStateUpdateRunning) {
    isStateOutdated = true;
  } else {
    isStateUpdateRunning = true;
    if (selHost === undefined || cmrTemplate === undefined || cmrVariables === undefined) {
      return;
    }
    const state: WebviewState = {
      hostname: selHost.value,
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
      } else if (payload.command === "HostVarsResponseMessage"
          && isObject(payload, ["successful", "host", "vars", "templateMessage"])
          && typeof payload.host === "string"
          && isStringArray(payload.vars)
          && typeof payload.successful === "boolean"
          && isObject(payload.templateMessage, ["command", "host", "variables", "template"])
          && payload.templateMessage.command === "TemplateResultRequestMessage"
          && typeof payload.templateMessage.host === "string"
          && typeof payload.templateMessage.variables === "string"
          && typeof payload.templateMessage.template === "string") {
        /* HostListResponseMessage */
        updateHostVars({
          command: payload.command,
          successful: payload.successful,
          host: payload.host,
          vars: payload.vars,
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
  hostListRefresh?.startAnimation();
  const payload: HostListRequestMessage = { command: "HostListRequestMessage" };
  vscode.postMessage(payload);
}

function updateHostList(message: HostListResponseMessage) {
  hostListRefresh?.stopAnimation();
  hostListRefresh?.setRequestMessage(message.templateMessage);
  if (selHost === undefined) {
    return;
  }
  const oldValue = selHost.value;
  while (selHost.options.length > 0) {
    selHost.options.remove(0);
  }
  for (const h of message.hosts) {
    selHost.options.add(new Option(h));
  }
  if (message.successful) {
    hostListRefresh?.hideError();
    selHost.disabled = false;
  } else {
    hostListRefresh?.showError();
    selHost.selectedIndex = 0;
    selHost.disabled = true;
  }
  if (message.hosts.includes(oldValue)) {
    selHost.value = oldValue;
  }
  if (selHost.value !== oldValue) {
    selHost.dispatchEvent(new Event("change"));
  }
}

function requestHostVars() {
  const host = selHost?.value;
  if (host === undefined || host === "") {
    return;
  }
  hostVarsRefresh?.startAnimation();
  const payload: HostVarsRequestMessage = { command: "HostVarsRequestMessage", host: host };
  vscode.postMessage(payload);
}

function updateHostVars(message: HostVarsResponseMessage) {
  if (message.host !== selHost?.value) {
    return;
  }
  hostVarsRefresh?.stopAnimation();
  hostVarsRefresh?.setRequestMessage(message.templateMessage);
  if (message.successful) {
    hostVarsRefresh?.hideError();
  } else {
    hostVarsRefresh?.showError();
  }
  jinjaHostVarsCompletions = message.vars.map((variable: string) => {
    return { label: variable, type: COMPLETION_JINJA_HOST_VARIABLES_TYPE, section: COMPLETION_JINJA_HOST_VARIABLES_SECTION };
  });
}

function setRequestTemplate(message: TemplateResultRequestMessage | undefined) {
  if (message === undefined || selHost === undefined || cmrVariables === undefined || cmrTemplate === undefined) {
    return;
  }
  const optLocalhost = selHost.namedItem(message.host);
  // eslint-disable-next-line no-null/no-null
  if (optLocalhost !== null) {
    optLocalhost.selected = true;
  }
  cmrVariables.dispatch({
    changes: { from: 0, to: cmrVariables.state.doc.length, insert: message.variables },
  });
  cmrTemplate.dispatch({
    changes: { from: 0, to: cmrTemplate.state.doc.length, insert: message.template },
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
