module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Cycles make cleanup and seam ownership harder to reason about.",
      from: {},
      to: {
        circular: true
      }
    },
    {
      name: "oracle-must-use-platform-surface",
      severity: "error",
      comment: "systems/oracle must only import from systems/back through the platform-surface/oracle barrel. Deep imports bypass the contract surface and break silently on back refactors. Widen the barrel instead of adding a deep import.",
      from: {
        path: "^systems/oracle/src"
      },
      to: {
        path: "^systems/back/src",
        pathNot: "^systems/back/src/platform-surface/oracle(\\.ts)?$"
      }
    }
  ],
  options: {
    doNotFollow: {
      path: "node_modules|dist|build|coverage|workspace/archive|workspace/runtime|workspace/reports|workspace/test/(gauntlet|runs)|systems/design/mockups"
    },
    exclude: {
      path: "node_modules|dist|build|coverage|workspace/archive|workspace/runtime|workspace/reports|workspace/test/(gauntlet|runs)|systems/design/mockups"
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true
  }
};
