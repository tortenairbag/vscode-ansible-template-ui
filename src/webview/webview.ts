import { Button, Link, provideVSCodeDesignSystem, vsCodeButton, vsCodeLink, vsCodePanels, vsCodePanelTab, vsCodePanelView, vsCodeProgressRing } from "@vscode/webview-ui-toolkit";
import { TemplateResultResponseMessage, TemplateResultRequestMessage, HostListResponseMessage, HostListRequestMessage, HostVarsRequestMessage, HostVarsResponseMessage, ProfileInfoResponseMessage, ProfileInfoRequestMessage, ProfileSettingsRequestMessage } from "../@types/messageTypes";
import { isObject, isStringArray, parseVariableString } from "../@types/assertions";
import { COMPLETION_JINJA_CUSTOM_VARIABLES_SECTION, COMPLETION_JINJA_CUSTOM_VARIABLES_TYPE, COMPLETION_JINJA_HOST_VARIABLES_SECTION, COMPLETION_JINJA_HOST_VARIABLES_TYPE, jinjaControlCompletions, jinjaFiltersCompletions } from "./autocomplete";
import { autocompletion, Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentUnit, language, LanguageSupport, StreamLanguage, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, highlightWhitespace, keymap, placeholder } from "@codemirror/view";
import { jinja2 as jinja2Mode } from "@codemirror/legacy-modes/mode/jinja2";
import { yaml as yamlMode } from "@codemirror/legacy-modes/mode/yaml";
import { oneDark, oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import "@vscode/codicons/dist/codicon.css";
import "./style.css";

const jinja2Language = new LanguageSupport(StreamLanguage.define(jinja2Mode));
const yamlLanguage = new LanguageSupport(StreamLanguage.define(yamlMode));

interface WebviewState {
  hostname: string;
  profile: string;
  variables: string;
  template: string;
}

class TemplateResultRefreshButton {
  private readonly animRefresh: Animation;
  private readonly btnRefresh: Button;
  private readonly divError: HTMLDivElement | undefined;
  private requestMessage: TemplateResultRequestMessage | undefined;

  constructor(buttonId: string, messageId: string | undefined, onButtonClickListener: () => void) {
    this.btnRefresh = document.getElementById(buttonId) as Button;
    this.btnRefresh.addEventListener("click", () => onButtonClickListener());
    if (messageId !== undefined) {
      this.divError = document.getElementById(messageId) as HTMLDivElement;
    }
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
    this.divError?.classList.add("hidden");
  }

  public showError() {
    this.divError?.classList.remove("hidden");
  }
}

class AnsibleTemplateWebview {
  private readonly btnRender: Button;
  private readonly cmrProfile: EditorView;
  private readonly cmrVariables: EditorView;
  private readonly cmrTemplate: EditorView;
  private readonly cmrRendered: EditorView;
  private readonly cmrDebug: EditorView;
  private readonly divProfiles: HTMLDivElement;
  private readonly divRenderedError: HTMLDivElement;
  private readonly divRenderLoading: HTMLDivElement;
  private readonly selHost: HTMLSelectElement;
  private readonly selProfile: HTMLSelectElement;
  private readonly spnResultTypeString: HTMLSpanElement;
  private readonly spnResultTypeStructure: HTMLSpanElement;

  private ansibleProfiles: Record<string, string> = {};
  private readonly cfgRenderedLanguage = new Compartment();
  private readonly cfgVariableLanguage = new Compartment();
  private readonly hostListRefresh: TemplateResultRefreshButton;
  private readonly hostVarsRefresh: TemplateResultRefreshButton;
  private readonly profileRefresh: TemplateResultRefreshButton;
  private jinjaCustomVarsCompletions: Completion[] = [];
  private jinjaHostVarsCompletions: Completion[] = [];

  private readonly rateLimitInfos = {
    customVariables: { outdated: false, running: false, waitTime: 1000 },
    state: { outdated: false, running: false, waitTime: 250 },
  };

  constructor() {
    this.setVSCodeMessageListener();
    this.btnRender = document.getElementById("btnRender") as Button;
    this.divProfiles = document.getElementById("divProfiles") as HTMLDivElement;
    this.divRenderLoading = document.getElementById("divRenderLoading") as HTMLDivElement;
    this.divRenderedError = document.getElementById("divFailed") as HTMLDivElement;
    this.selHost = document.getElementById("selHost") as HTMLSelectElement;
    this.selProfile = document.getElementById("selProfile") as HTMLSelectElement;
    this.spnResultTypeString = document.getElementById("spnResultTypeString") as HTMLSpanElement;
    this.spnResultTypeStructure = document.getElementById("spnResultTypeStructure") as HTMLSpanElement;

    const btnProfileInfoToggle = document.getElementById("btnProfileInfoToggle") as Button;
    const btnProfileSettings = document.getElementById("btnProfileSettings") as Button;
    const lnkHostListDebug = document.getElementById("lnkHostListDebug") as Link;
    const lnkHostVarsDebug = document.getElementById("lnkHostVarsDebug") as Link;
    const spnProfile = document.getElementById("spnProfile") as HTMLSpanElement;
    const spnVariables = document.getElementById("spnVariables") as HTMLSpanElement;
    const spnTemplate = document.getElementById("spnTemplate") as HTMLSpanElement;
    const spnRendered = document.getElementById("spnRendered") as HTMLSpanElement;
    const spnDebug = document.getElementById("spnDebug") as HTMLSpanElement;
    const scriptElement = document.getElementById("webviewScript") as HTMLScriptElement;

    this.hostListRefresh = new TemplateResultRefreshButton("btnHostListRefresh", "divHostListFailed", () => { this.requestHostList(); });
    this.hostVarsRefresh = new TemplateResultRefreshButton("btnHostVarsRefresh", "divHostVarsFailed", () => { this.requestHostVars(); });
    this.profileRefresh = new TemplateResultRefreshButton("btnProfileRefresh", undefined, () => { this.requestProfilesInfo(); });

    this.btnRender.addEventListener("click", () => this.requestTemplateResult());
    btnProfileInfoToggle.addEventListener("click", () => this.toggleProfileInfo());
    btnProfileSettings.addEventListener("click", () => this.requestProfileSettings());
    lnkHostListDebug.addEventListener("click", () => this.setRequestTemplate(this.hostListRefresh.getRequestMessage()));
    lnkHostVarsDebug.addEventListener("click", () => this.setRequestTemplate(this.hostVarsRefresh.getRequestMessage()));

    const state = vscode.getState();
    let webviewState: WebviewState = { hostname: "", profile: "", template: "", variables: "" };
    if (isObject(state, ["hostname", "profile", "template", "variables"])
        && typeof state.hostname === "string"
        && typeof state.profile === "string"
        && typeof state.template === "string"
        && typeof state.variables === "string") {
      /* WebviewState */
      webviewState = {
        hostname: state.hostname,
        profile: state.profile,
        template: state.template,
        variables: state.variables,
      };
    }

    const indentSize = 4;
    const baseKeymap = [...defaultKeymap, ...historyKeymap, indentWithTab ];
    const baseExtensions = [
      history(),
      oneDark,
      syntaxHighlighting(oneDarkHighlightStyle),
      EditorState.tabSize.of(indentSize),
      indentUnit.of(Array(indentSize + 1).join(" ")),
      highlightWhitespace(),
      EditorView.cspNonce.of(scriptElement.nonce ?? ""),
    ];

    this.cmrProfile = new EditorView({
      extensions: [
        ...baseExtensions,
        keymap.of(baseKeymap),
        EditorState.readOnly.of(true),
        jsonLanguage(),
      ],
    });
    spnProfile.parentElement?.insertBefore(this.cmrProfile.dom, spnProfile);

    this.cmrVariables = new EditorView({
      doc: webviewState.variables,
      extensions: [
        ...baseExtensions,
        keymap.of(baseKeymap),
        placeholder("foo: bar"),
        this.cfgVariableLanguage.of(yamlLanguage),
        autocompletion({ override: [this.jinja2Completions.bind(this)] }),
        EditorView.updateListener.of(() => { this.updateState(); this.updateCustomVarsCompletions(); }),
      ],
    });
    spnVariables.parentElement?.insertBefore(this.cmrVariables.dom, spnVariables);

    this.cmrTemplate = new EditorView({
      doc: webviewState.template,
      extensions: [
        ...baseExtensions,
        keymap.of(baseKeymap),
        placeholder("{{ foo }}"),
        jinja2Language,
        autocompletion({ override: [this.jinja2Completions.bind(this)] }),
        EditorView.updateListener.of(() => { this.updateState(); }),
      ],
    });
    spnTemplate.parentElement?.insertBefore(this.cmrTemplate.dom, spnTemplate);

    this.cmrRendered = new EditorView({
      extensions: [
        ...baseExtensions,
        keymap.of([...baseKeymap, ...searchKeymap]),
        EditorState.readOnly.of(true),
        this.cfgRenderedLanguage.of([]),
        highlightSelectionMatches(),
      ],
    });
    spnRendered.parentElement?.insertBefore(this.cmrRendered.dom, spnRendered);

    this.cmrDebug = new EditorView({
      extensions: [
        ...baseExtensions,
        keymap.of([...baseKeymap, ...searchKeymap]),
        EditorState.readOnly.of(true),
        highlightSelectionMatches(),
      ],
    });
    spnDebug.parentElement?.insertBefore(this.cmrDebug.dom, spnDebug);

    if (webviewState.profile !== "") {
      this.selProfile.options.add(new Option(webviewState.profile));
      this.selProfile.value = webviewState.profile;
    }
    this.selProfile.addEventListener("change", () => { this.updateState(); this.updateProfileInfo(); this.requestHostList(); });

    if (webviewState.hostname !== "") {
      this.selHost.options.add(new Option(webviewState.hostname));
      this.selHost.value = webviewState.hostname;
    }
    this.selHost.addEventListener("change", () => { this.updateState(); this.requestHostVars(); });

    this.requestProfilesInfo();
    if (this.selProfile.value !== "") {
      this.requestHostList();
      if (this.selHost.value !== "") {
        this.requestHostVars();
      }
    }
  }

  private jinja2Completions(context: CompletionContext): CompletionResult | null {
    const languageHint = context.state.facet(language)?.name;
    const nodeBefore = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (languageHint === "jinja2" && nodeBefore.name === "variableName"
        || languageHint === "json" && nodeBefore.name === "String"
        || languageHint === "yaml" && nodeBefore.name === "string") {
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
    }
    return null; /* eslint-disable-line no-null/no-null */
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
      const variablesParsed = parseVariableString(variables);
      if (variablesParsed === undefined) {
        if (variables !== "") {
          this.cmrVariables.dom.classList.add("parserError");
        }
        return;
      }

      const languageHint = this.cmrVariables.state.facet(language)?.name;
      if (languageHint !== variablesParsed.language) {
        this.cmrVariables.dispatch({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
          effects: this.cfgVariableLanguage.reconfigure(variablesParsed.language === "json" ? jsonLanguage() : yamlLanguage),
        });
      }

      this.cmrVariables.dom.classList.remove("parserError");
      this.jinjaCustomVarsCompletions = Object.keys(variablesParsed.result).map((key: string) => {
        return { label: key, type: COMPLETION_JINJA_CUSTOM_VARIABLES_TYPE, section: COMPLETION_JINJA_CUSTOM_VARIABLES_SECTION };
      });
    });
  }

  private updateState() {
    this.execRateLimited("state", () => {
      const state: WebviewState = {
        hostname: this.selHost.value,
        profile: this.selProfile.value,
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
            && isObject(payload, ["debug", "result", "successful", "type"])
            && typeof payload.debug === "string"
            && typeof payload.result === "string"
            && typeof payload.successful === "boolean"
            && (payload.type === "string" || payload.type === "structure" || payload.type === "unknown")) {
          /* TemplateResultResponseMessage */
          this.printTemplateResult({ command: payload.command, successful: payload.successful, type: payload.type, result: payload.result, debug: payload.debug });
        } else if (payload.command === "ProfileInfoResponseMessage"
            && isObject(payload, ["profiles"])
            && isObject(payload.profiles, [])) {
          /* ProfileInfoResponseMessage */
          this.updateProfileInfos({
            command: payload.command,
            profiles: payload.profiles,
          });
        } else if (payload.command === "HostListResponseMessage"
            && isObject(payload, ["status", "hosts", "templateMessage"])
            && isStringArray(payload.hosts)
            && (payload.status === "successful" || payload.status === "failed" || payload.status === "cache")
            && isObject(payload.templateMessage, ["command", "profile", "host", "variables", "template"])
            && payload.templateMessage.command === "TemplateResultRequestMessage"
            && typeof payload.templateMessage.profile === "string"
            && typeof payload.templateMessage.host === "string"
            && typeof payload.templateMessage.variables === "string"
            && typeof payload.templateMessage.template === "string") {
          /* HostListResponseMessage */
          this.updateHostList({
            command: payload.command,
            status: payload.status,
            hosts: payload.hosts,
            templateMessage: {
              command: payload.templateMessage.command,
              profile: payload.templateMessage.profile,
              host: payload.templateMessage.host,
              template: payload.templateMessage.template,
              variables: payload.templateMessage.variables,
            },
          });
        } else if (payload.command === "HostVarsResponseMessage"
            && isObject(payload, ["status", "host", "vars", "templateMessage"])
            && typeof payload.host === "string"
            && isStringArray(payload.vars)
            && (payload.status === "successful" || payload.status === "failed" || payload.status === "cache")
            && isObject(payload.templateMessage, ["command", "profile", "host", "variables", "template"])
            && payload.templateMessage.command === "TemplateResultRequestMessage"
            && typeof payload.templateMessage.profile === "string"
            && typeof payload.templateMessage.host === "string"
            && typeof payload.templateMessage.variables === "string"
            && typeof payload.templateMessage.template === "string") {
          /* HostListResponseMessage */
          this.updateHostVars({
            command: payload.command,
            status: payload.status,
            host: payload.host,
            vars: payload.vars,
            templateMessage: {
              command: payload.templateMessage.command,
              profile: payload.templateMessage.profile,
              host: payload.templateMessage.host,
              template: payload.templateMessage.template,
              variables: payload.templateMessage.variables,
            },
          });
        }
      }
    });
  }

  private requestProfilesInfo() {
    this.profileRefresh.startAnimation();
    const payload: ProfileInfoRequestMessage = { command: "ProfileInfoRequestMessage" };
    vscode.postMessage(payload);
  }

  private updateProfileInfos(message: ProfileInfoResponseMessage) {
    this.profileRefresh.stopAnimation();
    this.ansibleProfiles = message.profiles;
    const profileKeys = Object.keys(this.ansibleProfiles);
    const oldValue = this.selProfile.value;
    while (this.selProfile.options.length > 0) {
      this.selProfile.options.remove(0);
    }
    for (const p of profileKeys) {
      this.selProfile.options.add(new Option(p));
    }
    if (profileKeys.includes(oldValue)) {
      this.selProfile.value = oldValue;
    } else if (profileKeys.length > 0) {
      this.selProfile.value = profileKeys[0];
    }
    if (this.selProfile.value !== oldValue) {
      this.selProfile.dispatchEvent(new Event("change"));
    }
  }

  private toggleProfileInfo() {
    if (this.divProfiles.classList.contains("hidden")) {
      this.divProfiles.classList.remove("hidden");
    } else {
      this.divProfiles.classList.add("hidden");
    }
  }

  private updateProfileInfo() {
    const profileKey = this.selProfile.value;
    if (profileKey in this.ansibleProfiles) {
      this.cmrProfile.dispatch({
        changes: { from: 0, to: this.cmrProfile.state.doc.length, insert: this.ansibleProfiles[profileKey] },
      });
    }
  }

  private requestProfileSettings() {
    const payload: ProfileSettingsRequestMessage = { command: "ProfileSettingsRequestMessage" };
    vscode.postMessage(payload);
  }

  private requestHostList() {
    this.hostListRefresh.startAnimation();
    const inpProfile = this.selProfile.value;
    const payload: HostListRequestMessage = { command: "HostListRequestMessage", profile: inpProfile };
    vscode.postMessage(payload);
  }

  private updateHostList(message: HostListResponseMessage) {
    if (message.status !== "cache") {
      this.hostListRefresh.stopAnimation();
    }
    this.hostListRefresh.setRequestMessage(message.templateMessage);
    const oldValue = this.selHost.value;
    while (this.selHost.options.length > 0) {
      this.selHost.options.remove(0);
    }
    for (const h of message.hosts) {
      this.selHost.options.add(new Option(h));
    }
    if (message.status !== "failed") {
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
    const inpProfile = this.selProfile.value;
    const inpHost = this.selHost.value;
    if (inpHost === "") {
      return;
    }
    this.jinjaHostVarsCompletions = [];
    this.hostVarsRefresh.startAnimation();
    const payload: HostVarsRequestMessage = { command: "HostVarsRequestMessage", profile: inpProfile, host: inpHost };
    vscode.postMessage(payload);
  }

  private updateHostVars(message: HostVarsResponseMessage) {
    if (message.host !== this.selHost.value) {
      return;
    }
    if (message.status !== "cache") {
      this.hostVarsRefresh.stopAnimation();
    }
    this.hostVarsRefresh.setRequestMessage(message.templateMessage);
    if (message.status !== "failed") {
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
    this.selProfile.value = message.profile;
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
    const inpProfile = this.selProfile.value;
    const inpHost = this.selHost.value;
    const inpVariables = this.cmrVariables.state.doc.toString();
    const inpTemplate = this.cmrTemplate.state.doc.toString();
    const payload: TemplateResultRequestMessage = { command: "TemplateResultRequestMessage", profile: inpProfile, host: inpHost, variables: inpVariables, template: inpTemplate };
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
    if (result.type === "string") {
      this.spnResultTypeString.classList.remove("inactive");
    } else {
      this.spnResultTypeString.classList.add("inactive");
    }
    if (result.type === "structure") {
      this.spnResultTypeStructure.classList.remove("inactive");
    } else {
      this.spnResultTypeStructure.classList.add("inactive");
    }
    this.cmrRendered.dispatch({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
      effects: this.cfgRenderedLanguage.reconfigure(result.type === "structure" ? jsonLanguage() : []),
    });
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
