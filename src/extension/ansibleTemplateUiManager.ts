import * as child_process from "child_process";
import * as fs from "fs";
import * as tmp from "tmp";
import * as util from "util";
import * as vscode from "vscode";
import * as yaml from "yaml";
import { ColorThemeKind, ExtensionContext, OutputChannel, Uri, Webview, WebviewPanel, WorkspaceFolder } from "vscode";
import { isObject, isStringArray, parseVariableString } from "../@types/assertions";
import { AnsiblePluginsRequestMessage, AnsiblePluginsResponseMessage, HostListRequestMessage, HostListResponseMessage, HostVarsRequestMessage, HostVarsResponseMessage, PreferenceRequestMessage, PreferenceResponseMessage, ProfileSettingsRequestMessage, RequestMessage, RequestMessageCommands, ResponseMessage, RolesRequestMessage, RolesResponseMessage, TemplateResultRequestMessage, TemplateResultResponseMessage } from "../@types/messageTypes";

const execAsPromise = util.promisify(child_process.execFile);

interface AnswerToken { command: RequestMessageCommands, counter: number }
type PreferenceRoleDetectionMode = "Ansible Galaxy" | "Directory lookup";

interface ExecuteResult {
  successful: boolean
  stderr: string
  stdout: string
}

interface AnsibleProfile {
  args: string[],
  cmdDoc: string,
  cmdGalaxy: string,
  cmdPlaybook: string,
  env: Record<string, string>,
}

interface AnsibleResult {
  plays: {
    play: {
      name: string;
    };
    tasks: {
      hosts: Record<string, {
          failed?: boolean;
          msg: unknown;
        }>;
        task: {
          name: string;
        }
    }[];
  }[];
}

function isAnsibleResult(data: unknown): data is AnsibleResult {
  return (
    isObject(data, ["plays"])
    && Array.isArray(data.plays)
    && data.plays.some(play =>
      isObject(play, ["play", "tasks"])
      && isObject(play.play, ["name"])
      && typeof play.play.name === "string"
      && Array.isArray(play.tasks)
      && play.tasks.some(task =>
        isObject(task, ["hosts", "task"])
        && isObject(task.hosts, [])
        && Object.entries(task.hosts).some(([key, value]) =>
          typeof key === "string"
          && isObject(value, ["msg"])
        )
        && isObject(task.task, ["name"])
        && typeof task.task.name === "string"
      )
    )
  );
}

export class AnsibleTemplateUiManager {
  private static readonly PLAYBOOK_TITLE = "Print Template";
  private static readonly PREF_ANSIBLE_PROFILES = "tortenairbag.ansibleTemplateUi.profiles";
  private static readonly TAGS_WHITELIST = "tag_whitelist_tasks";
  private static readonly TAGS_BLACKLIST = "tag_blacklist_tasks";
  private static readonly TEMPLATE_HOSTLIST = "{{ groups.all | default([]) | sort | unique }}";
  private static readonly TEMPLATE_HOSTVARS = "{{ vars.keys() }}";
  private static readonly VIEW_RESOURCES_DIR = "out";
  private static readonly VIEW_SCHEMA = "tortenairbag.tabSession";
  private static readonly VIEW_TITLE = "Ansible Template UI";

  private hostListCache: Record<string, string[]> = {};
  private hostVarsCache: Record<string, Record<string, string[]>> = {};
  private pluginCache: Record<string, { filters: { name: string, description: string }[], roles: string[] }> = {};
  private rolesCache: Record<string, string[]> = {};
  private channel: OutputChannel | undefined;
  private panel: WebviewPanel | undefined;
  private workspaceUri: Uri | undefined;

  private readonly requestCounter = {
    "TemplateResultRequestMessage": 0,
    "PreferenceRequestMessage": 0,
    "ProfileSettingsRequestMessage": 0,
    "AnsiblePluginsRequestMessage": 0,
    "HostListRequestMessage": 0,
    "HostVarsRequestMessage": 0,
    "RolesRequestMessage": 0,
  };

  private prefAnsibleCollectionImports: string[] = [];
  private prefAnsibleCollectionReferences: string[] = [];
  private prefAnsibleProfilesDefault: Record<string, AnsibleProfile> = {};
  private prefAnsibleProfiles: Record<string, AnsibleProfile> = {};
  private prefAnsibleTimeout = 0;
  private prefTabSize = 2;
  private prefRoleDetectionMode: PreferenceRoleDetectionMode = "Directory lookup";
  private prefOutputRegexSanitizeRules: string[] = [];

