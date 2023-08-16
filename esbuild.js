const { build } = require("esbuild");
const { copy } = require("esbuild-plugin-copy");

const args = process.argv.slice(2);

//@ts-check
/** @typedef {import('esbuild').BuildOptions} BuildOptions **/

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
  target: "es2021",
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
  target: "es2021",
  format: "esm",
  entryPoints: ["./bin/webview/webview.js"],
  outfile: "./out/webview.js",
  plugins: [
    copy({
      resolveFrom: "cwd",
      assets: [
        {
          from: ["./src/webview/*.css"],
          to: "./out",
        },
        {
          from: ["node_modules/codemirror/lib/codemirror.css"],
          to: "./out",
        },
        {
          from: ["node_modules/codemirror/theme/material-darker.css"],
          to: "./out",
        },
      ],
    }),
  ],
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
      });
      await build({
        ...webviewConfig,
        ...watchConfig,
      });
      console.log("[watch] build finished");
    } else {
      // Build extension and webview code
      await build(extensionConfig);
      await build(webviewConfig);
      console.log("build complete");
    }
  } catch (err) {
    process.stderr.write(err.stderr);
    process.exit(1);
  }
})();
