export interface RequestTemplateResultMessage {
  command: "requestTemplateResult";
  variables: string;
  template: string;
}

export interface PrintTemplateResultMessage {
  command: "printTemplateResult";
  result: string;
  debug: string;
}
