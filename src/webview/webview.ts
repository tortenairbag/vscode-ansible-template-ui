import { Button, Link, provideVSCodeDesignSystem, vsCodeButton, vsCodeLink, vsCodePanels, vsCodePanelTab, vsCodePanelView, vsCodeProgressRing } from "@vscode/webview-ui-toolkit";
import { TemplateResultResponseMessage, TemplateResultRequestMessage, HostListResponseMessage, HostListRequestMessage, HostVarsRequestMessage, HostVarsResponseMessage, PreferenceResponseMessage, PreferenceRequestMessage, ProfileSettingsRequestMessage, RolesRequestMessage, RolesResponseMessage } from "../@types/messageTypes";
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
import { SyntaxNode } from "@lezer/common";
import { Combobox } from "./combobox";
import "@vscode/codicons/dist/codicon.css";
import "./style.css";
import "./combobox.css";

const jinja2Language = new LanguageSupport(StreamLanguage.define(jinja2Mode));
const yamlLanguage = new LanguageSupport(StreamLanguage.define(yamlMode));

interface WebviewState {
  profileValue: string;
  hostnameValue: string;
  roleValue: string;
  variablesGatherFacts: boolean;
  variablesHeight: number;
  variablesValue: string;
  templateHeight: number;
  templateValue: string;
  renderedHeight: number;
  renderedType: "string" | "structure" | "unknown";
  renderedValue: string;
  debugHeight: number;
  debugValue: string;
}

class DOMResizeScroller {
  private readonly domElement: HTMLElement;
  private readonly domBody: HTMLElement;

  private height: number | undefined = undefined;
  private isListening: boolean = false;
  private isResizing: boolean = false;
  private isRunning: boolean = false;
  private isScrolling: boolean = false;
  private shouldScrollUp: boolean = false;
  private unit: number = 0;

  private readonly resizeListenerFunc = this.resizeListener.bind(this);
  private readonly resizeStartDetectionListenerFunc = this.resizeStartDetectionListener.bind(this);
  private readonly resizeStopDetectionListenerFunc = this.resizeStopDetectionListener.bind(this);

  constructor(domElement: HTMLElement, domBody: HTMLElement) {
    this.domElement = domElement;
    this.domBody = domBody;

    this.domElement.addEventListener("mousedown", () => {
      this.height = this.domElement.clientHeight;
      this.isListening = true;
      window.addEventListener("mousemove", this.resizeStartDetectionListenerFunc);
    });

    this.domElement.addEventListener("click", () => {
      this.isListening = false;
    });
  }

  private resizeStartDetectionListener() {
    if (!this.isListening) {
      window.removeEventListener("mousemove", this.resizeStartDetectionListenerFunc);
    }

    if (this.domElement.clientHeight !== this.height) {
      this.isResizing = true;
      window.removeEventListener("mousemove", this.resizeStartDetectionListenerFunc);
      window.addEventListener("mousemove", this.resizeListenerFunc);
      window.addEventListener("mouseup", this.resizeStopDetectionListenerFunc);
      this.domBody.classList.add("resizingElements");
      // Prevent text selection during resize
      this.domBody.style.userSelect = "none";
    }
  }

  private resizeListener(e: MouseEvent) {
    if (!this.isListening) {
      window.removeEventListener("mousemove", this.resizeListenerFunc);
      window.removeEventListener("mouseup", this.resizeStopDetectionListenerFunc);
    }
    if (!this.isResizing) {
      return;
    }
    const windowHeight = window.innerHeight;
    const cursorY = e.clientY;
    const thresholdDown = windowHeight * 0.9;
    const thresholdUp = windowHeight * 0.1;

    if (!this.isScrolling && cursorY >= thresholdDown) {
      this.isScrolling = true;
      this.shouldScrollUp = false;
      void this.startScroll();
    } else if (!this.isScrolling && cursorY <= thresholdUp) {
      this.isScrolling = true;
      this.shouldScrollUp = true;
      void this.startScroll();
    } else if (this.isScrolling && cursorY < thresholdDown && cursorY > thresholdUp) {
      this.isScrolling = false;
      this.stopScroll();
    }
  }

