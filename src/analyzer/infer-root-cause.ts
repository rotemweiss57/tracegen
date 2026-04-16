import type {
  Confidence,
  LocalContext,
  RootCauseCategory,
  RootCauseHypothesis,
  TestFailure,
} from "./types.js";

// ── Rule definitions ─────────────────────────────────────────────────

interface Rule {
  test: (failure: TestFailure, context: LocalContext) => boolean;
  category: RootCauseCategory;
  confidence: Confidence;
  explain: (failure: TestFailure) => string;
  evidence: (failure: TestFailure) => string[];
  fix: (failure: TestFailure) => string | null;
}

function firstProjectFile(failure: TestFailure): string {
  const frame = failure.stackTrace.find((f) => f.isProjectFile);
  return frame?.file ?? "the source file";
}

function firstProjectLine(failure: TestFailure): number | null {
  const frame = failure.stackTrace.find((f) => f.isProjectFile);
  return frame?.line ?? null;
}

function atLocation(f: TestFailure): string {
  const line = firstProjectLine(f);
  const file = firstProjectFile(f);
  return line ? `${file}:${line}` : file;
}

// ── Rules (ordered: specific patterns first, broad heuristics last) ──

const rules: Rule[] = [

  // ═══════════════════════════════════════════════════════════════════
  // HIGH CONFIDENCE — specific, unambiguous error patterns
  // ═══════════════════════════════════════════════════════════════════

  // ── Undefined / null property access ──
  {
    test: (f) => /cannot read propert(y|ies) of (undefined|null)/i.test(f.errorMessage),
    category: "undefined_or_null",
    confidence: "high",
    explain: (f) => {
      const valMatch = /of (\w+)/i.exec(f.errorMessage);
      const propMatch = /reading '([^']+)'/i.exec(f.errorMessage);
      const val = valMatch?.[1] ?? "a value";
      const prop = propMatch?.[1] ?? "a property";
      return `Attempted to access '.${prop}' on ${val} at ${atLocation(f)}. The variable is ${val} when it should be initialized.`;
    },
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) => {
      const propMatch = /reading '([^']+)'/i.exec(f.errorMessage);
      const prop = propMatch?.[1] ?? "the property";
      return `Add a null/undefined check before accessing '.${prop}' at ${atLocation(f)}, or ensure the value is properly initialized upstream.`;
    },
  },

  // ── "X is not a function" ──
  {
    test: (f) => /is not a function/i.test(f.errorMessage),
    category: "type_mismatch",
    confidence: "high",
    explain: (f) => {
      const match = /(\S+) is not a function/i.exec(f.errorMessage);
      const name = match?.[1] ?? "The value";
      return `'${name}' was called as a function but is not callable. This often indicates a wrong import, misspelled method name, or a variable that was overwritten.`;
    },
    evidence: (f) => [f.errorMessage],
    fix: (f) => {
      const match = /(\S+) is not a function/i.exec(f.errorMessage);
      const name = match?.[1] ?? "the identifier";
      return `Verify that '${name}' is correctly imported/defined and is a function. Check for typos, default export mismatches, and variable shadowing.`;
    },
  },

  // ── "X is not a constructor" ──
  {
    test: (f) => /is not a constructor/i.test(f.errorMessage),
    category: "type_mismatch",
    confidence: "high",
    explain: (f) => {
      const match = /(\S+) is not a constructor/i.exec(f.errorMessage);
      const name = match?.[1] ?? "The value";
      return `'${name}' was used with 'new' but is not a constructor. Check that the import is a class or constructor function, not a plain object or default export wrapper.`;
    },
    evidence: (f) => [f.errorMessage],
    fix: (f) => {
      const match = /(\S+) is not a constructor/i.exec(f.errorMessage);
      const name = match?.[1] ?? "the identifier";
      return `Check the import of '${name}'. For CommonJS/ESM interop, try 'import { ${name} }' instead of 'import ${name}', or access '.default'.`;
    },
  },

  // ── "X is not iterable" ──
  {
    test: (f) => /is not iterable/i.test(f.errorMessage),
    category: "type_mismatch",
    confidence: "high",
    explain: (f) => {
      const match = /(\S+) is not iterable/i.exec(f.errorMessage);
      const name = match?.[1] ?? "The value";
      return `'${name}' was used in a for...of loop or spread/destructuring but is not iterable. The value may be undefined, null, or a non-iterable type.`;
    },
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Ensure the value is an array or iterable before iterating. Add a null check or default to an empty array (e.g., 'items ?? []').`,
  },

  // ── Cannot find module ──
  {
    test: (f) =>
      /cannot find module/i.test(f.errorMessage) ||
      /err_module_not_found/i.test(f.errorMessage),
    category: "import_or_module",
    confidence: "high",
    explain: (f) => {
      const match = /cannot find module '([^']+)'/i.exec(f.errorMessage);
      const mod = match?.[1] ?? "the module";
      return `Module '${mod}' could not be resolved. This could be a missing dependency, incorrect path, or misconfigured module resolution.`;
    },
    evidence: (f) => [f.errorMessage],
    fix: (f) => {
      const match = /cannot find module '([^']+)'/i.exec(f.errorMessage);
      const mod = match?.[1] ?? "";
      if (mod.startsWith(".") || mod.startsWith("/")) {
        return `Check that the file path '${mod}' is correct and the file exists. Verify file extensions and case sensitivity.`;
      }
      return `Run 'npm install ${mod}' or verify the package name is correct in your dependencies.`;
    },
  },

  // ── ESM/CJS interop: require() of ESM ──
  {
    test: (f) =>
      /err_require_esm/i.test(f.errorMessage) ||
      /require\(\) of es module/i.test(f.errorMessage),
    category: "module_interop",
    confidence: "high",
    explain: (f) => {
      const match = /require\(\) of ES Module (.+?)(?:\s|$)/i.exec(f.errorMessage);
      const mod = match?.[1] ?? "the module";
      return `Attempted to require() an ES module (${mod}). The package is ESM-only and must be imported with 'import', not 'require()'.`;
    },
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Use dynamic 'import()' instead of 'require()', or add "type": "module" to your package.json and switch to import statements.`,
  },

  // ── "Cannot use import statement outside a module" ──
  {
    test: (f) => /cannot use import statement outside a module/i.test(f.errorMessage),
    category: "module_interop",
    confidence: "high",
    explain: () =>
      `The file uses ES module 'import' syntax but is being loaded as CommonJS. This typically means the project is missing "type": "module" in package.json, or the file extension should be .mjs.`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Add "type": "module" to package.json, or rename the file to .mjs, or use require() instead of import.`,
  },

  // ── ".default is not a function" — ESM default export interop ──
  {
    test: (f) => /\.default is not a function/i.test(f.errorMessage),
    category: "module_interop",
    confidence: "high",
    explain: (f) => {
      const match = /(\S+)\.default is not a function/i.exec(f.errorMessage);
      const name = match?.[1] ?? "The import";
      return `'${name}.default' is not a function. This is a common ESM/CJS interop issue where a default export is accessed incorrectly.`;
    },
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Try using the import directly without '.default', or switch between 'import X from' and 'import { default as X } from'. Check if the package uses module.exports vs export default.`,
  },

  // ── Syntax error (includes build/transform errors) ──
  {
    test: (f) =>
      f.errorType === "SyntaxError" ||
      /unexpected token/i.test(f.errorMessage) ||
      /transform failed|expected.*but found/i.test(f.errorMessage) ||
      /expected.*but found/i.test(f.rawOutput),
    category: "syntax_error",
    confidence: "high",
    explain: (f) =>
      `Syntax error: ${f.errorMessage}. The code has a structural issue preventing parsing.`,
    evidence: (f) => [f.errorMessage, `File: ${firstProjectFile(f)}`],
    fix: (f) => {
      const line = firstProjectLine(f);
      return line
        ? `Check ${firstProjectFile(f)} near line ${line} for syntax issues: missing brackets, semicolons, or invalid expressions.`
        : `Check the indicated file for syntax issues: missing brackets, semicolons, or invalid expressions.`;
    },
  },

  // ── Maximum call stack size — infinite recursion ──
  {
    test: (f) => /maximum call stack size exceeded/i.test(f.errorMessage),
    category: "infinite_recursion",
    confidence: "high",
    explain: () =>
      `Maximum call stack size exceeded — infinite recursion detected. A function is calling itself (directly or indirectly) without a proper base case.`,
    evidence: (f) => {
      const frames = f.stackTrace
        .filter((frame) => frame.isProjectFile)
        .slice(0, 5)
        .map((frame) => `${frame.function ?? "?"} at ${frame.file}:${frame.line}`);
      return [f.errorMessage, ...frames];
    },
    fix: (f) =>
      `Check ${firstProjectFile(f)} for recursive function calls. Add or fix the base case that stops recursion. Look for circular dependencies between modules.`,
  },

  // ── Assignment to constant variable ──
  {
    test: (f) => /assignment to constant variable/i.test(f.errorMessage),
    category: "type_mismatch",
    confidence: "high",
    explain: () =>
      `Attempted to reassign a variable declared with 'const'. Use 'let' instead if the value needs to change.`,
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) =>
      `Change 'const' to 'let' at the declaration site, or restructure the code to avoid reassignment. Location: ${atLocation(f)}.`,
  },

  // ── ReferenceError: X is not defined ──
  {
    test: (f) => f.errorType === "ReferenceError" || /ReferenceError.*is not defined/i.test(f.errorMessage),
    category: "missing_property",
    confidence: "high",
    explain: (f) => {
      const match = /(\w+) is not defined/i.exec(f.errorMessage);
      const name = match?.[1] ?? "A variable";
      return `'${name}' is not defined in the current scope. It may be misspelled, not imported, or declared in a different scope.`;
    },
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) => {
      const match = /(\w+) is not defined/i.exec(f.errorMessage);
      const name = match?.[1] ?? "the variable";
      return `Import or declare '${name}' before use. Check for typos in the variable name. Location: ${atLocation(f)}.`;
    },
  },

  // ── Timeout ──
  {
    test: (f) =>
      /timeout/i.test(f.errorMessage) ||
      /exceeded.*time/i.test(f.errorMessage) ||
      /async callback was not invoked/i.test(f.errorMessage),
    category: "timeout",
    confidence: "high",
    explain: (f) =>
      `Operation timed out: ${f.errorMessage}. An async operation or test took longer than the allowed time limit.`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Increase the timeout threshold, or investigate why the operation is slow. Check for missing 'await', unresolved promises, or blocking operations.`,
  },

  // ── Network / IO ──
  {
    test: (f) =>
      /econnrefused|enotfound|econnreset|econnaborted|epipe|fetch failed|network error/i.test(f.errorMessage),
    category: "network_or_io",
    confidence: "high",
    explain: (f) => {
      const portMatch = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i.exec(f.errorMessage);
      const port = portMatch?.[1];
      const service = port === "5432" ? "PostgreSQL" : port === "3306" ? "MySQL" : port === "27017" ? "MongoDB" : port === "6379" ? "Redis" : null;
      const hint = service ? ` (${service} on port ${port})` : "";
      return `Network error: ${f.errorMessage}. A connection to an external service failed${hint}.`;
    },
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Verify the target service is running and accessible. Check the URL/host/port configuration. Consider mocking the service in tests.`,
  },

  // ── Permission error ──
  {
    test: (f) =>
      /eperm|eacces|permission denied/i.test(f.errorMessage),
    category: "permission_error",
    confidence: "high",
    explain: (f) =>
      `Permission denied: ${f.errorMessage}. The process lacks the necessary filesystem or OS permissions.`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Check file/directory permissions. On macOS/Linux: 'chmod' or 'chown'. In CI: ensure the build user has access. Avoid writing to read-only directories.`,
  },

  // ── Database errors ──
  {
    test: (f) =>
      /er_no_such_table|relation.*does not exist|no such table|unknown database/i.test(f.errorMessage) ||
      /unique constraint|duplicate key|violates.*constraint/i.test(f.errorMessage),
    category: "database_error",
    confidence: "high",
    explain: (f) => {
      if (/no.such.table|does not exist|unknown database/i.test(f.errorMessage)) {
        return `Database schema error: ${f.errorMessage}. The table or database doesn't exist — likely a missing migration.`;
      }
      return `Database constraint violation: ${f.errorMessage}. A unique or foreign key constraint was violated.`;
    },
    evidence: (f) => [f.errorMessage],
    fix: (f) => {
      if (/no.such.table|does not exist|unknown database/i.test(f.errorMessage)) {
        return `Run pending database migrations (e.g., 'npx prisma migrate dev', 'npx knex migrate:latest'). Ensure the test database is set up.`;
      }
      return `Check for duplicate data in test fixtures or seed data. Ensure unique fields have unique values across test cases.`;
    },
  },

  // ── Environment errors ──
  {
    test: (f) =>
      /env.*not.*(?:set|defined|found)|missing.*(?:env|environment|variable)/i.test(f.errorMessage) ||
      /process\.env\.\w+.*(?:undefined|required)/i.test(f.errorMessage),
    category: "environment_error",
    confidence: "medium",
    explain: (f) =>
      `Environment configuration error: ${f.errorMessage}. A required environment variable is missing or misconfigured.`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Set the required environment variable in your .env file or CI configuration. Check .env.example for the expected variables.`,
  },

  // ── TypeScript compiler errors (TS codes) ──
  {
    test: (f) => /TS2322:.*not assignable/i.test(f.errorMessage),
    category: "compilation_error",
    confidence: "high",
    explain: (f) => {
      const match = /Type '([^']+)' is not assignable to type '([^']+)'/i.exec(f.errorMessage);
      const from = match?.[1] ?? "the provided type";
      const to = match?.[2] ?? "the expected type";
      return `TypeScript type mismatch: '${from}' is not assignable to '${to}'. The value's type doesn't match what the variable/parameter expects.`;
    },
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) => {
      const match = /Type '([^']+)' is not assignable to type '([^']+)'/i.exec(f.errorMessage);
      const from = match?.[1] ?? "";
      const to = match?.[2] ?? "";
      if (from === "undefined" || from === "null") {
        return `Add a null check or use the non-null assertion operator. The value might be ${from} but the target type '${to}' doesn't allow it.`;
      }
      return `Fix the type mismatch at ${atLocation(f)}. Either change the value to match type '${to}', or update the type definition to accept '${from}'.`;
    },
  },

  {
    test: (f) => /TS2345:.*not assignable to parameter/i.test(f.errorMessage),
    category: "compilation_error",
    confidence: "high",
    explain: (f) =>
      `TypeScript argument type mismatch: ${f.errorMessage}. The argument passed to a function doesn't match the expected parameter type.`,
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) =>
      `Fix the argument type at ${atLocation(f)}. Check the function signature and pass a value of the correct type.`,
  },

  {
    test: (f) => /TS2307:.*cannot find module/i.test(f.errorMessage),
    category: "import_or_module",
    confidence: "high",
    explain: (f) => {
      const match = /Cannot find module '([^']+)'/i.exec(f.errorMessage);
      const mod = match?.[1] ?? "the module";
      return `TypeScript can't find module '${mod}'. The import path may be wrong, the package may not be installed, or type declarations may be missing.`;
    },
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) => {
      const match = /Cannot find module '([^']+)'/i.exec(f.errorMessage);
      const mod = match?.[1] ?? "";
      if (mod.startsWith(".")) {
        return `Check the import path '${mod}' — the file may not exist or the extension may be wrong.`;
      }
      return `Run 'npm install ${mod}' or 'npm install @types/${mod}' if it's a type declaration.`;
    },
  },

  {
    test: (f) => /TS2339:.*does not exist on type/i.test(f.errorMessage),
    category: "missing_property",
    confidence: "high",
    explain: (f) => {
      const match = /Property '([^']+)' does not exist on type '([^']+)'/i.exec(f.errorMessage);
      const prop = match?.[1] ?? "the property";
      const type = match?.[2] ?? "the type";
      return `Property '${prop}' doesn't exist on type '${type}'. The property may be misspelled, or the type definition needs updating.`;
    },
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) => {
      const match = /Property '([^']+)' does not exist on type '([^']+)'/i.exec(f.errorMessage);
      const prop = match?.[1] ?? "the property";
      const type = match?.[2] ?? "the type";
      return `Add '${prop}' to the '${type}' interface, fix the typo, or use a type assertion if you're sure it exists.`;
    },
  },

  {
    test: (f) => /TS2554:.*Expected \d+ arguments?, but got \d+/i.test(f.errorMessage),
    category: "compilation_error",
    confidence: "high",
    explain: (f) =>
      `Wrong number of arguments: ${f.errorMessage}. The function call has too many or too few arguments.`,
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) =>
      `Check the function signature at ${atLocation(f)} and pass the correct number of arguments. Some may need to be optional.`,
  },

  {
    test: (f) => /TS\d+:/.test(f.errorMessage) && !/TS2322|TS2345|TS2307|TS2339|TS2554/.test(f.errorMessage),
    category: "compilation_error",
    confidence: "medium",
    explain: (f) => {
      const match = /(TS\d+):\s*(.+)/i.exec(f.errorMessage);
      return `TypeScript error ${match?.[1] ?? ""}: ${match?.[2] ?? f.errorMessage}`;
    },
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) =>
      `Fix the TypeScript error at ${atLocation(f)}. Check the TypeScript documentation for this error code.`,
  },

  // ── npm-specific errors ──
  {
    test: (f) => /E404:.*not found|package.*not found/i.test(f.errorMessage),
    category: "dependency_conflict",
    confidence: "high",
    explain: (f) =>
      `npm package not found: ${f.errorMessage}. The package name may be misspelled or it may have been unpublished.`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Check the package name for typos. Search https://www.npmjs.com/ to verify the correct name.`,
  },

  {
    test: (f) => /ERESOLVE|peer dependency conflict|unable to resolve dependency/i.test(f.errorMessage),
    category: "dependency_conflict",
    confidence: "high",
    explain: (f) =>
      `npm dependency conflict: ${f.errorMessage}. Packages require incompatible versions of a shared dependency.`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Try 'npm install --legacy-peer-deps' to bypass the conflict, or update the conflicting packages to compatible versions.`,
  },

  // ── Generic compiler errors (Java javac, Go, etc.) ──
  {
    test: (f) =>
      f.errorType === "CompilerError" &&
      /incompatible types|cannot be converted|cannot find symbol/i.test(f.errorMessage),
    category: "compilation_error",
    confidence: "high",
    explain: (f) => `Compiler error: ${f.errorMessage}`,
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) => `Fix the compiler error at ${atLocation(f)}. Check types, imports, and variable declarations.`,
  },

  // ── ESLint errors ──
  {
    test: (f) => f.errorType === "ESLintError",
    category: "lint_error",
    confidence: "high",
    explain: (f) => {
      const autoFix = f.errorMessage.includes("auto-fixable");
      return autoFix
        ? `ESLint error (auto-fixable): ${f.errorMessage}. Run 'eslint --fix' to resolve automatically.`
        : `ESLint error: ${f.errorMessage}. This requires a manual code change.`;
    },
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) => {
      if (f.errorMessage.includes("auto-fixable")) {
        return `Run 'eslint --fix' to auto-fix this issue, then re-run the linter to verify.`;
      }
      return `Fix the lint error at ${atLocation(f)}. Review the ESLint rule documentation for guidance.`;
    },
  },

  // ── Resource limits ──
  {
    test: (f) => /out of memory|heap|allocation failed|javascript heap/i.test(f.errorMessage),
    category: "resource_limit",
    confidence: "high",
    explain: () =>
      `Node.js ran out of memory. The process exceeded the default heap size limit.`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Increase memory: NODE_OPTIONS=--max-old-space-size=4096. Or investigate memory leaks / large data processing.`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // LANGUAGE-SPECIFIC RULES (Python, Go, Rust, Java)
  // ═══════════════════════════════════════════════════════════════════

  // ── Python: ModuleNotFoundError ──
  {
    test: (f) => /ModuleNotFoundError|No module named/i.test(f.errorMessage),
    category: "import_or_module",
    confidence: "high",
    explain: (f) => {
      const match = /No module named '([^']+)'/i.exec(f.errorMessage);
      return `Python module '${match?.[1] ?? "unknown"}' not found. It may need to be installed or the import path is wrong.`;
    },
    evidence: (f) => [f.errorMessage],
    fix: (f) => {
      const match = /No module named '([^']+)'/i.exec(f.errorMessage);
      const mod = match?.[1] ?? "";
      return mod ? `Run: pip install ${mod}` : `Install the missing Python package with pip.`;
    },
  },

  // ── Python: IndentationError ──
  {
    test: (f) => /IndentationError/i.test(f.errorMessage) || f.errorType === "IndentationError",
    category: "syntax_error",
    confidence: "high",
    explain: (f) => `Python indentation error: ${f.errorMessage}. Python requires consistent indentation (spaces or tabs, not mixed).`,
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: () => `Fix the indentation — use consistent spaces (4 per level is standard). Don't mix tabs and spaces.`,
  },

  // ── Python: KeyError ──
  {
    test: (f) => /KeyError/i.test(f.errorMessage) || f.errorType === "KeyError",
    category: "missing_property",
    confidence: "high",
    explain: (f) => {
      const match = /KeyError:\s*'?([^']*)'?/i.exec(f.errorMessage);
      return `Python KeyError: key '${match?.[1] ?? "unknown"}' not found in dictionary.`;
    },
    evidence: (f) => [f.errorMessage],
    fix: (f) => {
      const match = /KeyError:\s*'?([^']*)'?/i.exec(f.errorMessage);
      const key = match?.[1] ?? "the key";
      return `Check if '${key}' exists before accessing: use dict.get('${key}', default) or 'if "${key}" in dict'.`;
    },
  },

  // ── Python: AttributeError ──
  {
    test: (f) => /AttributeError/i.test(f.errorMessage) || f.errorType === "AttributeError",
    category: "missing_property",
    confidence: "high",
    explain: (f) => {
      const match = /'(\w+)' object has no attribute '(\w+)'/i.exec(f.errorMessage);
      if (match) return `Python AttributeError: '${match[1]}' object has no attribute '${match[2]}'.`;
      return `Python AttributeError: ${f.errorMessage}`;
    },
    evidence: (f) => [f.errorMessage],
    fix: () => `Check the object type and verify the attribute name. The object may be the wrong type or the attribute is misspelled.`,
  },

  // ── Go: nil pointer dereference ──
  {
    test: (f) => /nil pointer dereference|invalid memory address/i.test(f.errorMessage),
    category: "undefined_or_null",
    confidence: "high",
    explain: () => `Go nil pointer dereference: attempted to use a nil pointer. A variable was not initialized or a function returned nil.`,
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) => `Add a nil check before using the pointer at ${atLocation(f)}. Check the function that returns this value.`,
  },

  // ── Go: index out of range ──
  {
    test: (f) => /index out of range/i.test(f.errorMessage) && f.errorType === "panic",
    category: "index_out_of_bounds",
    confidence: "high",
    explain: (f) => `Go panic: ${f.errorMessage}. A slice or array was accessed beyond its length.`,
    evidence: (f) => [f.errorMessage],
    fix: () => `Add bounds checking before accessing the slice/array. Use len() to verify the index is within range.`,
  },

  // ── Go: undefined variable ──
  {
    test: (f) => /^undefined:/i.test(f.errorMessage) && f.errorType === "CompilerError",
    category: "missing_property",
    confidence: "high",
    explain: (f) => `Go compiler error: ${f.errorMessage}. The variable or function is not defined in the current scope.`,
    evidence: (f) => [f.errorMessage],
    fix: () => `Declare the variable before use, or import the package that defines it.`,
  },

  // ── Rust: error[E0308] mismatched types ──
  {
    test: (f) => /E0308.*mismatched types/i.test(f.errorMessage),
    category: "type_mismatch",
    confidence: "high",
    explain: (f) => `Rust type mismatch: ${f.errorMessage}. The expected and actual types don't match.`,
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: () => `Fix the type mismatch — either change the value to match the expected type, or update the function signature.`,
  },

  // ── Rust: borrow checker errors ──
  {
    test: (f) => /E0382.*moved value|E0502.*cannot borrow|E0505.*borrowed value/i.test(f.errorMessage),
    category: "type_mismatch",
    confidence: "high",
    explain: (f) => `Rust ownership/borrowing error: ${f.errorMessage}. The borrow checker prevents use-after-move or conflicting borrows.`,
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: () => `Use .clone() to avoid moving, or restructure code to satisfy the borrow checker. Consider using references (&) instead of owned values.`,
  },

  // ── Rust: cannot find value/module ──
  {
    test: (f) => /E0433.*failed to resolve|E0425.*cannot find value/i.test(f.errorMessage),
    category: "import_or_module",
    confidence: "high",
    explain: (f) => `Rust module/value not found: ${f.errorMessage}`,
    evidence: (f) => [f.errorMessage],
    fix: () => `Add the missing 'use' statement, or add the crate to Cargo.toml dependencies.`,
  },

  // ── Java: NullPointerException ──
  {
    test: (f) => /NullPointerException/i.test(f.errorType ?? "") || /NullPointerException/i.test(f.errorMessage),
    category: "undefined_or_null",
    confidence: "high",
    explain: (f) => `Java NullPointerException: ${f.errorMessage}. A null reference was dereferenced.`,
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) => `Add a null check at ${atLocation(f)} before using the object. Use Optional<T> for values that may be absent.`,
  },

  // ── Java: ClassNotFoundException ──
  {
    test: (f) => /ClassNotFoundException|NoClassDefFoundError/i.test(f.errorType ?? ""),
    category: "import_or_module",
    confidence: "high",
    explain: (f) => `Java class not found: ${f.errorMessage}. The class is not on the classpath.`,
    evidence: (f) => [f.errorMessage],
    fix: () => `Add the missing dependency to pom.xml (Maven) or build.gradle (Gradle), then rebuild.`,
  },

  // ── Java: ArrayIndexOutOfBoundsException ──
  {
    test: (f) => /ArrayIndexOutOfBoundsException/i.test(f.errorType ?? ""),
    category: "index_out_of_bounds",
    confidence: "high",
    explain: (f) => `Java ArrayIndexOutOfBoundsException: ${f.errorMessage}. An array was accessed beyond its length.`,
    evidence: (f) => [f.errorMessage],
    fix: () => `Add bounds checking: verify index < array.length before access.`,
  },

  // ── Java: ClassCastException ──
  {
    test: (f) => /ClassCastException/i.test(f.errorType ?? ""),
    category: "type_mismatch",
    confidence: "high",
    explain: (f) => `Java ClassCastException: ${f.errorMessage}. An object was cast to an incompatible type.`,
    evidence: (f) => [f.errorMessage],
    fix: () => `Check the actual type with instanceof before casting, or use generics to avoid casts.`,
  },

  // ── Java: StackOverflowError ──
  {
    test: (f) => /StackOverflowError/i.test(f.errorType ?? ""),
    category: "infinite_recursion",
    confidence: "high",
    explain: () => `Java StackOverflowError: infinite recursion or deeply nested calls exceeded the stack limit.`,
    evidence: (f) => [f.errorMessage],
    fix: () => `Check for recursive method calls without a proper base case. Consider converting recursion to iteration.`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // MEDIUM CONFIDENCE — patterns that could have multiple causes
  // ═══════════════════════════════════════════════════════════════════

  // ── Assertion failure with expected/received ──
  {
    test: (f) =>
      /expected.*received|expected.*but got|to equal|to be|toEqual|toBe/i.test(f.errorMessage) ||
      /expected.*to.*(?:equal|be|match|contain)/i.test(f.errorMessage) ||
      /assertion.*failed|assert.*failed/i.test(f.errorMessage),
    category: "assertion_failure",
    confidence: "medium",
    explain: (f) =>
      `Test assertion failed: the actual value did not match the expected value. ${f.errorMessage}`,
    evidence: (f) => [f.errorMessage, `Test: ${f.testName ?? "unknown"}`],
    fix: (f) =>
      `Review the test '${f.testName ?? "unknown"}' and the code it exercises. Either the expected value in the test is wrong, or the code under test has a bug.`,
  },

  // ── Snapshot mismatch ──
  {
    test: (f) =>
      /snapshot/i.test(f.errorMessage) ||
      /toMatchSnapshot|toMatchInlineSnapshot/i.test(f.errorMessage),
    category: "assertion_failure",
    confidence: "medium",
    explain: () =>
      `Snapshot test failed. The component or function output has changed since the last snapshot was saved.`,
    evidence: (f) => [f.errorMessage, `Test: ${f.testName ?? "unknown"}`],
    fix: () =>
      `If the change is intentional, update the snapshot with '--update' flag (e.g., 'npx vitest run --update'). Otherwise, investigate what caused the output to change.`,
  },

  // ── Async / promise ──
  {
    test: (f) =>
      /unhandled.*promise|unhandled.*rejection/i.test(f.errorMessage) ||
      /unhandled.*rejection|unhandled.*error/i.test(f.rawOutput),
    category: "async_or_promise",
    confidence: "medium",
    explain: () =>
      `An unhandled promise rejection occurred. A promise was rejected but had no .catch() handler or try/catch around its await.`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Add error handling: wrap 'await' calls in try/catch, or add .catch() to promise chains. Ensure test setup/teardown handles async cleanup.`,
  },

  // ── Test setup errors ──
  {
    test: (f) =>
      /beforeeach is not defined|aftereach is not defined|beforeall.*not.*defined/i.test(f.errorMessage) ||
      /cannot find name 'describe'|cannot find name 'it'|cannot find name 'test'/i.test(f.errorMessage),
    category: "test_setup_error",
    confidence: "medium",
    explain: () =>
      `Test framework globals are not available. The test runner is not configured correctly, or type definitions are missing.`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Ensure vitest/jest types are installed. Add "types": ["vitest/globals"] to tsconfig.json, or import { describe, it, expect } from your test framework.`,
  },

  // ── Missing property / not defined (generic) ──
  {
    test: (f) =>
      /has no property|property.*does not exist|no such property/i.test(f.errorMessage),
    category: "missing_property",
    confidence: "medium",
    explain: (f) =>
      `A property that was expected to exist is missing: ${f.errorMessage}`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Check for typos in the property name. Verify the object has the expected shape. The API or data source may have changed.`,
  },

  // ── Shape mismatch ──
  {
    test: (f) =>
      /expected.*object|expected.*array|cannot.*iterate/i.test(f.errorMessage),
    category: "shape_mismatch",
    confidence: "low",
    explain: (f) =>
      `Data shape mismatch: the code received a different data structure than expected. ${f.errorMessage}`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Verify the data shape matches what the consuming code expects. Add runtime validation or type guards at the boundary where data enters.`,
  },

  // ── Index out of bounds ──
  {
    test: (f) =>
      /index.*out of.*(?:bound|range)/i.test(f.errorMessage),
    category: "index_out_of_bounds",
    confidence: "medium",
    explain: (f) =>
      `Index out of bounds: ${f.errorMessage}. An array or string was accessed beyond its length.`,
    evidence: (f) => [f.errorMessage],
    fix: () =>
      `Add bounds checking before array access. Verify array length before indexing. Check for off-by-one errors.`,
  },

  // ── Null/undefined (broader pattern — lower confidence) ──
  {
    test: (f) =>
      /is (undefined|null)$/i.test(f.errorMessage) ||
      /\bundefined\b.*\bnot\b.*\bobject\b/i.test(f.errorMessage),
    category: "undefined_or_null",
    confidence: "medium",
    explain: (f) =>
      `A value is unexpectedly null or undefined: ${f.errorMessage}`,
    evidence: (f) => [f.errorMessage, `at ${atLocation(f)}`],
    fix: (f) =>
      `Add a null/undefined check at ${atLocation(f)}. Trace the value back to its source to find where it should have been set.`,
  },
];

