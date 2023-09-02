import * as yaml from "yaml";
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

class AnsibleTemplateWebview {
  private readonly btnRender: Button;
  private readonly cmrVariables: EditorView;
  private readonly cmrTemplate: EditorView;
  private readonly cmrRendered: EditorView;
  private readonly cmrDebug: EditorView;
  private readonly divRenderLoading: HTMLDivElement;
  private readonly divRenderedError: HTMLDivElement;
  private readonly selHost: HTMLSelectElement;

  private readonly hostListRefresh: TemplateResultRefreshButton;
  private readonly hostVarsRefresh: TemplateResultRefreshButton;
  private jinjaCustomVarsCompletions: Completion[] = [];
  private jinjaHostVarsCompletions: Completion[] = [];

  private readonly rateLimitInfos = {
    customVariables: { outdated: false, running: false, waitTime: 1000 },
    state: { outdated: false, running: false, waitTime: 250 },
  };

  constructor() {
    this.setVSCodeMessageListener();
    this.btnRender = document.getElementById("btnRender") as Button;
    this.divRenderLoading = document.getElementById("divRenderLoading") as HTMLDivElement;
    this.divRenderedError = document.getElementById("divFailed") as HTMLDivElement;
    this.selHost = document.getElementById("selHost") as HTMLSelectElement;

    const lnkHostListDebug = document.getElementById("lnkHostListDebug") as Link;
    const lnkHostVarsDebug = document.getElementById("lnkHostVarsDebug") as Link;
    const spnVariables = document.getElementById("spnVariables") as HTMLSpanElement;
    const spnTemplate = document.getElementById("spnTemplate") as HTMLSpanElement;
    const spnRendered = document.getElementById("spnRendered") as HTMLSpanElement;
    const spnDebug = document.getElementById("spnDebug") as HTMLSpanElement;
    const scriptElement = document.getElementById("webviewScript") as HTMLScriptElement;

    this.hostListRefresh = new TemplateResultRefreshButton("btnHostListRefresh", "divHostListFailed", () => { this.requestHostList(); });
    this.hostVarsRefresh = new TemplateResultRefreshButton("btnHostVarsRefresh", "divHostVarsFailed", () => { this.requestHostVars(); });

    this.btnRender.addEventListener("click", () => this.requestTemplateResult());
    lnkHostListDebug.addEventListener("click", () => this.setRequestTemplate(this.hostListRefresh.getRequestMessage()));
    lnkHostVarsDebug.addEventListener("click", () => this.setRequestTemplate(this.hostVarsRefresh.getRequestMessage()));

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

    this.cmrVariables = new EditorView({
      doc: webviewState.variables,
      extensions: [
        ...baseExtensions,
        placeholder("foo: bar"),
        yamlLanguage,
        autocompletion({ override: [(context: CompletionContext) => { return this.jinja2Completions(context, "yaml"); }] }),
        EditorView.updateListener.of(() => { this.updateState(); this.updateCustomVarsCompletions(); }),
      ],
    });
    spnVariables.parentElement?.insertBefore(this.cmrVariables.dom, spnVariables);

    this.cmrTemplate = new EditorView({
      doc: webviewState.template,
      extensions: [
        ...baseExtensions,
        placeholder("{{ foo }}"),
        jinja2Language,
        autocompletion({ override: [(context: CompletionContext) => { return this.jinja2Completions(context, "jinja2"); }] }),
        EditorView.updateListener.of(() => { this.updateState(); }),
      ],
    });
    spnTemplate.parentElement?.insertBefore(this.cmrTemplate.dom, spnTemplate);

    this.cmrRendered = new EditorView({
      extensions: [
        ...baseExtensions,
        EditorState.readOnly.of(true),
      ],
    });
    spnRendered.parentElement?.insertBefore(this.cmrRendered.dom, spnRendered);

    this.cmrDebug = new EditorView({
      extensions: [
        ...baseExtensions,
        EditorState.readOnly.of(true),
      ],
    });
    spnDebug.parentElement?.insertBefore(this.cmrDebug.dom, spnDebug);

    if (webviewState.hostname !== "") {
      this.selHost.options.add(new Option(webviewState.hostname));
      this.selHost.value = webviewState.hostname;
    }
    this.selHost.addEventListener("change", () => { this.requestHostVars(); this.updateState(); });

    this.requestHostList();
    this.requestHostVars();
  }

