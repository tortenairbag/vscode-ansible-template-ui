# vscode-ansible-template-ui

VSCode extension to test and render Ansible templates.

Inspired by https://github.com/sivel/ansible-template-ui

## Requirements

Ansible must be installed, this extension uses the `ansible` command, running on the root folder of the opened workspace.

## Features

- Define variables and render templates

## Settings

### `tortenairbag.ansibleTemplateUi.ansibleTimeout`

Timeout for ansible commands in ms.

### `tortenairbag.ansibleTemplateUi.outputRegexSanitizeRules`

Array of regex rules that removes parts of the ansible output when matched at the start.

Useful to remove any Warnings and other outputs if the `ansible-playbook` command prints out some custom output during initialization, like custom inventory plugins.

### `tortenairbag.ansibleTemplateUi.profiles`

Set of profiles to override or target different inventories, ansible versions, etc.

```json
{
  "tortenairbag.ansibleTemplateUi.profiles": {
    /* Name of profile */
    "Default": {
      /* Key-value pairs of environment variables */
      "env": {},
      /* Path to ansible-playbook executable */
      "cmd": "ansible-playbook",
      /* Arguments passed to ansible-playbook command */
      "args": []
    },
    /* EXAMPLES */
    "Example 1: Use non-default executable path for ansible-playbook": {
      "env": {},
      "cmd": "/opt/ansible-2.15.3/bin/ansible-playbook",
      "args": []
    },
    "Example 2: Use non-default inventory": {
      "env": {
        "ANSIBLE_INVENTORY_ENABLED": "aws_ec2"
      },
      "cmd": "ansible-playbook",
      "args": ["-i", "aws_ec2.yml"]
    }
  }
}
```

### `tortenairbag.ansibleTemplateUi.tabSize`

The number of spaces a tab is equal to, default 2 spaces. Set 0 to use global settings.
