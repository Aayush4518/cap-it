import { useState, type FormEvent } from "react";

type HeaderRow = { id: string; name: string; value: string };
type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ApiTarget = "api1" | "api2";
type RequestResult = {
  id: string;
  method: RequestMethod;
  url: string;
  finishedAt: string;
  status: number | null;
  statusText: string;
  durationMs: number;
  body: string;
  error: string | null;
  rateLimit: { limit: string | null; remaining: string | null; retryAfter: string | null; requestId: string | null };
};

const apiTargets: Record<ApiTarget, { label: string; base: string }> = {
  api1: { label: "API instance 1 · :3000", base: "/api/api1" },
  api2: { label: "API instance 2 · :3002", base: "/api/api2" },
};
const methods: RequestMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const batchSizes = [1, 3, 5, 10];

function newRowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readResponseBody(raw: string) {
  if (!raw) return "(empty response body)";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function PlaygroundPage() {
  const [method, setMethod] = useState<RequestMethod>("GET");
  const [path, setPath] = useState("/demo");
  const [target, setTarget] = useState<ApiTarget>("api1");
  const [apiKey, setApiKey] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [body, setBody] = useState('{\n  "message": "hello from Cap-It"\n}');
  const [batchSize, setBatchSize] = useState(1);
  const [isSending, setIsSending] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [results, setResults] = useState<RequestResult[]>([]);
  const [bodyCopied, setBodyCopied] = useState(false);

  const canHaveBody = method !== "GET";
  const latest = results[0];

  async function sendRequest(requestUrl: string, requestHeaders: Headers, requestBody: string | undefined) {
    const startedAt = performance.now();
    try {
      const response = await fetch(requestUrl, {
        method,
        headers: requestHeaders,
        ...(requestBody === undefined ? {} : { body: requestBody }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const rawBody = await response.text();
      return {
        id: newRowId(), method, url: requestUrl, finishedAt: new Date().toISOString(),
        status: response.status, statusText: response.statusText, durationMs: performance.now() - startedAt,
        body: readResponseBody(rawBody), error: null,
        rateLimit: {
          limit: response.headers.get("ratelimit-limit"),
          remaining: response.headers.get("ratelimit-remaining"),
          retryAfter: response.headers.get("retry-after"),
          requestId: response.headers.get("x-request-id"),
        },
      } satisfies RequestResult;
    } catch (error) {
      return {
        id: newRowId(), method, url: requestUrl, finishedAt: new Date().toISOString(),
        status: null, statusText: "Network error", durationMs: performance.now() - startedAt,
        body: "", error: error instanceof Error ? error.message : "The request could not be completed.",
        rateLimit: { limit: null, remaining: null, retryAfter: null, requestId: null },
      } satisfies RequestResult;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    const trimmedPath = path.trim();
    if (!trimmedPath.startsWith("/") || trimmedPath.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(trimmedPath)) {
      setValidationError("Enter a path on this API, for example /demo.");
      return;
    }

    let requestBody: string | undefined;
    if (canHaveBody && body.trim()) {
      try {
        requestBody = JSON.stringify(JSON.parse(body));
      } catch {
        setValidationError("The request body must be valid JSON.");
        return;
      }
    }

    const requestHeaders = new Headers();
    try {
      for (const header of headers) {
        if (header.name.trim()) requestHeaders.set(header.name.trim(), header.value);
      }
      if (apiKey.trim()) requestHeaders.set("x-api-key", apiKey.trim());
      if (requestBody !== undefined && !requestHeaders.has("content-type")) {
        requestHeaders.set("content-type", "application/json");
      }
    } catch {
      setValidationError("One of the custom header names or values is invalid.");
      return;
    }

    const requestUrl = `${apiTargets[target].base}${trimmedPath}`;
    setIsSending(true);
    const batchResults = await Promise.all(
      Array.from({ length: batchSize }, () => sendRequest(requestUrl, requestHeaders, requestBody)),
    );
    setResults((current) => [...batchResults.reverse(), ...current].slice(0, 30));
    setIsSending(false);
  }

  function updateHeader(id: string, field: "name" | "value", value: string) {
    setHeaders((current) => current.map((header) => header.id === id ? { ...header, [field]: value } : header));
  }

  async function copyResponseBody() {
    if (!latest) return;
    try {
      await navigator.clipboard.writeText(latest.body);
      setBodyCopied(true);
      window.setTimeout(() => setBodyCopied(false), 1400);
    } catch {
      setValidationError("Clipboard access is unavailable in this browser.");
    }
  }

  return (
    <div className="overview-page playground-page">
      <div className="page-heading">
        <div>
          <span className="section-kicker">REQUEST WORKBENCH</span>
          <h1>Playground</h1>
          <p className="page-subtitle">Send real requests to a Cap-It API instance and inspect its rate-limit response.</p>
        </div>
      </div>

      <div className="playground-layout">
        <form className="panel request-panel" onSubmit={handleSubmit}>
          <div className="panel-heading">
            <div><h2>Request</h2><p>Credentials stay in this tab and are sent only with your request.</p></div>
            <span className="workbench-mark" aria-hidden="true">{method}</span>
          </div>

          <div className="request-line">
            <label className="field-group method-field">
              <span>Method</span>
              <select value={method} onChange={(event) => setMethod(event.target.value as RequestMethod)}>
                {methods.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="field-group endpoint-field">
              <span>Endpoint path</span>
              <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/demo" spellCheck={false} />
            </label>
            <label className="field-group target-field">
              <span>Instance</span>
              <select value={target} onChange={(event) => setTarget(event.target.value as ApiTarget)}>
                {(Object.entries(apiTargets) as [ApiTarget, typeof apiTargets[ApiTarget]][]).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
              </select>
            </label>
          </div>

          <label className="field-group api-key-field">
            <span>API key <small>Optional</small></span>
            <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Enter the key configured for this API" />
            <small className="field-help">Sent as the <code>x-api-key</code> header. It is not saved.</small>
          </label>

          <details className="custom-headers">
            <summary>Custom headers <span>{headers.filter((header) => header.name.trim()).length || "None"}</span></summary>
            <div className="custom-header-list">
              {headers.map((header) => (
                <div className="custom-header-row" key={header.id}>
                  <input aria-label="Header name" value={header.name} onChange={(event) => updateHeader(header.id, "name", event.target.value)} placeholder="Header name" />
                  <input aria-label="Header value" value={header.value} onChange={(event) => updateHeader(header.id, "value", event.target.value)} placeholder="Value" />
                  <button className="icon-button" type="button" aria-label="Remove header" onClick={() => setHeaders((current) => current.filter((item) => item.id !== header.id))}>×</button>
                </div>
              ))}
              <button className="text-button" type="button" onClick={() => setHeaders((current) => [...current, { id: newRowId(), name: "", value: "" }])}>+ Add header</button>
            </div>
          </details>

          <label className={`field-group body-field${canHaveBody ? "" : " is-disabled"}`}>
            <span>JSON body <small>{canHaveBody ? "Optional" : "Not sent with this method"}</small></span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={!canHaveBody} spellCheck={false} rows={6} />
          </label>

          <div className="playground-footer">
            <label className="field-group burst-field"><span>Requests</span><select value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))}>{batchSizes.map((size) => <option key={size} value={size}>{size === 1 ? "One request" : `${size} in parallel`}</option>)}</select></label>
            <button className="send-button" type="submit" disabled={isSending}>
              {isSending ? <><span className="send-spinner" aria-hidden="true" />Sending {batchSize === 1 ? "request" : `${batchSize} requests`}…</> : <><span aria-hidden="true">↑</span> Send {batchSize === 1 ? "request" : `${batchSize} requests`}</>}
            </button>
          </div>
          {validationError && <p className="playground-validation" role="alert">{validationError}</p>}
          <p className="backend-capability-note"><strong>Current API:</strong> <code>GET /demo</code> is implemented. Other methods are sent as selected and show the server’s response; this route does not currently process a request body.</p>
        </form>

        <section className="panel response-panel" aria-labelledby="response-title" aria-live="polite">
          <div className="panel-heading response-heading">
            <div><h2 id="response-title">Response</h2><p>{latest ? new Date(latest.finishedAt).toLocaleTimeString() : "Waiting for a request"}</p></div>
            {latest && <span className={`response-status ${latest.status === 429 ? "is-limited" : latest.status && latest.status >= 200 && latest.status < 300 ? "is-success" : "is-error"}`}>{latest.status ?? "ERR"} {latest.statusText}</span>}
          </div>
          {latest ? (
            <>
              <div className="response-meta"><span>{latest.method} <code>{latest.url.replace(/^\/api\/api[12]/, "")}</code></span><span>{latest.durationMs.toFixed(1)} ms</span></div>
              {latest.error ? <div className="response-network-error"><strong>Request failed</strong><p>{latest.error}</p><small>Check that the API container is running and the selected port is reachable.</small></div> : (
                <>
                  <div className="response-limits" aria-label="Rate-limit response headers">
                    <div><span>Limit</span><strong>{latest.rateLimit.limit ?? "—"}</strong></div>
                    <div><span>Remaining</span><strong>{latest.rateLimit.remaining ?? "—"}</strong></div>
                    <div><span>Retry after</span><strong>{latest.rateLimit.retryAfter ? `${latest.rateLimit.retryAfter}s` : "—"}</strong></div>
                  </div>
                  {latest.rateLimit.requestId && <div className="request-id-line">Request ID <code>{latest.rateLimit.requestId}</code></div>}
                  <div className="response-body-heading"><span>Response body</span><button className="text-button" type="button" onClick={() => void copyResponseBody()}>{bodyCopied ? "Copied" : "Copy"}</button></div>
                  <pre className="response-body"><code>{latest.body}</code></pre>
                </>
              )}
            </>
          ) : <div className="response-empty"><span className="response-empty-symbol" aria-hidden="true">↗</span><strong>Your response will appear here</strong><p>Send a request to see its status, timing, rate-limit headers, and body.</p></div>}
        </section>
      </div>

      <section className="panel request-history-panel" aria-labelledby="request-history-title">
        <div className="panel-heading"><div><h2 id="request-history-title">Recent responses</h2><p>Kept in this page for this visit only</p></div>{results.length > 0 && <button className="text-button" type="button" onClick={() => setResults([])}>Clear</button>}</div>
        {results.length === 0 ? <p className="history-empty">Requests you send will be listed here.</p> : (
          <div className="history-list">
            {results.map((result, index) => (
              <button className={`history-row${index === 0 ? " is-current" : ""}`} type="button" key={result.id} onClick={() => setResults((current) => [result, ...current.filter((item) => item.id !== result.id)])}>
                <span className={`history-status${result.status === 429 ? " is-limited" : result.status && result.status >= 200 && result.status < 300 ? " is-success" : " is-error"}`}>{result.status ?? "ERR"}</span>
                <span className="history-method">{result.method}</span>
                <span className="history-path">{result.url.replace(/^\/api\/api[12]/, "")}</span>
                <span className="history-time">{result.durationMs.toFixed(1)} ms</span>
                <span className="history-clock">{new Date(result.finishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default PlaygroundPage;
