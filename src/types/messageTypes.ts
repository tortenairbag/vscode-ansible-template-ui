export type ResponseStatus = "successful" | "failed" | "cache";

export interface TemplateResultRequestMessage {
  command: "TemplateResultRequestMessage";
  profile: string;
  host: string;
  role: string;
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
}

export interface ProfileSettingsRequestMessage {
  command: "ProfileSettingsRequestMessage";
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