  private jinja2Completions(context: CompletionContext, language: "jinja2" | "yaml"): CompletionResult | null {
    const nodeBefore = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (language === "jinja2" && nodeBefore.name === "variableName"
        || language === "yaml" && nodeBefore.name === "string") {
      const word = context.matchBefore(/\w*/);
      const preWord = context.matchBefore(/(?:\{\{-?|\{%-?|\||\.|\(|\[|,|[^=]=)[ \t\n\r]*\w*/);
      const options = [];
      if (preWord?.text.startsWith("{{") === true || preWord?.text.startsWith("(") === true || preWord?.text.startsWith(",") === true || preWord?.text.startsWith("[") === true || (preWord?.text.match(/^.=/)?.length ?? 0) > 0 ) {
        /* expression / function parameter / attribute name / assignment */
        options.push(...this.jinjaCustomVarsCompletions);
        options.push(...this.jinjaHostVarsCompletions);
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

  private execRateLimited(type: keyof typeof this.rateLimitInfos, handler: () => void) {
    if (this.rateLimitInfos[type].running) {
      this.rateLimitInfos[type].outdated = true;
    } else {
      this.rateLimitInfos[type].running = true;
      handler();
      this.rateLimitInfos[type].outdated = false;
      Promise.all([sleep(this.rateLimitInfos[type].waitTime)])
        .then(() => {
          this.rateLimitInfos[type].running = false;
          if (this.rateLimitInfos[type].outdated) {
            this.execRateLimited(type, handler);
          }
        })
        .catch(() => { /* swallow */ });
    }
  }

  private updateCustomVarsCompletions() {
    this.execRateLimited("customVariables", () => {
      const variables = this.cmrVariables.state.doc.toString();
      let variablesParsed: unknown;
      try {
        variablesParsed = yaml.parse(variables);
      } catch { /* swallow */ }
      if (!isObject(variablesParsed, [])) {
        if (variables !== "") {
          this.cmrVariables.dom.classList.add("parserError");
        }
        return;
      }
      this.cmrVariables.dom.classList.remove("parserError");
      this.jinjaCustomVarsCompletions = Object.keys(variablesParsed).map((key: string) => {
        return { label: key, type: COMPLETION_JINJA_CUSTOM_VARIABLES_TYPE, section: COMPLETION_JINJA_CUSTOM_VARIABLES_SECTION };
      });
    });
  }

  private updateState() {
    this.execRateLimited("state", () => {
      const state: WebviewState = {
        hostname: this.selHost.value,
        variables: this.cmrVariables.state.doc.toString(),
        template: this.cmrTemplate.state.doc.toString(),
      };
      vscode.setState(state);
    });
  }

  private setVSCodeMessageListener() {
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
          this.printTemplateResult({ command: payload.command, successful: payload.successful, result: payload.result, debug: payload.debug });
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
          this.updateHostList({
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
          this.updateHostVars({
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

  private requestHostList() {
    this.hostListRefresh.startAnimation();
    const payload: HostListRequestMessage = { command: "HostListRequestMessage" };
    vscode.postMessage(payload);
  }

  private updateHostList(message: HostListResponseMessage) {
    this.hostListRefresh.stopAnimation();
    this.hostListRefresh.setRequestMessage(message.templateMessage);
    const oldValue = this.selHost.value;
    while (this.selHost.options.length > 0) {
      this.selHost.options.remove(0);
    }
    for (const h of message.hosts) {
      this.selHost.options.add(new Option(h));
    }
    if (message.successful) {
      this.hostListRefresh.hideError();
      this.selHost.disabled = false;
    } else {
      this.hostListRefresh.showError();
      this.selHost.selectedIndex = 0;
      this.selHost.disabled = true;
    }
    if (message.hosts.includes(oldValue)) {
      this.selHost.value = oldValue;
    }
    if (this.selHost.value !== oldValue) {
      this.selHost.dispatchEvent(new Event("change"));
    }
  }

  private requestHostVars() {
    const host = this.selHost.value;
    if (host === "") {
      return;
    }
    this.hostVarsRefresh.startAnimation();
    const payload: HostVarsRequestMessage = { command: "HostVarsRequestMessage", host: host };
    vscode.postMessage(payload);
  }

  private updateHostVars(message: HostVarsResponseMessage) {
    if (message.host !== this.selHost.value) {
      return;
    }
    this.hostVarsRefresh.stopAnimation();
    this.hostVarsRefresh.setRequestMessage(message.templateMessage);
    if (message.successful) {
      this.hostVarsRefresh.hideError();
    } else {
      this.hostVarsRefresh.showError();
    }
    this.jinjaHostVarsCompletions = message.vars.map((variable: string) => {
      return { label: variable, type: COMPLETION_JINJA_HOST_VARIABLES_TYPE, section: COMPLETION_JINJA_HOST_VARIABLES_SECTION };
    });
  }

  private setRequestTemplate(message: TemplateResultRequestMessage | undefined) {
    if (message === undefined) {
      return;
    }
    const optLocalhost = this.selHost.namedItem(message.host);
    // eslint-disable-next-line no-null/no-null
    if (optLocalhost !== null) {
      optLocalhost.selected = true;
    }
    this.cmrVariables.dispatch({
      changes: { from: 0, to: this.cmrVariables.state.doc.length, insert: message.variables },
    });
    this.cmrTemplate.dispatch({
      changes: { from: 0, to: this.cmrTemplate.state.doc.length, insert: message.template },
    });
    this.requestTemplateResult();
  }

  private requestTemplateResult() {
    this.btnRender.disabled = true;
    this.divRenderLoading.classList.remove("hidden");
    const inpHost = this.selHost.value;
    const inpVariables = this.cmrVariables.state.doc.toString();
    const inpTemplate = this.cmrTemplate.state.doc.toString();
    const payload: TemplateResultRequestMessage = { command: "TemplateResultRequestMessage", host: inpHost, variables: inpVariables, template: inpTemplate };
    vscode.postMessage(payload);
  }

  private printTemplateResult(result: TemplateResultResponseMessage) {
    this.btnRender.disabled = false;
    this.divRenderLoading.classList.add("hidden");
    this.cmrRendered.dispatch({
      changes: { from: 0, to: this.cmrRendered.state.doc.length, insert: result.result },
    });
    this.cmrDebug.dispatch({
      changes: { from: 0, to: this.cmrDebug.state.doc.length, insert: result.debug },
    });
    if (result.successful) {
      this.divRenderedError.classList.add("hidden");
    } else {
      this.divRenderedError.classList.remove("hidden");
    }
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
window.addEventListener("load", () => {
  new AnsibleTemplateWebview();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