  public activate(context: ExtensionContext) {
    const prefKeyAnsibleProfiles = AnsibleTemplateUiManager.PREF_ANSIBLE_PROFILES;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    for (const config of context.extension.packageJSON.contributes.configuration as unknown[]) {
      if (isObject(config, ["properties"]) && isObject(config.properties, [prefKeyAnsibleProfiles]) && isObject(config.properties[prefKeyAnsibleProfiles], ["default"])) {
        this.prefAnsibleProfilesDefault = config.properties[prefKeyAnsibleProfiles].default as Record<string, AnsibleProfile>;
      }
    }

    this.getUserSettings();
    context.subscriptions.concat([
      vscode.commands.registerCommand("tortenairbag.ansibleTemplateUi.open", this.open.bind(this, context)),
      vscode.workspace.onDidChangeConfiguration(this.getUserSettings.bind(this)),
    ]);
  }

  private async open(context: ExtensionContext) {
    if (this.panel !== undefined) {
      this.panel.reveal();
    } else {
      this.workspaceUri = await this.pickWorkspace();
      if (this.workspaceUri === undefined) {
        void vscode.window.showErrorMessage("Unable to open Ansible Template UI: No workspace selected.");
        return;
      }

      this.panel = vscode.window.createWebviewPanel(
        AnsibleTemplateUiManager.VIEW_SCHEMA,
        AnsibleTemplateUiManager.VIEW_TITLE,
        vscode.ViewColumn.Active,
        {
          // Enable JavaScript in the webview
          enableScripts: true,
          // Restrict the webview to only load resources from the `out` directory
          localResourceRoots: [Uri.joinPath(context.extensionUri, AnsibleTemplateUiManager.VIEW_RESOURCES_DIR)],
        }
      );

      this.panel.title = AnsibleTemplateUiManager.VIEW_TITLE;
      this.panel.webview.html = AnsibleTemplateUiManager.getWebviewContent(this.panel.webview, context.extensionUri);

      this.panel.webview.onDidReceiveMessage((payload: unknown) => {
        if (isObject(payload, ["command"]) && typeof payload.command === "string") {
          /* Message */
          if (payload.command === "TemplateResultRequestMessage"
              && isObject(payload, ["profile", "host", "role", "gatherFacts", "template", "variables"])
              && typeof payload.profile === "string"
              && payload.profile in this.prefAnsibleProfiles
              && typeof payload.host === "string"
              && typeof payload.role === "string"
              && typeof payload.gatherFacts === "boolean"
              && typeof payload.template === "string"
              && typeof payload.variables === "string") {
            void this.renderTemplate({ command: payload.command, profile: payload.profile, host: payload.host, role: payload.role, gatherFacts: payload.gatherFacts, variables: payload.variables, template: payload.template });
          } else if (payload.command === "PreferenceRequestMessage") {
            this.lookupProfiles({ command: payload.command });
          } else if (payload.command === "ProfileSettingsRequestMessage") {
            this.openProfileSettings({ command: payload.command });
          } else if (payload.command === "AnsiblePluginsRequestMessage"
              && isObject(payload, ["profile", "cacheOnly"])
              && typeof payload.profile === "string"
              && typeof payload.cacheOnly === "boolean") {
            void this.lookupAnsiblePlugins({ command: payload.command, profile: payload.profile, cacheOnly: payload.cacheOnly });
          } else if (payload.command === "HostListRequestMessage"
              && isObject(payload, ["profile", "cacheOnly"])
              && typeof payload.profile === "string"
              && payload.profile in this.prefAnsibleProfiles
              && typeof payload.cacheOnly === "boolean") {
            void this.lookupInventoryHosts({ command: payload.command, profile: payload.profile, cacheOnly: payload.cacheOnly });
          } else if (payload.command === "HostVarsRequestMessage"
              && isObject(payload, ["profile", "host", "role", "cacheOnly"])
              && typeof payload.profile === "string"
              && payload.profile in this.prefAnsibleProfiles
              && typeof payload.host === "string"
              && typeof payload.role === "string"
              && typeof payload.cacheOnly === "boolean") {
            void this.lookupHostVars({ command: payload.command, profile: payload.profile, host: payload.host, role: payload.role, cacheOnly: payload.cacheOnly });
          } else if (payload.command === "RolesRequestMessage"
              && isObject(payload, ["profile", "cacheOnly"])
              && typeof payload.profile === "string"
              && payload.profile in this.prefAnsibleProfiles
              && typeof payload.cacheOnly === "boolean") {
            void this.lookupRoles({ command: payload.command, profile: payload.profile, cacheOnly: payload.cacheOnly });
          }
        }
      });

      this.panel.onDidDispose(() => { this.panel = undefined; });
    }
  }

