import type {
  CodeSnippet,
  DebugPacket,
  PipelineStepResult,
  RootCauseHypothesis,
  StackFrame,
  TestFailure,
} from "./types.js";

// ── HTML escaping ────────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escJsonEmbed(str: string): string {
  return str.replace(/<\//g, "<\\/");
}

// ── Formatting helpers ───────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function humanCategory(cat: string): string {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function confidenceClass(c: string): string {
  if (c === "high") return "badge-high";
  if (c === "medium") return "badge-med";
  return "badge-low";
}

function stepStatusBadge(status: string, error: string | null): string {
  if (status === "success") return '<span class="step-ok">OK</span>';
  if (status === "skipped") return '<span class="step-skip">SKIP</span>';
  return `<span class="step-fail">FAIL</span>${error ? ` <span class="step-err">${esc(error)}</span>` : ""}`;
}

// ── Syntax highlighting (best-effort regex) ──────────────────────────

const TS_KEYWORDS = [
  "import", "export", "from", "const", "let", "var", "function", "class",
  "return", "if", "else", "for", "while", "do", "switch", "case", "break",
  "continue", "new", "this", "typeof", "instanceof", "in", "of", "throw",
  "try", "catch", "finally", "async", "await", "yield", "type", "interface",
  "enum", "extends", "implements", "public", "private", "protected",
  "static", "readonly", "abstract", "as", "default", "void", "null",
  "undefined", "true", "false",
];

