import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import pluginSecurity from "eslint-plugin-security";
import noSecretsPlugin from "eslint-plugin-no-secrets";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  pluginSecurity.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ["dist/", "coverage/", "tests/", "jest.config.cjs"],
  },
  {
    plugins: { "no-secrets": noSecretsPlugin },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-secrets/no-secrets": "error",
    },
  },
);