  private registerRequest(r: RequestMessage): AnswerToken {
    return { command: r.command, counter: ++this.requestCounter[r.command] };
  }

  private answerRequest(token: AnswerToken, payload: ResponseMessage) {
    if (token.counter === this.requestCounter[token.command]) {
      void this.panel?.webview.postMessage(payload);
    }
  }

  private getUserSettings() {
    const conf = vscode.workspace.getConfiguration();

    this.prefTabSize = conf.get("tortenairbag.ansibleTemplateUi.tabSize", 0);
    if (this.prefTabSize < 1) {
      this.prefTabSize = conf.get("editor.tabSize", 2);
    }

    this.prefAnsibleCollectionImports = conf.get<string[]>("tortenairbag.ansibleTemplateUi.ansibleCollectionImports", []);
    this.prefAnsibleCollectionReferences = conf.get<string[]>("tortenairbag.ansibleTemplateUi.ansibleCollectionReferences", []);
    this.prefAnsibleTimeout = conf.get<number>("tortenairbag.ansibleTemplateUi.ansibleTimeout", 0);
    this.prefOutputRegexSanitizeRules = conf.get<string[]>("tortenairbag.ansibleTemplateUi.outputRegexSanitizeRules", []);
    this.prefRoleDetectionMode = conf.get<PreferenceRoleDetectionMode>("tortenairbag.ansibleTemplateUi.roleDetectionMode", "Directory lookup");

    this.prefAnsibleProfiles = {};
    const profiles = conf.get("tortenairbag.ansibleTemplateUi.profiles");
    let isSuccessful = true;
    if (isObject(profiles, [])) {
      for (const [profileKey, profile] of Object.entries(profiles)) {
        if (isObject(profile, ["args", "cmdDoc", "cmdGalaxy", "cmdPlaybook", "env"])
            && isStringArray(profile.args)
            && typeof profile.cmdDoc === "string"
            && typeof profile.cmdGalaxy === "string"
            && typeof profile.cmdPlaybook === "string"
            && isObject(profile.env, [])) {
          this.prefAnsibleProfiles[profileKey] = { args: profile.args, cmdDoc: profile.cmdDoc, cmdGalaxy: profile.cmdGalaxy, cmdPlaybook: profile.cmdPlaybook, env: profile.env };
        } else {
          isSuccessful = false;
        }
      }
    }
    if (!isSuccessful && Object.keys(this.prefAnsibleProfiles).length < 1) {
      this.prefAnsibleProfiles = this.prefAnsibleProfilesDefault;
    }
    if (!isSuccessful) {
      void vscode.window.showErrorMessage("Malformed configuration about Ansible Profiles, please fix your settings.", "Open settings").then((value) => {
        if (value === "Open settings") {
          this.openProfileSettings({ command: "ProfileSettingsRequestMessage" });
        }
      });
    }
  }

  private lookupProfiles(message: PreferenceRequestMessage) {
    const token = this.registerRequest(message);
    const profiles: Record<string, string> = {};
    for (const [profileKey, profile] of Object.entries(this.prefAnsibleProfiles)) {
      profiles[profileKey] = JSON.stringify(profile, undefined, this.prefTabSize);
    }
    const isLightTheme = [ColorThemeKind.Light, ColorThemeKind.HighContrastLight].includes(vscode.window.activeColorTheme.kind);
    const payload: PreferenceResponseMessage = { command: "PreferenceResponseMessage", profiles: profiles, tabSize: this.prefTabSize, lightTheme: isLightTheme };
    this.answerRequest(token, payload);
  }

  private openProfileSettings(_message: ProfileSettingsRequestMessage) {
    void vscode.commands.executeCommand("workbench.action.openSettings", "@id:tortenairbag.ansibleTemplateUi.profiles");
  }

