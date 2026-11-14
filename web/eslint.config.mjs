// @ts-check

import eslint from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// The layers of src/ (wiki Server-App, "Repository layout"). Imports go one
// way only: shared → data → model → features → layouts → app (each layer may
// import the ones before it, and itself).
const SHARED = "shared";
const DATA = "data";
const MODEL = "model";
const FEATURE = "feature";
const LAYOUTS = "layouts";
const APP = "app";

// Features don't import other features, except these, which several
// features build on. Anything else shared between features moves to model/.
const SHARED_FEATURES = [{ name: "canvas-editing" }, { name: "ui-manager" }];

/** Allow imports into the given layers. @param {...string} types */
const into = (...types) => ({ to: { element: { types } } });

export default defineConfig(
  // Generated from the Go types (go run ./cmd/gen-ts); don't lint it.
  { ignores: ["dist", "node_modules", "src/data/api/generated"] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // ---- Layer boundaries ----------------------------------------------------
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": { typescript: { alwaysTryTypes: true, project: "./tsconfig.json" } },
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        { type: SHARED, pattern: "src/{components,hooks,utils,config,styles,assets,testing}", partialMatch: false },
        { type: DATA, pattern: "src/data/*", partialMatch: false, capture: ["name"] },
        { type: MODEL, pattern: "src/model", partialMatch: false },
        { type: FEATURE, pattern: "src/features/*", partialMatch: false, capture: ["name"] },
        { type: LAYOUTS, pattern: "src/layouts", partialMatch: false },
        { type: APP, pattern: "src/app", partialMatch: false },
      ],
    },
    rules: {
      // Every file in src/ belongs to a layer; a new top-level folder needs one here.
      "boundaries/no-unknown-files": "error",
      "boundaries/no-unknown-dependencies": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            { from: { element: { type: SHARED } }, allow: into(SHARED) },
            { from: { element: { type: DATA } }, allow: into(SHARED, DATA) },
            { from: { element: { type: MODEL } }, allow: into(SHARED, DATA, MODEL) },
            {
              from: { element: { type: FEATURE } },
              allow: [
                into(SHARED, DATA, MODEL),
                // Its own files.
                { to: { element: { type: FEATURE, captured: { name: "{{ from.element.captured.name }}" } } } },
                { to: { element: { type: FEATURE, captured: SHARED_FEATURES } } },
              ],
            },
            { from: { element: { type: LAYOUTS } }, allow: into(SHARED, DATA, MODEL, FEATURE, LAYOUTS) },
            { from: { element: { type: APP } }, allow: into(SHARED, DATA, MODEL, FEATURE, LAYOUTS, APP) },
          ],
        },
      ],
    },
  },

  // ---- Who may import what -------------------------------------------------
  // dexie only in data/local; the generated wire types only in data/ (the
  // rest of the app imports the types data/api exports).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/data/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "dexie", message: "Only src/data/local imports Dexie; use its queries." }],
          patterns: [
            {
              group: ["@/data/api/generated", "@/data/api/generated/*", "**/data/api/generated", "**/data/api/generated/*"],
              message: "The generated wire types are imported only in src/data/; import the types src/data/api exports.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/data/**/*.{ts,tsx}"],
    ignores: ["src/data/local/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "dexie", message: "Only src/data/local imports Dexie; use its queries." }] },
      ],
    },
  },
);