  private resizeStopDetectionListener() {
    if (this.isResizing) {
      this.isResizing = false;
      this.isListening = false;
      this.stopScroll();
      this.domBody.classList.remove("resizingElements");
      // Restore text selection after resizing
      this.domBody.style.userSelect = "auto";
    }
  }

  private async startScroll() {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.unit = Math.round(window.innerHeight * 1.5 / 100);
    while (this.isRunning) {
      window.scrollBy(0, this.unit * (this.shouldScrollUp ? -1 : 1));
      await sleep(25);
    }
  }

  private stopScroll() {
    this.isRunning = false;
  }
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

class Toggle {
  private static readonly TOGGLE_CLASS_CHECKED = "checked";

  private readonly button: Button;

  constructor(button: Button) {
    this.button = button;
    this.addEventListener = this.button.addEventListener.bind(this.button);
    this.addEventListener("click", () => {
      this.setChecked(!this.isChecked());
    });
  }

  public addEventListener;

  public isChecked() {
    return this.button.classList.contains(Toggle.TOGGLE_CLASS_CHECKED);
  }

  public setChecked(state: boolean) {
    if (state) {
      this.button.classList.add(Toggle.TOGGLE_CLASS_CHECKED);
    } else {
      this.button.classList.remove(Toggle.TOGGLE_CLASS_CHECKED);
    }
  }
}

class AnsibleTemplateWebview {
  private readonly btnHostFacts: Toggle;
  private readonly btnRender: Button;
  private readonly btnProfileInfoToggle: Toggle;
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
  private readonly selRole: HTMLSelectElement;
  private readonly spnResultTypeString: HTMLSpanElement;
  private readonly spnResultTypeStructure: HTMLSpanElement;

  private ansibleProfiles: Record<string, string> = {};
  private readonly cfgEditorIndentSize = new Compartment();
  private readonly cfgEditorIndentUnit = new Compartment();
  private readonly cfgRenderedLanguage = new Compartment();
  private readonly cfgVariableLanguage = new Compartment();
  private readonly hostListRefresh: TemplateResultRefreshButton;
  private readonly hostVarsRefresh: TemplateResultRefreshButton;
  private readonly roleRefresh: TemplateResultRefreshButton;
  private readonly profileRefresh: TemplateResultRefreshButton;
  private jinjaCustomVarsCompletions: Completion[] = [];
  private jinjaHostVarsCompletions: Completion[] = [];
  private renderedType: "string" | "structure" | "unknown" = "unknown";

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
    this.selRole = document.getElementById("selRole") as HTMLSelectElement;
    this.spnResultTypeString = document.getElementById("spnResultTypeString") as HTMLSpanElement;
    this.spnResultTypeStructure = document.getElementById("spnResultTypeStructure") as HTMLSpanElement;

    const btnHostFacts = document.getElementById("btnHostFacts") as Button;
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

    new Combobox(this.selHost);
    new Combobox(this.selProfile);
    new Combobox(this.selRole);
    this.btnHostFacts = new Toggle(btnHostFacts);
    this.btnProfileInfoToggle = new Toggle(btnProfileInfoToggle);

    this.hostListRefresh = new TemplateResultRefreshButton("btnHostListRefresh", "divHostListFailed", () => { this.requestHostList(); });
    this.hostVarsRefresh = new TemplateResultRefreshButton("btnHostVarsRefresh", "divHostVarsFailed", () => { this.requestHostVars(); });
    this.profileRefresh = new TemplateResultRefreshButton("btnProfileRefresh", undefined, () => { this.requestPreference(); });
    this.roleRefresh = new TemplateResultRefreshButton("btnRoleRefresh", "divRoleListFailed", () => { this.requestRoles(); });