  private async lookupAnsiblePlugins(message: AnsiblePluginsRequestMessage) {
    const token = this.registerRequest(message);
    if (message.profile in this.pluginCache) {
      const payload: AnsiblePluginsResponseMessage = { command: "AnsiblePluginsResponseMessage", status: "cache", filters: this.pluginCache[message.profile].filters, roles: this.pluginCache[message.profile].roles };
      this.answerRequest(token, payload);
      if (message.cacheOnly) {
        return;
      }
    }

    const profile = this.prefAnsibleProfiles[message.profile];
    const filters: { name: string, description: string }[] = [];
    const roles: string[] = [];
    let isSuccessful = true;

    const results = await Promise.all(
      this.prefAnsibleCollectionImports.flatMap((collection: string) => {
        return [
          this.runAnsibleGalaxy(profile.cmdDoc, profile.env, ["--list", "--json", "--type", "filter", collection]).then(r => { return { type: "filter" as "filter" | "role", collection: collection, result: r }; }),
          this.runAnsibleGalaxy(profile.cmdDoc, profile.env, ["--list", "--json", "--type", "role", collection]).then(r => { return { type: "role" as "filter" | "role", collection: collection, result: r }; }),
        ];
      })
    );

    for (const r of results) {
      if (!r.result.successful) {
        isSuccessful = false;
        break;
      }
      try {
        const shouldAddShortName = this.prefAnsibleCollectionReferences.some(c => r.collection === c);
        const res = JSON.parse(r.result.stdout) as unknown;
        if (isObject(res, [])) {
          Object.entries(res).forEach(([k, v]) => {
            const keys = [k];
            if (shouldAddShortName) {
              keys.push(k.replace(`${r.collection}.`, ""));
            }
            if (r.type === "filter" && typeof v === "string") {
              keys.forEach(k => filters.push({ name: k, description: v }));
            } else if (r.type === "role") {
              keys.forEach(k => roles.push(k));
            }
          });
        }
      } catch { /* swallow */ }
    }

    this.pluginCache[message.profile] = { filters: filters, roles: roles };
    const payload: AnsiblePluginsResponseMessage = { command: "AnsiblePluginsResponseMessage", status: isSuccessful ? "successful" : "failed", filters: filters, roles: roles };
    this.answerRequest(token, payload);
  }

  private async lookupInventoryHosts(message: HostListRequestMessage) {
    const token = this.registerRequest(message);
    const templateMessage: TemplateResultRequestMessage = {
      command: "TemplateResultRequestMessage",
      profile: message.profile,
      host: "localhost",
      role: "",
      gatherFacts: false,
      template: AnsibleTemplateUiManager.TEMPLATE_HOSTLIST,
      variables: "",
    };
    if (message.profile in this.hostListCache && this.hostListCache[message.profile].length > 1) {
      const payload: HostListResponseMessage = { command: "HostListResponseMessage", status: "cache", hosts: this.hostListCache[message.profile], templateMessage: templateMessage };
      this.answerRequest(token, payload);
      if (message.cacheOnly) {
        return;
      }
    }
    const result = await this.runAnsibleDebug(templateMessage);
    const hosts: string[] = [];
    let isSuccessful = false;
    try {
      const stdout = JSON.parse(result.result) as unknown;
      if (isStringArray(stdout)) {
        hosts.push(...stdout);
        isSuccessful = true;
      }
    } catch { /* swallow */ }
    if (!hosts.includes("localhost")) {
      hosts.unshift("localhost");
    }
    this.hostListCache[message.profile] = hosts;
    const payload: HostListResponseMessage = { command: "HostListResponseMessage", status: isSuccessful ? "successful" : "failed", hosts: hosts, templateMessage: templateMessage };
    this.answerRequest(token, payload);
  }

