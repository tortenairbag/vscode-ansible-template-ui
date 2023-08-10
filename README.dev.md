# Developer guide

## Workspace setup

### Install Dependencies

* `yay -S npm yarn`
* `npm install`

### Debug

* Press `F5` to open a new window with your extension loaded.
* You can also reload (`Ctrl+R` or `Cmd+R` on Mac) the VS Code window with your extension to load your changes.

### Dependencies

* Check for updates with `npm outdated`
* Update packages to latest minor/patch version with `npm update`
* Update packages to latest major version with `ncu -u` (Look out for `@types/node`, version should be aligned to NodeJS version)
* On VS Code engine upgrade:
  * Check VS Code + NodeJS version used by it.
  * Update files in folder `src/@types` based on the VS Code version.
  * Update TypeScript configuration based on NodeJS version (see https://github.com/microsoft/TypeScript/wiki/Node-Target-Mapping)

### Compile

* VS Code
* `Tasks: Run Task`
* `npm: bundle`

## ToDos

- Minify HTML in TS/JS strings
- Fix debugger
- Add option to sanitize ansible output if any hook scripts are printing some output
- Implement proper code inputs
- Implement ansible inventory integration to run against hosts
- Improve styling/render display
- Add spinner/progress bar if render request was sent
- Limit only one render at a time
- Cancel running render operation
- Set render timeout
- Implement debugging flag in WebView to enable output to channel
- Fix /dev/stdin and could not resolve file errors on failed parsed error messages

## Sources

- https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/notepad
- https://github.com/esbuild/community-plugins
- https://github.com/ansible/vscode-ansible/blob/main/src/features/ansibleTox/runner.ts
- https://github.com/WebCoder49/code-input
- https://github.com/activeguild/esbuild-plugin-prismjs
- https://github.com/MaxMilton/esbuild-minify-templates
- https://github.com/asnaeb/esbuild-css-modules-plugin