    this.btnRender.addEventListener("click", () => this.requestTemplateResult());
    this.btnProfileInfoToggle.addEventListener("click", () => this.toggleProfileInfo());
    btnProfileSettings.addEventListener("click", () => this.requestProfileSettings());
    lnkHostListDebug.addEventListener("click", () => this.setRequestTemplate(this.hostListRefresh.getRequestMessage()));
    lnkHostVarsDebug.addEventListener("click", () => this.setRequestTemplate(this.hostVarsRefresh.getRequestMessage()));

    const state = vscode.getState();
    let webviewState: WebviewState = {
      profileValue: "",
      hostnameValue: "",
      roleValue: "",
      variablesGatherFacts: false,
      variablesHeight: -1,
      variablesValue: "",
      templateHeight: -1,
      templateValue: "",
      renderedHeight: -1,
      renderedType: "unknown",
      renderedValue: "",
      debugHeight: -1,
      debugValue: "",
    };
    if (isObject(state, ["profileValue", "hostnameValue", "roleValue", "variablesGatherFacts", "variablesHeight", "variablesValue", "templateHeight", "templateValue", "renderedHeight", "renderedType", "renderedValue", "debugHeight", "debugValue"])
        && typeof state.profileValue === "string"
        && typeof state.hostnameValue === "string"
        && typeof state.roleValue === "string"
        && typeof state.variablesGatherFacts === "boolean"
        && typeof state.variablesHeight === "number"
        && typeof state.variablesValue === "string"
        && typeof state.templateHeight === "number"
        && typeof state.templateValue === "string"
        && typeof state.renderedHeight === "number"
        && (state.renderedType === "string" || state.renderedType === "structure" || state.renderedType === "unknown")
        && typeof state.renderedValue === "string"
        && typeof state.debugHeight === "number"
        && typeof state.debugValue === "string") {
      /* WebviewState */
      webviewState = {
        profileValue: state.profileValue,
        hostnameValue: state.hostnameValue,
        roleValue: state.roleValue,
        variablesGatherFacts: state.variablesGatherFacts,
        variablesHeight: state.variablesHeight,
        variablesValue: state.variablesValue,
        templateHeight: state.templateHeight,
        templateValue: state.templateValue,
        renderedHeight: state.renderedHeight,
        renderedType: state.renderedType,
        renderedValue: state.renderedValue,
        debugHeight: state.debugHeight,
        debugValue: state.debugValue,
      };
    }

    const defaultIndentSize = 2;
    const baseKeymap = [...defaultKeymap, ...historyKeymap, indentWithTab ];
    const baseExtensions = [
      history(),
      oneDark,
      syntaxHighlighting(oneDarkHighlightStyle),
      this.cfgEditorIndentUnit.of(indentUnit.of(Array(defaultIndentSize + 1).join(" "))),
      this.cfgEditorIndentSize.of(EditorState.tabSize.of(defaultIndentSize)),
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
      doc: webviewState.variablesValue,
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
      doc: webviewState.templateValue,
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
      doc: webviewState.renderedValue,
      extensions: [
        ...baseExtensions,
        keymap.of([...baseKeymap, ...searchKeymap]),
        EditorState.readOnly.of(true),
        this.cfgRenderedLanguage.of([]),
        highlightSelectionMatches(),
      ],
    });
    spnRendered.parentElement?.insertBefore(this.cmrRendered.dom, spnRendered);
    this.updateTemplateTypeIndicator(webviewState.renderedType);

    this.cmrDebug = new EditorView({
      doc: webviewState.debugValue,
      extensions: [
        ...baseExtensions,
        keymap.of([...baseKeymap, ...searchKeymap]),
        EditorState.readOnly.of(true),
        highlightSelectionMatches(),
      ],
    });
    spnDebug.parentElement?.insertBefore(this.cmrDebug.dom, spnDebug);

    if (webviewState.profileValue !== "") {
      this.selProfile.options.add(new Option(webviewState.profileValue));
      this.selProfile.value = webviewState.profileValue;
    }
    this.selProfile.addEventListener("change", () => { this.updateState(); this.updateProfileInfo(); this.requestHostList(); this.requestRoles(); });

