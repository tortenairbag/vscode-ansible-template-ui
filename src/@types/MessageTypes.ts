export interface RequestTemplateResultMessage {
  command: "requestTemplateResult";
  variables: string;
  template: string;
};

export type PrintTemplateResultMessage = {
  command: "printTemplateResult";
  result: string;
};
