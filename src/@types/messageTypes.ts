export type ResponseStatus = "successful" | "failed" | "cache";

export type RequestMessageCommands
  = "TemplateResultRequestMessage"
  | "PreferenceRequestMessage"
  | "ProfileSettingsRequestMessage"
  | "HostListRequestMessage"
  | "HostVarsRequestMessage"
  | "RolesRequestMessage";

export interface RequestMessage {
  command: RequestMessageCommands;
}

export interface ResponseMessage { }

export interface TemplateResultRequestMessage extends RequestMessage {
  command: "TemplateResultRequestMessage";
  profile: string;
  host: string;
  role: string;
  gatherFacts: boolean;
  variables: string;
  template: string;
}

export interface TemplateResultResponseMessage extends ResponseMessage {
  command: "TemplateResultResponseMessage";
  successful: boolean;
  type: "string" | "structure" | "unknown";
  result: string;
  debug: string;
}

export interface PreferenceRequestMessage extends RequestMessage {
  command: "PreferenceRequestMessage";
}

export interface PreferenceResponseMessage extends ResponseMessage {
  command: "PreferenceResponseMessage";
  profiles: Record<string, string>;
  tabSize: number;
}

export interface ProfileSettingsRequestMessage extends RequestMessage {
  command: "ProfileSettingsRequestMessage";
}

export interface HostListRequestMessage extends RequestMessage {
  command: "HostListRequestMessage";
  profile: string;
}

export interface HostListResponseMessage extends ResponseMessage {
  command: "HostListResponseMessage";
  status: ResponseStatus;
  hosts: string[];
  templateMessage: TemplateResultRequestMessage;
}

export interface HostVarsRequestMessage extends RequestMessage {
  command: "HostVarsRequestMessage";
  profile: string;
  host: string;
  role: string;
}

export interface HostVarsResponseMessage extends ResponseMessage {
  command: "HostVarsResponseMessage";
  status: ResponseStatus;
  host: string;
  role: string;
  vars: string[];
  templateMessage: TemplateResultRequestMessage;
}

export interface RolesRequestMessage extends RequestMessage {
  command: "RolesRequestMessage";
  profile: string;
}

export interface RolesResponseMessage extends ResponseMessage {
  command: "RolesResponseMessage";
  status: ResponseStatus;
  roles: string[];
}