    const sectionContent = document.getElementById("sectionContent") as HTMLElement;
    const resizeInfo = [
      { cmr: this.cmrVariables, height: webviewState.variablesHeight },
      { cmr: this.cmrTemplate, height: webviewState.templateHeight },
      { cmr: this.cmrRendered, height: webviewState.renderedHeight },
      { cmr: this.cmrDebug, height: webviewState.debugHeight },
    ];
    resizeInfo.forEach((info) => {
      if (info.height > 0) {
        info.cmr.dom.style.height = info.height + "px";
      }
      info.cmr.dom.addEventListener("resize", () => { this.updateState(); });
      new DOMResizeScroller(info.cmr.dom, sectionContent);
    });

    if (webviewState.hostnameValue !== "") {
      this.selHost.options.add(new Option(webviewState.hostnameValue));
      this.selHost.value = webviewState.hostnameValue;
      this.selHost.dispatchEvent(new Event("change"));
    }
    this.selHost.addEventListener("change", () => { this.updateState(); this.requestHostVars(); });

    if (webviewState.roleValue !== "") {
      this.selRole.options.add(new Option(webviewState.roleValue));
      this.selRole.value = webviewState.roleValue;
      this.selRole.dispatchEvent(new Event("change"));
    }
    this.selRole.addEventListener("change", () => { this.updateState(); this.requestHostVars(); });

    this.btnHostFacts.setChecked(webviewState.variablesGatherFacts);
    this.btnHostFacts.addEventListener("change", () => { this.updateState(); });