  private async lookupHostVars(message: HostVarsRequestMessage) {
    const token = this.registerRequest(message);
    const templateMessage: TemplateResultRequestMessage = {
      command: "TemplateResultRequestMessage",
      profile: message.profile,
      host: message.host,
      role: message.role,
      gatherFacts: false,
      template: AnsibleTemplateUiManager.TEMPLATE_HOSTVARS,
      variables: "",
    };
    if (message.profile in this.hostVarsCache && message.host in this.hostVarsCache[message.profile]) {
      const payload: HostVarsResponseMessage = {
        command: "HostVarsResponseMessage",
        status: "cache",
        host: message.host,
        role: message.role,
        vars: this.hostVarsCache[message.profile][message.host],
        templateMessage: templateMessage,
      };
      this.answerRequest(token, payload);
      if (message.cacheOnly) {
        return;
      }
    }
    const result = await this.runAnsibleDebug(templateMessage);
    const vars: string[] = [];
    let isSuccessful = false;
    try {
      const stdout = JSON.parse(result.result) as unknown;
      if (isStringArray(stdout)) {
        vars.push(...stdout);
        isSuccessful = true;
      }
    } catch { /* swallow */ }
    if (!(message.profile in this.hostVarsCache)) {
      this.hostVarsCache[message.profile] = {};
    }
    this.hostVarsCache[message.profile][message.host] = vars;
    const payload: HostVarsResponseMessage = {
      command: "HostVarsResponseMessage",
      status: isSuccessful ? "successful" : "failed",
      host: message.host,
      role: message.role,
      vars: vars,
      templateMessage: templateMessage,
    };
    this.answerRequest(token, payload);
  }

  private async lookupRoles(message: RolesRequestMessage) {
    const token = this.registerRequest(message);
    if (message.profile in this.rolesCache) {
      const payload: RolesResponseMessage = { command: "RolesResponseMessage", status: "cache", roles: this.rolesCache[message.profile] };
      this.answerRequest(token, payload);
      if (message.cacheOnly) {
        return;
      }
    }

    const profile = this.prefAnsibleProfiles[message.profile];
    let isSuccessful = false;
    let roles: string[] = [];
    if (this.prefRoleDetectionMode === "Ansible Galaxy") {
      const res = await this.lookupRolesAnsibleGalaxy(profile);
      isSuccessful = res.successful;
      roles = res.roles;
    } else {
      const res = await this.lookupRolesDirectoryLookup(message.profile);
      isSuccessful = res.successful;
      const parsedResult = JSON.parse(res.roles) as unknown;
      if (isStringArray(parsedResult)) {
        roles = parsedResult;
      } else {
        isSuccessful = false;
      }
    }

    roles.sort((a, b) => a.localeCompare(b)).unshift("");
    this.rolesCache[message.profile] = roles;
    const payload: RolesResponseMessage = { command: "RolesResponseMessage", status: isSuccessful ? "successful" : "failed", roles: roles };
    this.answerRequest(token, payload);
  }

  private async lookupRolesAnsibleGalaxy(profile: AnsibleProfile) {
    const args: string[] = ["role", "list"];
    const result = await this.runAnsibleGalaxy(profile.cmdGalaxy, profile.env, args);

    const roles: string[] = [];
    let isSuccessful = false;
    if (result.successful) {
      try {
        const regex = /^- (?<roleName>[\w-]+), .+$/gm;
        for (const r of result.stdout.split("\n")) {
          const res = regex.exec(r);
          // eslint-disable-next-line no-null/no-null
          if (res !== null && isObject(res.groups, ["roleName"]) && typeof res.groups.roleName === "string") {
            roles.push(res.groups.roleName);
          }
          result.stdout = result.stdout.replace(regex, "");
        }
        isSuccessful = true;
      } catch { /* swallow */ }
    }
    return { successful: isSuccessful, roles: roles };
  }

  private async lookupRolesDirectoryLookup(profile: string) {
    const templateMessage: TemplateResultRequestMessage = {
      command: "TemplateResultRequestMessage",
      profile: profile,
      host: "localhost",
      role: "",
      gatherFacts: false,
      template: "",
      variables: "",
    };
    const playbook = [
      {
        name: AnsibleTemplateUiManager.PLAYBOOK_TITLE,
        hosts: templateMessage.host,
        gather_facts: templateMessage.gatherFacts,
        tasks: [
          {
            "ansible.builtin.find": {
              paths: "{{ item }}",
              recurse: false,
              file_type: "directory",
            },
            loop: "{{ lookup('ansible.builtin.config', 'DEFAULT_ROLES_PATH') }}",
            tags: [AnsibleTemplateUiManager.TAGS_WHITELIST],
            register: "_res",
          },
          {
            name: AnsibleTemplateUiManager.PLAYBOOK_TITLE,
            "ansible.builtin.debug": {
              msg: "{{ _res.results | map(attribute='files') | flatten | map(attribute='path') | map('basename') | unique | sort }}",
            },
            tags: [AnsibleTemplateUiManager.TAGS_WHITELIST],
          },
        ],
      },
    ];
    const result = await this.runAnsibleDebug(templateMessage, playbook);
    return { successful: result.successful, roles: result.type === "structure" ? result.result : "[]" };
  }

