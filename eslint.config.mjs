// Configuracao minima: pega codigo morto e variavel nao usada, que era o que
// escondia o MAC descartado em /api/renewals.
export default [
  {
    files: ["**/*.mjs", "**/*.js"],
    ignores: ["node_modules/**", "vendor/**", "public/*.min.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module"
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-self-compare": "error"
    }
  }
];