    this.requestPreference();
    if (this.selProfile.value !== "") {
      this.requestHostList();
      this.requestRoles();
      if (this.selHost.value !== "") {
        this.requestHostVars();
      }
    }
  }

  private jinja2Completions(context: CompletionContext): CompletionResult | null {
    const languageHint = context.state.facet(language)?.name;
    const nodeBefore = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (languageHint === "jinja2" && nodeBefore.name === "variableName"
        || languageHint === "jinja2" && nodeBefore.name === "keyword"
        || languageHint === "json" && nodeBefore.name === "String"
        || languageHint === "yaml" && nodeBefore.name === "string") {
      const word = context.matchBefore(/\w*/);
      let prevSibling: SyntaxNode | null = nodeBefore;
      let text = "";
      let preWord = "";
      // eslint-disable-next-line no-null/no-null
      while (prevSibling !== null) {
        preWord = context.state.sliceDoc(prevSibling.from, prevSibling.to);
        text = preWord + text;
        // eslint-disable-next-line no-null/no-null
        if (prevSibling?.name !== "variableName" || text.match(/^[ \t\n\r]*\w*$/) === null) {
          break;
        }
        prevSibling = prevSibling.prevSibling;
      }
      preWord = preWord.trim();

      const options = [];
      if (preWord.startsWith("{{") === true || preWord === "(" || preWord === "," || preWord === "[" || preWord === "=" || prevSibling?.name === "keyword" && ["if", "elif", "in"].includes(preWord) && word?.text !== preWord) {
        /* expression / function parameter / attribute name / assignment / after keyword */
        options.push(...this.jinjaCustomVarsCompletions);
        options.push(...this.jinjaHostVarsCompletions);
      } else if (preWord.startsWith("{%") === true) {
        /* statement */
        options.push(...jinjaControlCompletions);
      } else if (preWord === ".") {
        /* object property - no completion available */
      } else if (preWord === "|") {
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
        profileValue: this.selProfile.value,
        hostnameValue: this.selHost.value,
        roleValue: this.selRole.value,
        variablesGatherFacts: this.btnHostFacts.isChecked(),
        variablesHeight: this.cmrVariables.dom.clientHeight,
        variablesValue: this.cmrVariables.state.doc.toString(),
        templateHeight: this.cmrTemplate.dom.clientHeight,
        templateValue: this.cmrTemplate.state.doc.toString(),
        renderedHeight: this.cmrRendered.dom.clientHeight,
        renderedType: this.renderedType,
        renderedValue: this.cmrRendered.state.doc.toString(),
        debugHeight: this.cmrDebug.dom.clientHeight,
        debugValue: this.cmrDebug.state.doc.toString(),

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
        } else if (payload.command === "PreferenceResponseMessage"
            && isObject(payload, ["profiles", "tabSize"])
            && isObject(payload.profiles, [])
            && typeof payload.tabSize === "number") {
          /* PreferenceResponseMessage */
          this.updatePreference({
            command: payload.command,
            profiles: payload.profiles,
            tabSize: payload.tabSize,
          });
        } else if (payload.command === "HostListResponseMessage"
            && isObject(payload, ["status", "hosts", "templateMessage"])
            && isStringArray(payload.hosts)
            && (payload.status === "successful" || payload.status === "failed" || payload.status === "cache")
            && isObject(payload.templateMessage, ["command", "profile", "host", "role", "gatherFacts", "variables", "template"])
            && payload.templateMessage.command === "TemplateResultRequestMessage"
            && typeof payload.templateMessage.profile === "string"
            && typeof payload.templateMessage.host === "string"
            && typeof payload.templateMessage.role === "string"
            && typeof payload.templateMessage.gatherFacts === "boolean"
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
              role: payload.templateMessage.role,
              gatherFacts: payload.templateMessage.gatherFacts,
              template: payload.templateMessage.template,
              variables: payload.templateMessage.variables,
            },
          });
        } else if (payload.command === "HostVarsResponseMessage"
            && isObject(payload, ["status", "host", "role", "vars", "templateMessage"])
            && typeof payload.host === "string"
            && typeof payload.role === "string"
            && isStringArray(payload.vars)
            && (payload.status === "successful" || payload.status === "failed" || payload.status === "cache")
            && isObject(payload.templateMessage, ["command", "profile", "host", "role", "gatherFacts", "variables", "template"])
            && payload.templateMessage.command === "TemplateResultRequestMessage"
            && typeof payload.templateMessage.profile === "string"
            && typeof payload.templateMessage.host === "string"
            && typeof payload.templateMessage.role === "string"
            && typeof payload.templateMessage.gatherFacts === "boolean"
            && typeof payload.templateMessage.variables === "string"
            && typeof payload.templateMessage.template === "string") {
          /* HostVarsResponseMessage */
          this.updateHostVars({
            command: payload.command,
            status: payload.status,
            host: payload.host,
            role: payload.role,
            vars: payload.vars,
            templateMessage: {
              command: payload.templateMessage.command,
              profile: payload.templateMessage.profile,
              host: payload.templateMessage.host,
              role: payload.templateMessage.role,
              gatherFacts: payload.templateMessage.gatherFacts,
              variables: payload.templateMessage.variables,
              template: payload.templateMessage.template,
            },
          });
        } else if (payload.command === "RolesResponseMessage"
            && isObject(payload, ["status", "roles"])
            && isStringArray(payload.roles)
            && (payload.status === "successful" || payload.status === "failed" || payload.status === "cache")) {
          /* RolesResponseMessage */
          this.updateRoles({
            command: payload.command,
            status: payload.status,
            roles: payload.roles,
          });
        }
      }
    });
  }

  private requestPreference() {
    this.profileRefresh.startAnimation();
    const payload: PreferenceRequestMessage = { command: "PreferenceRequestMessage" };
    vscode.postMessage(payload);
  }

  private updatePreference(message: PreferenceResponseMessage) {
    this.profileRefresh.stopAnimation();
    this.ansibleProfiles = message.profiles;
    const profileKeys = Object.keys(this.ansibleProfiles);
    this.updateSelectOptions(this.selProfile, profileKeys);

    [this.cmrVariables, this.cmrTemplate].forEach((editor: EditorView) => {
      editor.dispatch({
        effects: [
          this.cfgEditorIndentUnit.reconfigure(indentUnit.of(Array(message.tabSize + 1).join(" "))),
          this.cfgEditorIndentSize.reconfigure(EditorState.tabSize.of(message.tabSize)),
        ],
      });
    });
  }

  private toggleProfileInfo() {
    if (this.btnProfileInfoToggle.isChecked()) {
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
    this.updateSelectOptions(this.selHost, message.hosts);
    if (message.status !== "failed") {
      this.hostListRefresh.hideError();
      this.selHost.disabled = false;
    } else {
      this.hostListRefresh.showError();
      this.selHost.disabled = true;
    }
  }

  private requestHostVars() {
    const inpProfile = this.selProfile.value;
    const inpHost = this.selHost.value;
    if (inpProfile === "" || inpHost === "") {
      return;
    }
    this.jinjaHostVarsCompletions = [];
    this.hostVarsRefresh.startAnimation();
    const payload: HostVarsRequestMessage = { command: "HostVarsRequestMessage", profile: inpProfile, host: inpHost, role: this.selRole.value };
    vscode.postMessage(payload);
  }

  private updateHostVars(message: HostVarsResponseMessage) {
    if (message.host !== this.selHost.value || message.role !== this.selRole.value) {
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

  private requestRoles() {
    const inpProfile = this.selProfile.value;
    if (inpProfile === "") {
      return;
    }
    this.roleRefresh.startAnimation();
    const payload: RolesRequestMessage = { command: "RolesRequestMessage", profile: inpProfile };
    vscode.postMessage(payload);
  }

  private updateRoles(message: RolesResponseMessage) {
    if (message.status !== "cache") {
      this.roleRefresh.stopAnimation();
    }
    this.updateSelectOptions(this.selRole, message.roles);
    if (message.status !== "failed") {
      this.roleRefresh.hideError();
      this.selRole.disabled = false;
    } else {
      this.roleRefresh.showError();
      this.selRole.disabled = true;
    }
  }

  private updateSelectOptions(element: HTMLSelectElement, options: string[]) {
    const oldValue = element.value;
    while (element.options.length > 0) {
      element.options.remove(0);
    }
    for (const o of options) {
      element.options.add(new Option(o));
    }
    if (options.includes(oldValue)) {
      element.value = oldValue;
    } else if(options.length > 0) {
      element.value = options[0];
    }
    if (element.value !== oldValue) {
      element.dispatchEvent(new Event("change"));
    }
  }

  private setRequestTemplate(message: TemplateResultRequestMessage | undefined) {
    if (message === undefined) {
      return;
    }
    const optHost = this.selHost.namedItem(message.host);
    this.selProfile.value = message.profile;
    // eslint-disable-next-line no-null/no-null
    if (optHost !== null) {
      optHost.selected = true;
    }
    this.btnHostFacts.setChecked(message.gatherFacts);
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
    const payload: TemplateResultRequestMessage = {
      command: "TemplateResultRequestMessage",
      profile: this.selProfile.value,
      host: this.selHost.value,
      role: this.selRole.value,
      gatherFacts: this.btnHostFacts.isChecked(),
      variables: this.cmrVariables.state.doc.toString(),
      template: this.cmrTemplate.state.doc.toString(),
    };
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
    // Auto-resize to match content if possible, add 2px from border
    this.cmrRendered.dom.style.height = Math.ceil(this.cmrRendered.contentHeight + 2) + "px";
    this.cmrDebug.dom.style.height = Math.ceil(this.cmrDebug.contentHeight + 2) + "px";
    if (result.successful) {
      this.divRenderedError.classList.add("hidden");
    } else {
      this.divRenderedError.classList.remove("hidden");
    }
    this.renderedType = result.type;
    this.updateTemplateTypeIndicator(result.type);
    this.cmrRendered.dispatch({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call
      effects: this.cfgRenderedLanguage.reconfigure(result.type === "structure" ? jsonLanguage() : []),
    });
    this.updateState();
  }

  private updateTemplateTypeIndicator(renderedType: "string" | "structure" | "unknown") {
    if (renderedType === "string") {
      this.spnResultTypeString.classList.remove("inactive");
    } else {
      this.spnResultTypeString.classList.add("inactive");
    }
    if (renderedType === "structure") {
      this.spnResultTypeStructure.classList.remove("inactive");
    } else {
      this.spnResultTypeStructure.classList.add("inactive");
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