function highlightSyntax(escapedCode: string, _language: string): string {
  // Use placeholder markers to avoid nested replacements
  const markers: string[] = [];
  function mark(cls: string, content: string): string {
    const idx = markers.length;
    markers.push(`<span class="${cls}">${content}</span>`);
    return `\x00${idx}\x00`;
  }

  let code = escapedCode;

  // 1. Block comments
  code = code.replace(/\/\*[\s\S]*?\*\//g, (m) => mark("hl-comment", m));

  // 2. Line comments
  code = code.replace(/\/\/.*$/gm, (m) => mark("hl-comment", m));

  // 3. Strings (using escaped HTML entities)
  code = code.replace(/(&quot;|&#39;|`)(?:(?!\1)[\s\S])*?\1/g, (m) =>
    mark("hl-string", m),
  );

  // 4. Keywords (word boundary)
  const kwRe = new RegExp(`\\b(${TS_KEYWORDS.join("|")})\\b`, "g");
  code = code.replace(kwRe, (m) => mark("hl-kw", m));

  // 5. Numbers
  code = code.replace(/\b(\d+(?:\.\d+)?)\b/g, (m) => mark("hl-num", m));

  // Restore markers
  code = code.replace(/\x00(\d+)\x00/g, (_, idx) => markers[parseInt(idx, 10)] ?? "");

  return code;
}

// ── Diff rendering ───────────────────────────────────────────────────

function renderDiff(diff: string): string {
  const lines = diff.split("\n").slice(0, 500);
  const highlighted = lines.map((line) => {
    const escaped = esc(line);
    if (line.startsWith("+")) return `<span class="diff-add">${escaped}</span>`;
    if (line.startsWith("-")) return `<span class="diff-del">${escaped}</span>`;
    if (line.startsWith("@@")) return `<span class="diff-range">${escaped}</span>`;
    return escaped;
  });

  const truncated = diff.split("\n").length > 500
    ? '\n<span class="text-muted">... truncated (500+ lines)</span>'
    : "";

  return `<pre class="code-block diff-block">${highlighted.join("\n")}${truncated}</pre>`;
}

// ── Section renderers ────────────────────────────────────────────────

function renderHeader(packet: DebugPacket): string {
  return `
    <header class="header">
      <div class="header-top">
        <div class="brand">
          <span class="logo">&#9670;</span> TraceGen
          <span class="version">v${esc(packet.metadata.tracegenVersion)}</span>
        </div>
        <div class="header-meta">
          ${esc(fmtTimestamp(packet.timestamp))}
        </div>
      </div>
      <div class="project-path">${esc(packet.projectRoot)}</div>
    </header>`;
}

function renderTestSummary(packet: DebugPacket): string {
  const { testRun } = packet;
  const passed = testRun.passedTests ?? 0;
  const failed = testRun.failedTests ?? 0;
  const total = testRun.totalTests ?? (passed + failed);
  const passRatio = total > 0 ? (passed / total) * 100 : 0;

  return `
    <section class="card">
      <h2>Test Run</h2>
      <div class="test-meta">
        <code>${esc(testRun.command)}</code>
        <span class="text-muted">exit ${testRun.exitCode ?? "N/A"} &middot; ${fmtDuration(testRun.durationMs)}</span>
      </div>
      <div class="summary-badges">
        <span class="badge badge-pass">${passed} passed</span>
        <span class="badge badge-fail">${failed} failed</span>
        <span class="badge badge-total">${total} total</span>
      </div>
      <div class="ratio-bar">
        <div class="ratio-fill" style="width: ${passRatio}%"></div>
      </div>
    </section>`;
}

function renderSingleFailure(failure: TestFailure, index: number): string {
  const projectFrames = failure.stackTrace.filter((f) => f.isProjectFile);

  return `
    <div class="failure">
      <div class="failure-header">
        <span class="failure-num">#${index + 1}</span>
        ${failure.errorType ? `<span class="badge badge-fail">${esc(failure.errorType)}</span>` : ""}
        <span class="failure-msg">${esc(failure.errorMessage)}</span>
      </div>
      ${failure.testName ? `<div class="failure-test"><span class="text-muted">Test:</span> ${esc(failure.testName)}</div>` : ""}
      ${failure.testFile ? `<div class="failure-test"><span class="text-muted">File:</span> <code>${esc(failure.testFile)}</code></div>` : ""}
      ${projectFrames.length > 0 ? `
        <div class="stack-trace">
          <div class="text-muted stack-label">Stack trace (project files)</div>
          ${projectFrames.slice(0, 8).map((f) => renderStackFrame(f)).join("\n")}
        </div>` : ""}
    </div>`;
}

function renderStackFrame(frame: StackFrame): string {
  const fn = frame.function ? `<span class="stack-fn">${esc(frame.function)}</span> ` : "";
  const loc = `${esc(frame.file ?? "?")}:${frame.line ?? "?"}:${frame.column ?? "?"}`;
  return `<div class="stack-frame">${fn}<span class="stack-loc">${loc}</span></div>`;
}

function renderFailures(packet: DebugPacket): string {
  if (packet.testRun.failures.length === 0) return "";

  return `
    <section class="card">
      <h2>Failures</h2>
      ${packet.testRun.failures.map((f, i) => renderSingleFailure(f, i)).join("\n")}
    </section>`;
}

function renderSingleCause(cause: RootCauseHypothesis, index: number): string {
  return `
    <div class="cause">
      <div class="cause-header">
        <span class="cause-num">#${index + 1}</span>
        <span class="cause-cat">${humanCategory(cause.category)}</span>
        <span class="badge ${confidenceClass(cause.confidence)}">${cause.confidence.toUpperCase()}</span>
      </div>
      <p class="cause-explanation">${esc(cause.explanation)}</p>
      ${cause.evidence.length > 0 ? `
        <div class="cause-evidence">
          <div class="text-muted">Evidence</div>
          <ul>${cause.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        </div>` : ""}
      ${cause.suggestedFix ? `
        <div class="suggested-fix">
          <div class="fix-label">Suggested Fix</div>
          <p>${esc(cause.suggestedFix)}</p>
        </div>` : ""}
    </div>`;
}

function renderRootCauses(packet: DebugPacket): string {
  if (packet.rootCauses.length === 0) return "";

  return `
    <section class="card">
      <h2>Root Cause Analysis</h2>
      ${packet.rootCauses.map((c, i) => renderSingleCause(c, i)).join("\n")}
    </section>`;
}

function renderSingleSnippet(snippet: CodeSnippet, errorLines: Set<number>): string {
  const lines = snippet.content.split("\n");
  const lineNumbers: string[] = [];
  const codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = snippet.startLine + i;
    const isError = errorLines.has(lineNum) &&
      snippet.file.length > 0;
    const escaped = esc(lines[i] ?? "");
    const highlighted = highlightSyntax(escaped, snippet.language);

    lineNumbers.push(
      `<span class="ln${isError ? " ln-err" : ""}">${lineNum}</span>`,
    );
    codeLines.push(
      `<span class="code-line${isError ? " code-line-err" : ""}">${highlighted}</span>`,
    );
  }

  return `
    <details class="snippet" open>
      <summary><code>${esc(snippet.file)}</code> <span class="text-muted">lines ${snippet.startLine}–${snippet.endLine}</span></summary>
      <div class="code-container">
        <pre class="line-nums">${lineNumbers.join("\n")}</pre>
        <pre class="code-block">${codeLines.join("\n")}</pre>
      </div>
    </details>`;
}

function renderCodeContext(packet: DebugPacket): string {
  if (packet.localContext.snippets.length === 0) return "";

  // Collect error line numbers from stack frames
  const errorLines = new Set<number>();
  for (const failure of packet.testRun.failures) {
    for (const frame of failure.stackTrace) {
      if (frame.isProjectFile && frame.line) {
        errorLines.add(frame.line);
      }
    }
  }

  return `
    <section class="card">
      <h2>Code Context</h2>
      ${packet.localContext.snippets.map((s) => renderSingleSnippet(s, errorLines)).join("\n")}
    </section>`;
}

function renderExternalEvidence(packet: DebugPacket): string {
  const { externalKnowledge } = packet;

  if (!externalKnowledge.searchAvailable) {
    return `
      <section class="card">
        <h2>External Evidence</h2>
        <div class="info-box">Web search was not available. Set <code>TAVILY_API_KEY</code> to enable.</div>
      </section>`;
  }

  const allResults = externalKnowledge.sources.flatMap((s) => s.results);
  if (allResults.length === 0) {
    return `
      <section class="card">
        <h2>External Evidence</h2>
        <div class="info-box">Web search returned no relevant results.</div>
      </section>`;
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return `
    <section class="card">
      <h2>External Evidence <span class="text-muted">(Tavily)</span></h2>
      <div class="evidence-grid">
        ${unique.slice(0, 8).map((r) => `
          <a class="evidence-card" href="${esc(r.url)}" target="_blank" rel="noopener">
            <div class="evidence-title">${esc(r.title)}</div>
            <div class="evidence-url">${esc(r.url)}</div>
            <div class="evidence-snippet">${esc(r.content.slice(0, 200))}</div>
          </a>
        `).join("\n")}
      </div>
    </section>`;
}

function renderGitContext(packet: DebugPacket): string {
  const { gitContext } = packet;

  if (!gitContext.available) {
    return `
      <section class="card">
        <h2>Git Context</h2>
        <div class="info-box">Not a git repository.</div>
      </section>`;
  }

  return `
    <section class="card">
      <h2>Git Context</h2>
      <div class="git-meta">
        ${gitContext.branch ? `<div><span class="text-muted">Branch:</span> <code>${esc(gitContext.branch)}</code></div>` : ""}
        ${gitContext.lastCommitHash ? `<div><span class="text-muted">Last commit:</span> <code>${esc(gitContext.lastCommitHash.slice(0, 8))}</code> ${esc(gitContext.lastCommitMessage ?? "")}</div>` : ""}
      </div>
      ${gitContext.diff ? `
        <details class="diff-details">
          <summary>View diff</summary>
          ${renderDiff(gitContext.diff)}
        </details>` : '<div class="text-muted">No uncommitted changes.</div>'}
    </section>`;
}

function renderPipelineDiagnostics(steps: PipelineStepResult[]): string {
  const totalMs = steps.reduce((sum, s) => sum + s.durationMs, 0);

  return `
    <section class="card">
      <h2>Pipeline <span class="text-muted">(${fmtDuration(totalMs)} total)</span></h2>
      <table class="pipeline-table">
        <thead>
          <tr><th>Step</th><th>Status</th><th>Duration</th></tr>
        </thead>
        <tbody>
          ${steps.map((s) => `
            <tr>
              <td>${humanCategory(s.step)}</td>
              <td>${stepStatusBadge(s.status, s.error)}</td>
              <td class="text-muted">${fmtDuration(s.durationMs)}</td>
            </tr>
          `).join("\n")}
        </tbody>
      </table>
    </section>`;
}

// ── CSS ──────────────────────────────────────────────────────────────

function css(): string {
  return `
    :root {
      --bg: #0d1117;
      --card: #161b22;
      --card-border: #30363d;
      --text: #e6edf3;
      --text2: #8b949e;
      --text3: #6e7681;
      --green: #3fb950;
      --red: #f85149;
      --yellow: #d29922;
      --blue: #58a6ff;
      --purple: #d2a8ff;
      --radius: 8px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      --mono: "SF Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, monospace;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 15px;
      line-height: 1.6;
      padding: 32px 16px;
    }

    .container { max-width: 960px; margin: 0 auto; }

    /* Header */
    .header { margin-bottom: 32px; }
    .header-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .brand { font-size: 1.5rem; font-weight: 700; }
    .logo { color: var(--blue); }
    .version { font-size: 0.75rem; color: var(--text2); font-weight: 400; margin-left: 8px; background: var(--card); padding: 2px 8px; border-radius: 12px; border: 1px solid var(--card-border); }
    .header-meta { color: var(--text2); font-size: 0.85rem; }
    .project-path { color: var(--text2); font-family: var(--mono); font-size: 0.8rem; }

    /* Cards */
    .card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 20px;
    }
    .card h2 {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--text);
    }

    /* Badges */
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 12px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .badge-pass { background: rgba(63,185,80,0.15); color: var(--green); }
    .badge-fail { background: rgba(248,81,73,0.15); color: var(--red); }
    .badge-total { background: rgba(139,148,158,0.15); color: var(--text2); }
    .badge-high { background: rgba(248,81,73,0.15); color: var(--red); }
    .badge-med { background: rgba(210,153,34,0.15); color: var(--yellow); }
    .badge-low { background: rgba(139,148,158,0.15); color: var(--text2); }

    /* Test summary */
    .test-meta { margin-bottom: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .test-meta code { font-family: var(--mono); font-size: 0.8rem; color: var(--text2); background: var(--bg); padding: 4px 8px; border-radius: 4px; }
    .summary-badges { display: flex; gap: 8px; margin-bottom: 12px; }
    .ratio-bar { height: 6px; background: rgba(248,81,73,0.3); border-radius: 3px; overflow: hidden; }
    .ratio-fill { height: 100%; background: var(--green); border-radius: 3px; transition: width 0.3s; }

    /* Failures */
    .failure { padding: 16px; background: var(--bg); border-radius: 6px; margin-bottom: 12px; border-left: 3px solid var(--red); }
    .failure:last-child { margin-bottom: 0; }
    .failure-header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .failure-num { color: var(--text3); font-weight: 600; font-size: 0.85rem; }
    .failure-msg { font-family: var(--mono); font-size: 0.9rem; color: var(--red); word-break: break-word; }
    .failure-test { font-size: 0.85rem; color: var(--text2); margin-bottom: 4px; }
    .failure-test code { font-family: var(--mono); font-size: 0.8rem; }

    /* Stack trace */
    .stack-trace { margin-top: 12px; }
    .stack-label { font-size: 0.75rem; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
    .stack-frame { font-family: var(--mono); font-size: 0.8rem; padding: 4px 0; color: var(--text2); }
    .stack-fn { color: var(--purple); }
    .stack-loc { color: var(--text3); }

    /* Root causes */
    .cause { padding: 16px; background: var(--bg); border-radius: 6px; margin-bottom: 12px; }
    .cause:last-child { margin-bottom: 0; }
    .cause-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .cause-num { color: var(--text3); font-weight: 600; font-size: 0.85rem; }
    .cause-cat { font-weight: 600; font-size: 1rem; }
    .cause-explanation { color: var(--text2); margin-bottom: 12px; }
    .cause-evidence { margin-bottom: 12px; }
    .cause-evidence ul { list-style: none; padding-left: 0; }
    .cause-evidence li { font-family: var(--mono); font-size: 0.8rem; color: var(--text2); padding: 2px 0; }
    .cause-evidence li::before { content: "→ "; color: var(--text3); }
    .suggested-fix {
      background: rgba(63,185,80,0.08);
      border: 1px solid rgba(63,185,80,0.25);
      border-radius: 6px;
      padding: 12px 16px;
    }
    .fix-label { font-size: 0.75rem; font-weight: 600; color: var(--green); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .suggested-fix p { color: var(--text); font-size: 0.9rem; }

    /* Code context */
    .snippet { margin-bottom: 12px; }
    .snippet:last-child { margin-bottom: 0; }
    .snippet summary {
      cursor: pointer;
      padding: 8px 12px;
      background: var(--bg);
      border-radius: 6px;
      font-size: 0.85rem;
      color: var(--text2);
      user-select: none;
    }
    .snippet summary:hover { color: var(--text); }
    .snippet summary code { font-family: var(--mono); color: var(--blue); font-size: 0.8rem; }
    .code-container {
      display: flex;
      margin-top: 8px;
      border-radius: 6px;
      overflow-x: auto;
      background: var(--bg);
      border: 1px solid var(--card-border);
    }
    .line-nums {
      padding: 12px 0;
      text-align: right;
      user-select: none;
      border-right: 1px solid var(--card-border);
      font-family: var(--mono);
      font-size: 0.8rem;
      line-height: 1.5;
      color: var(--text3);
      flex-shrink: 0;
    }
    .line-nums .ln { display: block; padding: 0 12px; }
    .line-nums .ln-err { background: rgba(248,81,73,0.15); color: var(--red); }
    .code-block {
      padding: 12px 16px;
      font-family: var(--mono);
      font-size: 0.8rem;
      line-height: 1.5;
      overflow-x: auto;
      flex: 1;
      min-width: 0;
    }
    .code-line { display: block; }
    .code-line-err { background: rgba(248,81,73,0.1); display: block; margin: 0 -16px; padding: 0 16px; }

    /* Syntax highlighting */
    .hl-kw { color: #ff7b72; }
    .hl-string { color: #a5d6ff; }
    .hl-comment { color: var(--text3); font-style: italic; }
    .hl-num { color: #79c0ff; }

    /* External evidence */
    .evidence-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 640px) { .evidence-grid { grid-template-columns: 1fr; } }
    .evidence-card {
      display: block;
      text-decoration: none;
      background: var(--bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 14px;
      transition: border-color 0.15s;
    }
    .evidence-card:hover { border-color: var(--blue); }
    .evidence-title { color: var(--blue); font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; }
    .evidence-url { color: var(--text3); font-size: 0.7rem; font-family: var(--mono); margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .evidence-snippet { color: var(--text2); font-size: 0.8rem; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

    /* Git context */
    .git-meta { margin-bottom: 12px; }
    .git-meta div { margin-bottom: 4px; font-size: 0.9rem; }
    .git-meta code { font-family: var(--mono); font-size: 0.8rem; color: var(--blue); }
    .diff-details summary { cursor: pointer; color: var(--text2); font-size: 0.85rem; padding: 8px 0; user-select: none; }
    .diff-details summary:hover { color: var(--text); }
    .diff-block { font-size: 0.75rem; line-height: 1.4; }
    .diff-add { color: var(--green); }
    .diff-del { color: var(--red); }
    .diff-range { color: var(--blue); }

    /* Pipeline table */
    .pipeline-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .pipeline-table th { text-align: left; color: var(--text3); font-weight: 500; padding: 6px 12px; border-bottom: 1px solid var(--card-border); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .pipeline-table td { padding: 6px 12px; border-bottom: 1px solid rgba(48,54,61,0.5); }
    .step-ok { color: var(--green); font-weight: 600; font-size: 0.8rem; }
    .step-skip { color: var(--text3); font-size: 0.8rem; }
    .step-fail { color: var(--red); font-weight: 600; font-size: 0.8rem; }
    .step-err { color: var(--text3); font-size: 0.75rem; }

    /* Utility */
    .text-muted { color: var(--text2); }
    .info-box { background: var(--bg); border: 1px solid var(--card-border); border-radius: 6px; padding: 12px 16px; color: var(--text2); font-size: 0.9rem; }
    .info-box code { font-family: var(--mono); font-size: 0.8rem; color: var(--yellow); }

    /* Footer */
    .footer { text-align: center; color: var(--text3); font-size: 0.8rem; padding: 24px 0 8px; }
    .footer a { color: var(--blue); text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
  `;
}

// ── Main export ──────────────────────────────────────────────────────

export function renderHtmlReport(packet: DebugPacket): string {
  const jsonEmbed = escJsonEmbed(JSON.stringify(packet));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TraceGen Debug Report</title>
  <style>${css()}</style>
</head>
<body>
  <div class="container">
    ${renderHeader(packet)}
    ${renderTestSummary(packet)}
    ${renderFailures(packet)}
    ${renderRootCauses(packet)}
    ${renderCodeContext(packet)}
    ${renderExternalEvidence(packet)}
    ${renderGitContext(packet)}
    ${renderPipelineDiagnostics(packet.metadata.analysisSteps)}
    <div class="footer">
      Generated by <a href="https://github.com/tracegen/tracegen">TraceGen</a>
    </div>
  </div>
  <script id="debug-packet" type="application/json">${jsonEmbed}</script>
</body>
</html>`;
}
