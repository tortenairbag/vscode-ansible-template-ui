# vscode-ansible-template-ui

VSCode extension for testing Ansible templates.

Inspired by [ansible-template-ui](https://github.com/sivel/ansible-template-ui)

![Webview](https://raw.githubusercontent.com/tortenairbag/vscode-ansible-template-ui/v1.2.1/resources/webview.png)

## Requirements

Ansible must be installed, this extension uses the commands `ansible-doc`, `ansible-galaxy` and `ansible-playbook`.

Only works inside a workspace folder, any ansible processes are started with the workspace root folder as path.

## Features

- Define multiple profiles to customize environment variables, path to ansible executables and additional arguments for `ansible-playbook`
- Run for any hosts in inventory and use any variables and facts of that hosts
- Select a role to include any role-scoped variables
- Syntax highlighting and autocompletion for template
- Define custom variables

## Settings

### `tortenairbag.ansibleTemplateUi.ansibleCollectionImports`

Collections to include for role and plugin lookups, default to any ansible-core collections like `ansible.builtin`, `ansible.posix`, `ansible.windows`, etc

### `tortenairbag.ansibleTemplateUi.ansibleCollectionReferences`

Creates an ordered "search path" for non-namespaced plugin and role references.
Auto completion will suggest the short plugin name for any plugins and roles in scope.
Behaves like the [collections keyword](https://docs.ansible.com/ansible/latest/collections_guide/collections_using_playbooks.html#simplifying-module-names-with-the-collections-keyword).

### `tortenairbag.ansibleTemplateUi.ansibleTimeout`

Timeout for ansible commands in ms.

### `tortenairbag.ansibleTemplateUi.outputRegexSanitizeRules`

List of regex rules that removes parts of the ansible output when matched at the start.

Useful to remove any Warnings and other outputs if the `ansible-playbook` command prints out some custom output during initialization, like custom inventory plugins.

### `tortenairbag.ansibleTemplateUi.profiles`

Set of profiles to target different inventories, ansible versions, etc.

```jsonc
{
  "tortenairbag.ansibleTemplateUi.profiles": {
    /* Name of profile */
    "Default": {
      /* Key-value pairs of environment variables */
      "env": {},
      /* Path to ansible executables */
      "cmdDoc": "ansible-doc",
      "cmdGalaxy": "ansible-galaxy",
      "cmdPlaybook": "ansible-playbook",
      /* Arguments passed to ansible-playbook command */
      "args": []
    },
    /* EXAMPLES */
    "Example 1: Use non-default executable path for ansible-playbook": {
      "env": {},
      "cmdDoc": "/opt/ansible-2.15.3/bin/ansible-doc",
      "cmdGalaxy": "/opt/ansible-2.15.3/bin/ansible-galaxy",
      "cmdPlaybook": "/opt/ansible-2.15.3/bin/ansible-playbook",
      "args": []
    },
    "Example 2: Use non-default inventory": {
      "env": {
        "ANSIBLE_INVENTORY_ENABLED": "aws_ec2"
      },
      "cmdDoc": "ansible-doc",
      "cmdGalaxy": "ansible-galaxy",
      "cmdPlaybook": "ansible-playbook",
      "args": ["-i", "aws_ec2.yml"]
    }
  }
}
```

### `tortenairbag.ansibleTemplateUi.tabSize`

The number of spaces a tab is equal to, default 2 spaces. Set 0 to use VS Code global settings.
