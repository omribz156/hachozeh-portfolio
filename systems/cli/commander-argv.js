"use strict";

function findCommanderCommandIndex(args, booleanOptions) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (booleanOptions.has(arg)) {
      continue;
    }

    if (arg.startsWith("--")) {
      const next = args[index + 1];

      if (next && !next.startsWith("--")) {
        index += 1;
      }

      continue;
    }

    return index;
  }

  return -1;
}

module.exports = {
  findCommanderCommandIndex
};
