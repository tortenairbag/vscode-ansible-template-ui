export interface RequestTemplateResultMessage {
  command: "requestTemplateResult";
  variables: string;
  template: string;
}

export interface PrintTemplateResultMessage {
  command: "printTemplateResult";
  successful: boolean;
  result: string;
  debug: string;
}
