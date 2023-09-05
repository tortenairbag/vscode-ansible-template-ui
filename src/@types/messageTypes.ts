export type ResponseStatus = "successful" | "failed" | "cache";

export interface TemplateResultRequestMessage {
  command: "TemplateResultRequestMessage";
  profile: string;
  host: string;
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

export interface ProfileInfoRequestMessage {
  command: "ProfileInfoRequestMessage";
}

export interface ProfileInfoResponseMessage {
  command: "ProfileInfoResponseMessage";
  profiles: Record<string, string>;
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
}

export interface HostVarsResponseMessage {
  command: "HostVarsResponseMessage";
  status: ResponseStatus;
  host: string;
  vars: string[];
  templateMessage: TemplateResultRequestMessage;
}