  private async renderTemplate(message: TemplateResultRequestMessage) {
    const token = this.registerRequest(message);
    const payload = await this.runAnsibleDebug(message);
    this.answerRequest(token, payload);
  }

  private async runAnsibleDebug(templateMessage: TemplateResultRequestMessage, playbookOverride?: Record<string,unknown>[]) {
    const profile = this.prefAnsibleProfiles[templateMessage.profile];
    const host = templateMessage.host;
    const role = templateMessage.role;
    const template = templateMessage.template;
    const variables = templateMessage.variables;
    const playbook = yaml.stringify(playbookOverride ?? [
      {
        name: AnsibleTemplateUiManager.PLAYBOOK_TITLE,
        hosts: host,
        gather_facts: templateMessage.gatherFacts,
        collections: this.prefAnsibleCollectionReferences,
        roles: (role.length < 1) ? [] : [
          {
            role: role,
            tags: [AnsibleTemplateUiManager.TAGS_BLACKLIST],
          },
        ],
        tasks: [
          {
            "ansible.builtin.setup": { },
            when: templateMessage.gatherFacts,
            tags: [AnsibleTemplateUiManager.TAGS_WHITELIST],
          },
          {
            name: AnsibleTemplateUiManager.PLAYBOOK_TITLE,
            "ansible.builtin.debug": {
              msg: template,
            },
            tags: [AnsibleTemplateUiManager.TAGS_WHITELIST],
          },
        ],
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (profile === undefined) {
      const payload: TemplateResultResponseMessage = { command: "TemplateResultResponseMessage", successful: false, type: "unknown", result: "Profile cannot be found.", debug: "" };
      return payload;
    }
    if (variables.trim() !== "" && parseVariableString(variables) === undefined) {
      const payload: TemplateResultResponseMessage = { command: "TemplateResultResponseMessage", successful: false, type: "unknown", result: "Variables are malformed, must be JSON- or yaml-decodable object.", debug: "" };
      return payload;
    }

    const tmpFilePlaybook = tmp.fileSync();
    const tmpFileVariables = tmp.fileSync();

    fs.writeFileSync(tmpFilePlaybook.name, playbook);
    fs.writeFileSync(tmpFileVariables.name, variables);

    const args: string[] = [...profile.args, tmpFilePlaybook.name, "--tags", AnsibleTemplateUiManager.TAGS_WHITELIST, "--skip-tags", `always,${AnsibleTemplateUiManager.TAGS_BLACKLIST}`];
    if (variables.trim() !== "") {
      args.push("--extra-vars", `@${tmpFileVariables.name}`);
    }
    const result = await this.runAnsiblePlaybook(profile.cmdPlaybook, profile.env, args);

    tmpFilePlaybook.removeCallback();
    tmpFileVariables.removeCallback();

    let res = "Unknown error...";
    let isSuccessful = false;
    let stdout: unknown;

    for (const pattern of this.prefOutputRegexSanitizeRules) {
      const regex = new RegExp(pattern, "my");
      result.stdout = result.stdout.replace(regex, "");
    }

    try {
      stdout = JSON.parse(result.stdout) as unknown;
    } catch {
      res = "Unable to parse ansible output...";
    }

    let type: "string" | "structure" | "unknown" = "unknown";
    if (isAnsibleResult(stdout)) {
      const msgs: { failed?: boolean; msg: unknown; }[] = [];
      for (const play of stdout.plays) {
        if (play.play.name !== AnsibleTemplateUiManager.PLAYBOOK_TITLE) {
          continue;
        }
        for (const task of play.tasks) {
          if (task.task.name !== AnsibleTemplateUiManager.PLAYBOOK_TITLE) {
            continue;
          }
          if (host in task.hosts) {
            msgs.push(task.hosts[host]);
          }
        }
      }
      if (msgs.length === 1) {
        if (typeof msgs[0].msg === "string") {
          type = "string";
          res = msgs[0].msg;
        } else {
          type = "structure";
          res = JSON.stringify(msgs[0].msg, undefined, this.prefTabSize);
        }
        isSuccessful = !(msgs[0].failed ?? false);
      }
    } else {
      res = "Unable to interpret ansible result...";
    }

    const payload: TemplateResultResponseMessage = { command: "TemplateResultResponseMessage", successful: isSuccessful, type: type, result: res, debug: yaml.stringify(result) };
    return payload;
  }

  private async runAnsibleGalaxy(command: string, env: NodeJS.ProcessEnv, args: string[]) {
    return this.runCommand(command, env, args);
  }

  private async runAnsiblePlaybook(command: string, env: NodeJS.ProcessEnv, args: string[]) {
    const newEnv = {
      ...env,
      ...{
        ANSIBLE_STDOUT_CALLBACK: "json",
        ANSIBLE_COMMAND_WARNINGS: "0",
        ANSIBLE_RETRY_FILES_ENABLED: "0",
        ANSIBLE_GATHERING: "explicit",
      },
    };
    return this.runCommand(command, newEnv, args);
  }

  private async runCommand(command: string, env: NodeJS.ProcessEnv, args: string[]) {
    const channel = this.getOutputChannel();
    const newEnv = { ...process.env, ...env };
    const pwd = env.PATH ?? this.workspaceUri?.fsPath;
    const result: ExecuteResult = { successful: false, stderr: "Unknown error", stdout: "" };
    try {
      // The "cwd" option for "execAsPromise" does not set the PWD variable
      if (pwd !== undefined) {
        newEnv.PWD = pwd;
      }
      channel.appendLine("### INPUT ###");
      channel.appendLine(JSON.stringify(newEnv));
      channel.appendLine(command);
      channel.appendLine(JSON.stringify(args));
      const { stdout, stderr } = await execAsPromise(command, args, {
        cwd: pwd,
        env: newEnv,
        timeout: this.prefAnsibleTimeout,
      });
      if (stderr.length > 0) {
        channel.appendLine("### STDERR ###");
        channel.appendLine(stderr);
      }
      result.stderr = stderr;
      result.stdout = stdout;
      result.successful = true;
    } catch (err: unknown) {
      channel.appendLine("### EXEC ERROR ###");
      channel.appendLine(yaml.stringify(err));
      if (isObject(err, ["stderr"])) {
        result.stderr = yaml.stringify(err.stderr);
      }
      if (isObject(err, ["stdout"]) && typeof err.stdout === "string") {
        result.stdout = err.stdout;
      }
    }
    return result;
  }

  private async pickWorkspace() {
    const workspaceFolders: readonly WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders;
    let targetWorkspaceFolder: WorkspaceFolder | undefined = undefined;

    if (workspaceFolders === undefined) {
      return undefined;
    } else if (workspaceFolders.length === 1) {
      targetWorkspaceFolder = workspaceFolders[0];
    } else if (workspaceFolders.length > 1) {
      targetWorkspaceFolder = await vscode.window.showWorkspaceFolderPick();
    }

    if (targetWorkspaceFolder === undefined) {
      return undefined;
    }

    return targetWorkspaceFolder.uri;
  }

  private getOutputChannel() {
    if (this.channel === undefined) {
      this.channel = vscode.window.createOutputChannel(AnsibleTemplateUiManager.VIEW_TITLE);
    }
    return this.channel;
  }

  private static getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private static getUri(webview: Webview, extensionUri: Uri, pathList: string[]) {
    return webview.asWebviewUri(Uri.joinPath(extensionUri, ...pathList));
  }

  private static getWebviewContent(webview: Webview, extensionUri: Uri) {
    const scriptUri = this.getUri(webview, extensionUri, [AnsibleTemplateUiManager.VIEW_RESOURCES_DIR, "webview.js"]);
    const styleUri = this.getUri(webview, extensionUri, [AnsibleTemplateUiManager.VIEW_RESOURCES_DIR, "webview.css"]);

    const nonce = this.getNonce();
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; img-src 'self' data:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'nonce-${nonce}';">
          <meta property="csp-nonce" content="${nonce}">
          <link rel="stylesheet" href="${styleUri.toString()}">
          <title>${AnsibleTemplateUiManager.VIEW_TITLE}</title>
        </head>
        <body id="bodyWebview">
          <header>
            <h1>${AnsibleTemplateUiManager.VIEW_TITLE}</h1>
          </header>
          <section id="sectionContent" class="containerVertical">
            <label>Profile</label>
            <div class="containerHorizontal">
              <select id="selProfile" class="containerFill"></select>
              <vscode-button id="btnProfileInfoToggle" appearance="icon">
                <span class="codicon codicon-info" title="Show/Hide profile info"></span>
              </vscode-button>
              <vscode-button id="btnProfileSettings" appearance="icon">
                <span class="codicon codicon-settings" title="Open settings"></span>
              </vscode-button>
              <vscode-button id="btnProfileRefresh" appearance="icon">
                <span class="codicon codicon-refresh" title="Reload profile configuration"></span>
              </vscode-button>
            </div>
            <div id="divProfiles" class="hidden">
              <span id="spnProfile" class="placeholderCodeMirror"></span>
            </div>
            <div id="divPluginLookupFailed" class="containerHorizontal messageBox hidden">
              <span class="codicon codicon-warning"></span>
              <span>Unable to lookup plugin information.<br/>Autocompletion entries for ansible plugins will be missing.</span>
            </div>
            <label>Host</label>
            <div class="containerHorizontal">
              <select id="selHost" class="containerFill"></select>
              <vscode-button id="btnHostListRefresh" appearance="icon">
                <span class="codicon codicon-refresh" title="Reload hosts"></span>
              </vscode-button>
            </div>
            <div id="divHostListFailed" class="containerHorizontal messageBox hidden">
              <span class="codicon codicon-warning"></span>
              <span>Unable to detect any hosts in inventory.<br/><vscode-link id="lnkHostListDebug" href="#">Click here</vscode-link> to replace the current template with the template used to lookup hosts for debugging purposes.</span>
            </div>
            <label>Role</label>
            <div class="containerHorizontal">
              <select id="selRole" class="containerFill"></select>
              <vscode-button id="btnRoleRefresh" appearance="icon">
                <span class="codicon codicon-refresh" title="Reload roles"></span>
              </vscode-button>
            </div>
            <div id="divRoleListFailed" class="containerHorizontal messageBox hidden">
              <span class="codicon codicon-warning"></span>
              <span>Unable to detect any roles in project.</span>
            </div>
            <div class="containerHorizontal">
              <label class="containerFill">Variables</label>
              <vscode-button id="btnHostFacts" appearance="icon">
                <span class="codicon codicon-server-environment" title="Gather host facts"></span>
              </vscode-button>
              <vscode-button id="btnHostVarsRefresh" appearance="icon">
                <span class="codicon codicon-refresh" title="Reload host variables"></span>
              </vscode-button>
            </div>
            <span id="spnVariables" class="placeholderCodeMirror"></span>
            <div id="divHostVarsFailed" class="containerHorizontal messageBox hidden">
              <span class="codicon codicon-warning"></span>
              <span>Unable to detect any variables for selected host.<br/><vscode-link id="lnkHostVarsDebug" href="#">Click here</vscode-link> to replace the current template with the template used to lookup host variables for debugging purposes.</span>
            </div>
            <label>Template</label>
            <span id="spnTemplate" class="placeholderCodeMirror"></span>
            <vscode-button id="btnRender" appearance="primary">Render template</vscode-button>
            <div id="divRenderLoading" class="containerHorizontal messageBox hidden">
              <vscode-progress-ring></vscode-progress-ring>
              <span>Running template render...</span>
            </div>
            <vscode-panels>
              <vscode-panel-tab id="vptOutput">OUTPUT</vscode-panel-tab>
              <vscode-panel-tab id="vptDebug">DEBUG</vscode-panel-tab>
              <vscode-panel-view id="vppOutput">
                <section class="containerVertical">
                  <div id="divFailed" class="errorBox hidden">An error occurred executing the command.</div>
                  <div id="divHostVarsFailed" class="containerHorizontal">
                    <span id="spnRendered" class="placeholderCodeMirror"></span>
                    <div class="containerVertical resultType">
                      <span id="spnResultTypeString" class="codicon codicon-symbol-key inactive" title="Result is a string"></span>
                      <span id="spnResultTypeStructure" class="codicon codicon-symbol-namespace inactive" title="Result is a data structure"></span>
                    </div>
                  </div>
                </section>
              </vscode-panel-view>
              <vscode-panel-view id="vppDebug">
                <section class="containerVertical">
                  <span id="spnDebug" class="placeholderCodeMirror"></span>
                </section>
              </vscode-panel-view>
            </vscode-panels>
          </section>
          <script id="webviewScript" type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>
        </body>
      </html>
    `;
  }
}
