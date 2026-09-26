import { Command } from "commander";

import { getOracleLifecycleSourceAdapters } from "../../../oracle/src/source-adapter-registry";

type Options = {
  json?: boolean;
};

function run(options: Options): void {
  const adapters = getOracleLifecycleSourceAdapters();
  const rows = adapters.flatMap((adapter) => {
    const routes = adapter.routes?.length
      ? adapter.routes
      : [{ measurementKind: "*", resultShape: "*" }];
    return routes.map((route) => ({
      sourceFamily: adapter.sourceFamily,
      sourceLabel: adapter.sourceLabel,
      sourceIds: adapter.sourceIds,
      measurementKind: route.measurementKind,
      resultShape: route.resultShape,
      closeCondition: Boolean(adapter.capabilities.closeCondition),
      resolution: Boolean(adapter.capabilities.resolution),
      requiredEnvVars: adapter.requiredEnvVars ?? [],
      missingEnvVars: (adapter.requiredEnvVars ?? []).filter((name) => !process.env[name]?.trim())
    }));
  });

  const receipt = {
    objectType: "source_adapter_coverage_map",
    generatedAt: new Date().toISOString(),
    adapterCount: adapters.length,
    routeCount: rows.length,
    routes: rows
  };

  console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
}

const program = new Command("source-adapter-coverage-map")
  .description("Read-only route map for Oracle source adapter coverage.")
  .option("--json")
  .action(run);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