// ── Public API ───────────────────────────────────────────────────────

const CONFIDENCE_ORDER: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const MAX_HYPOTHESES = 5;

export function inferRootCauses(
  failures: TestFailure[],
  _context: LocalContext,
): RootCauseHypothesis[] {
  const hypotheses: RootCauseHypothesis[] = [];
  const seenCategories = new Set<string>();

  for (const failure of failures) {
    for (const rule of rules) {
      if (!rule.test(failure, _context)) continue;

      // Avoid duplicate categories for the same failure pattern
      const key = `${rule.category}:${failure.errorMessage.slice(0, 50)}`;
      if (seenCategories.has(key)) continue;
      seenCategories.add(key);

      hypotheses.push({
        category: rule.category,
        confidence: rule.confidence,
        explanation: rule.explain(failure),
        evidence: rule.evidence(failure),
        suggestedFix: rule.fix(failure),
      });
    }
  }

  // Sort by confidence, keep top N
  hypotheses.sort(
    (a, b) =>
      (CONFIDENCE_ORDER[b.confidence] ?? 0) - (CONFIDENCE_ORDER[a.confidence] ?? 0),
  );

  // If nothing matched, add an "unknown" hypothesis
  if (hypotheses.length === 0 && failures.length > 0) {
    const f = failures[0]!;
    hypotheses.push({
      category: "unknown",
      confidence: "low",
      explanation: `Could not automatically categorize this error: ${f.errorMessage}`,
      evidence: [f.errorMessage],
      suggestedFix:
        "Review the error message and stack trace manually. The error pattern was not recognized by the heuristic engine.",
    });
  }

  return hypotheses.slice(0, MAX_HYPOTHESES);
}
