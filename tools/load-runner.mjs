import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const host = process.env.LOAD_RUNNER_HOST ?? "127.0.0.1";
const port = Number(process.env.LOAD_RUNNER_PORT ?? 3100);
const projectRoot = process.cwd();
const scriptDirectory = resolve(projectRoot, "tests/load");
const allowedProfiles = new Set([
  "baseline.js",
  "medium.js",
  "heavy.js",
  "extreme.js",
  "extreme_distributed.js",
  "stress.js",
  "burst.js",
]);
const jobs = new Map();
let activeJobId = null;

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 8_192) throw new Error("Request body is too large.");
  }
  return JSON.parse(raw || "{}");
}

function pruneJobs() {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}

function startJob(profile, apiKey, target) {
  const id = randomUUID();
  const api1Url = process.env.API1_URL ?? "http://localhost:3000";
  const api2Url = process.env.API2_URL ?? "http://localhost:3002";
  const apiUrl = target === "api2" ? api2Url : api1Url;
  const job = {
    id,
    profile,
    status: "running",
    stdout: "",
    stderr: "",
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(id, job);
  activeJobId = id;

  const childProcess = spawn("k6", ["run", resolve(scriptDirectory, profile)], {
    cwd: projectRoot,
    shell: false,
    windowsHide: true,
    env: {
      ...globalThis.process.env,
      CAPIT_API_KEY: apiKey.trim(),
      API_URL: apiUrl,
      API1_URL: api1Url,
      API2_URL: api2Url,
    },
  });

  childProcess.stdout.setEncoding("utf8");
  childProcess.stderr.setEncoding("utf8");
  childProcess.stdout.on("data", (chunk) => { job.stdout = (job.stdout + chunk).slice(-120_000); });
  childProcess.stderr.on("data", (chunk) => { job.stderr = (job.stderr + chunk).slice(-30_000); });
  childProcess.on("error", (error) => {
    job.status = "failed";
    job.stderr += `${job.stderr ? "\n" : ""}${error.message}`;
    job.finishedAt = new Date().toISOString();
    activeJobId = null;
  });
  childProcess.on("close", (code) => {
    if (job.status === "running") job.status = code === 0 ? "passed" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    activeJobId = null;
  });

  job.process = childProcess;
  return job;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  pruneJobs();

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/jobs") {
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
      return;
    }

    const profile = body?.profile;
    const apiKey = body?.apiKey;
    const target = body?.target;
    if (typeof profile !== "string" || !allowedProfiles.has(profile)) {
      sendJson(response, 400, { error: "Choose one of the available load-test profiles." });
      return;
    }
    if (typeof apiKey !== "string" || apiKey.trim().length === 0 || apiKey.length > 512) {
      sendJson(response, 400, { error: "Enter the API key configured for the API instances." });
      return;
    }
    if (target !== "api1" && target !== "api2") {
      sendJson(response, 400, { error: "Choose an API instance." });
      return;
    }
    if (activeJobId) {
      sendJson(response, 409, { error: "A load test is already running. Wait for it to finish before starting another." });
      return;
    }

    const job = startJob(profile, apiKey, target);
    const { process: _process, ...publicJob } = job;
    sendJson(response, 202, publicJob);
    return;
  }

  const stopMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]+)\/stop$/i);
  const jobMatch = url.pathname.match(/^\/jobs\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "Load-test run not found." });
      return;
    }
    const { process: _process, ...publicJob } = job;
    sendJson(response, 200, publicJob);
    return;
  }

  if (request.method === "POST" && stopMatch) {
    const id = stopMatch[1];
    const job = jobs.get(id);
    if (!job || job.status !== "running" || !job.process) {
      sendJson(response, 404, { error: "There is no running load test with that ID." });
      return;
    }
    job.process.kill();
    sendJson(response, 202, { status: "stopping" });
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

server.listen(port, host, () => {
  console.log(`Cap-It local k6 runner listening on http://${host}:${port}`);
  console.log("Keep this process open while using Fire test in Playground.");
});
