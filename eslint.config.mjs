// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import noNull from "eslint-plugin-no-null";

export default tseslint.config(
    { ignores: ["*", "!src", "src/@types"] },
    eslint.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        plugins: {
            "@typescript-eslint": tseslint.plugin,
            "@stylistic": stylistic,
            "no-null": noNull,
        },

        languageOptions: {
            parser: tseslint.parser,
            //ecmaVersion: 2020,
            //sourceType: "module",
            parserOptions: {
                projectService: true,
            },
        },

        rules: {
            "@typescript-eslint/naming-convention": ["warn", {
                selector: "class",
                format: ["PascalCase"],
            }, {
                selector: "variable",
                types: ["boolean"],
                format: ["PascalCase"],
                prefix: ["is", "should", "has", "can", "did", "will"],
            }, {
                selector: "classProperty",
                modifiers: ["readonly", "static"],
                format: ["UPPER_CASE"],
            }],
            "@typescript-eslint/no-unused-vars": ["warn", {
                argsIgnorePattern: "^_",
            }],
            "@typescript-eslint/prefer-readonly": "warn",
            "@typescript-eslint/strict-boolean-expressions": ["warn", {
                allowString: false,
                allowNumber: false,
                allowNullableObject: false,
            }],

            "@stylistic/quotes": "warn",
            "@stylistic/semi": "warn",

            "comma-dangle": ["warn", {
                arrays: "always-multiline",
                objects: "always-multiline",
                imports: "always-multiline",
                exports: "always-multiline",
                functions: "never",
            }],
            "curly": "warn",
            "dot-notation": "off",
            "eqeqeq": "warn",
            "indent": ["warn", 2, {
                SwitchCase: 1,
            }],
            "no-multi-spaces": "warn",
            "no-multiple-empty-lines": ["warn", {
                max: 1,
                maxEOF: 0,
            }],
            "no-null/no-null": "warn",
            "no-trailing-spaces": "warn",

            // Disable javascript rules where we use the typescript version
            "quotes": "off",
            "semi": "off",
        },
    }
);
