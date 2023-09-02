export type ResponseStatus = "successful" | "failed" | "cache";

export interface TemplateResultRequestMessage {
  command: "TemplateResultRequestMessage";
  host: string;
  variables: string;
  template: string;
}

export interface TemplateResultResponseMessage {
  command: "TemplateResultResponseMessage";
  successful: boolean;
  result: string;
  debug: string;
}

export interface HostListRequestMessage {
  command: "HostListRequestMessage";
}

export interface HostListResponseMessage {
  command: "HostListResponseMessage";
  status: ResponseStatus;
  hosts: string[];
  templateMessage: TemplateResultRequestMessage;
}

export interface HostVarsRequestMessage {
  command: "HostVarsRequestMessage";
  host: string;
}

export interface HostVarsResponseMessage {
  command: "HostVarsResponseMessage";
  status: ResponseStatus;
  host: string;
  vars: string[];
  templateMessage: TemplateResultRequestMessage;
}
