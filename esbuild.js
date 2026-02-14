const { build } = require("esbuild");

//@ts-check
/** @typedef {import('esbuild').BuildOptions} BuildOptions **/

const args = process.argv.slice(2);

/** @type BuildOptions */
const baseConfig = {
  bundle: true,
  minify: args.includes("--minify"),
  sourcemap: args.includes("--sourcemap"),
};

// Config for extension source code (to be run in a Node-based context)
/** @type BuildOptions */
const extensionConfig = {
  ...baseConfig,
  target: "es2022",
  platform: "node",
  mainFields: ["module", "main"],
  format: "cjs",
  entryPoints: ["./bin/extension/extension.js"],
  outfile: "./out/extension.js",
  external: ["vscode"],
};

// Config for webview source code (to be run in a web-based context)
/** @type BuildOptions */
const webviewConfig = {
  ...baseConfig,
  target: "es2022",
  format: "esm",
  entryPoints: ["./bin/webview/webview.js"],
  outfile: "./out/webview.js",
  loader: {
    ".ttf": "file", /* Use "dataurl" for inline css */
  },
};

// Bundle codicon.css in its own file, it must be explicitly included via <link> tag.
//   See https://vscode-elements.github.io/components/icon/
/** @type BuildOptions */
const codiconConfig = {
  ...baseConfig,
  entryPoints: ["./node_modules/@vscode/codicons/dist/codicon.css"],
  outfile: "./out/codicon.css",
  loader: {
    ".ttf": "file", /* Use "dataurl" for inline css */
  },
};

// This watch config adheres to the conventions of the esbuild-problem-matchers
// extension (https://github.com/connor4312/esbuild-problem-matchers#esbuild-via-js)
/** @type BuildOptions */
const watchConfig = {
  watch: {
    onRebuild(error, result) {
      console.log("[watch] build started");
      if (error) {
        error.errors.forEach((error) =>
          console.error(
            `> ${error.location.file}:${error.location.line}:${error.location.column}: error: ${error.text}`
          )
        );
      } else {
        console.log("[watch] build finished");
      }
    },
  },
};

// Build script
(async () => {
  const args = process.argv.slice(2);
  try {
    if (args.includes("--watch")) {
      // Build and watch extension and webview code
      console.log("[watch] build started");
      await build({
        ...extensionConfig,
        ...watchConfig,
        ...codiconConfig,
      });
      await build({
        ...webviewConfig,
        ...watchConfig,
        ...codiconConfig,
      });
      console.log("[watch] build finished");
    } else {
      // Build extension and webview code
      await build(extensionConfig);
      await build(webviewConfig);
      await build(codiconConfig);
      console.log("build complete");
    }
  } catch (err) {
    process.stderr.write(err.stderr);
    process.exit(1);
  }
})();
