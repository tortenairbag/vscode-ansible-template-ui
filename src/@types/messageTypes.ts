export type ResponseStatus = "successful" | "failed" | "cache";
export type RequestMessageCommands = RequestMessage["command"];
export type RequestMessage
  = TemplateResultRequestMessage
  | PreferenceRequestMessage
  | ProfileSettingsRequestMessage
  | AnsiblePluginsRequestMessage
  | HostListRequestMessage
  | HostVarsRequestMessage
  | RolesRequestMessage;
export type ResponseMessage
  = TemplateResultResponseMessage
  | PreferenceResponseMessage
  | AnsiblePluginsResponseMessage
  | HostListResponseMessage
  | HostVarsResponseMessage
  | RolesResponseMessage;

export interface TemplateResultRequestMessage {
  command: "TemplateResultRequestMessage";
  profile: string;
  host: string;
  role: string;
  gatherFacts: boolean;
  variables: string;
  template: string;
}

export interface TemplateResultResponseMessage {
  command: "TemplateResultResponseMessage";
  successful: boolean;
  type: "string" | "structure" | "unknown";
  result: string;
  debug: string;
}

export interface PreferenceRequestMessage {
  command: "PreferenceRequestMessage";
}

export interface PreferenceResponseMessage {
  command: "PreferenceResponseMessage";
  profiles: Record<string, string>;
  tabSize: number;
  lightTheme: boolean;
}

export interface ProfileSettingsRequestMessage {
  command: "ProfileSettingsRequestMessage";
}

export interface AnsiblePluginsRequestMessage {
  command: "AnsiblePluginsRequestMessage";
  profile: string;
}

export interface AnsiblePluginsResponseMessage {
  command: "AnsiblePluginsResponseMessage";
  status: ResponseStatus;
  filters: { name: string, description: string }[];
  roles: string[];
}

export interface HostListRequestMessage {
  command: "HostListRequestMessage";
  profile: string;
}

export interface HostListResponseMessage {
  command: "HostListResponseMessage";
  status: ResponseStatus;
  hosts: string[];
  templateMessage: TemplateResultRequestMessage;
}

export interface HostVarsRequestMessage {
  command: "HostVarsRequestMessage";
  profile: string;
  host: string;
  role: string;
}

export interface HostVarsResponseMessage {
  command: "HostVarsResponseMessage";
  status: ResponseStatus;
  host: string;
  role: string;
  vars: string[];
  templateMessage: TemplateResultRequestMessage;
}

export interface RolesRequestMessage {
  command: "RolesRequestMessage";
  profile: string;
}

export interface RolesResponseMessage {
  command: "RolesResponseMessage";
  status: ResponseStatus;
  roles: string[];
}
