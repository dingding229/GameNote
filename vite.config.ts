import vinext from "vinext";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;
const localVars = Object.fromEntries(
  [
    ["APP_ACCESS_PASSWORD", process.env.APP_ACCESS_PASSWORD],
    ["APP_ACCESS_SESSION_SECRET", process.env.APP_ACCESS_SESSION_SECRET],
  ].filter((item): item is [string, string] => Boolean(item[1])),
);

export default defineConfig(({ command }) => {
  const includeLocalBindings = command === "serve";
  const localBindingConfig = {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    vars: localVars,
    d1_databases:
      includeLocalBindings && d1
        ? [
            {
              binding: d1,
              database_name: "site-creator-d1",
              database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
            },
          ]
        : [],
    r2_buckets:
      includeLocalBindings && r2
        ? [
            {
              binding: r2,
              bucket_name: "site-creator-r2",
            },
          ]
        : [],
  };

  return {
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
      sites(),
    ],
  };
});
