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
  successful: boolean;
  hosts: string[];
  templateMessage: TemplateResultRequestMessage;
}
