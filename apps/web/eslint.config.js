import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    files: ["components/ui/**/*.{ts,tsx}"],
    rules: {
      "react/prop-types": "off",
    },
  },
  {
    files: ["env.js"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
    rules: {
      "turbo/no-undeclared-env-vars": "off",
    },
  },
  {
    files: ["components/auth/social-buttons.tsx"],
    rules: {
      "turbo/no-undeclared-env-vars": "off",
    },
  },
  {
    files: ["next.config.js"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
  },
  {
    files: ["components/home/smoke-background.tsx"],
    rules: {
      "react/no-unknown-property": "off",
    },
  },
  {
    files: ["components/home/hero-landing.tsx"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
];
