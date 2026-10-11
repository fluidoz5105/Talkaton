import {
  ApiError,
  authenticateUser,
  prepareApiRequest,
  readJsonBody,
  requireString,
  sendApiError
} from "./_platform-auth.js";
import { getGitHubConnection, githubApiRequest, validateRepositoryPart } from "./_github.js";

const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 2_000_000;

export default async function handler(req, res) {
  try {
    if (!prepareApiRequest(req, res, ["GET", "POST"])) return;
    const { user } = await authenticateUser(req);
    const action = String(req.query?.action || "repositories").trim().toLowerCase();

    if (action === "repositories") {
      requireMethod(req, "GET");
      return await listRepositories(req, res, user.id);
    }
    if (action === "tree") {
      requireMethod(req, "GET");
      return await loadRepositoryTree(req, res, user.id);
    }
    if (action === "pull-request") {
      requireMethod(req, "POST");
      return await createPullRequest(req, res, user.id);
    }
    throw new ApiError(400, "GitHub action is invalid.", "VALIDATION_FAILED");
  } catch (error) {
    return sendApiError(res, error, "GitHub request failed.");
  }
}

async function listRepositories(req, res, userId) {
  const connection = await getGitHubConnection(userId);
  const page = clampInteger(req.query?.page, 1, 10, 1);
  const perPage = clampInteger(req.query?.perPage, 1, 100, 50);
  const repos = await githubApiRequest(
    `/user/repos?sort=updated&direction=desc&affiliation=owner,collaborator,organization_member&per_page=${perPage}&page=${page}`,
    connection.accessToken
  );
  return res.status(200).json({
    repositories: (Array.isArray(repos) ? repos : []).map(repo => ({
      id: repo.id,
      owner: repo.owner?.login,
      name: repo.name,
      fullName: repo.full_name,
      private: Boolean(repo.private),
      defaultBranch: repo.default_branch,
      permissions: repo.permissions || null,
      updatedAt: repo.updated_at,
      url: repo.html_url
    })),
    page,
    perPage
  });
}

async function loadRepositoryTree(req, res, userId) {
  const owner = validateRepositoryPart(req.query?.owner, "Repository owner");
  const repo = validateRepositoryPart(req.query?.repo, "Repository name");
  const ref = String(req.query?.ref || "HEAD").trim();
  if (!/^[A-Za-z0-9_./-]{1,200}$/.test(ref) || ref.includes("..")) {
    throw new ApiError(400, "Git reference is invalid.", "VALIDATION_FAILED");
  }
  const connection = await getGitHubConnection(userId);
  const tree = await githubApiRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    connection.accessToken
  );
  const entries = (Array.isArray(tree?.tree) ? tree.tree : [])
    .slice(0, 20_000)
    .map(entry => ({
      path: entry.path,
      type: entry.type,
      mode: entry.mode,
      sha: entry.sha,
      size: Number.isFinite(entry.size) ? entry.size : null,
      url: entry.url
    }));
  return res.status(200).json({ sha: tree.sha, truncated: Boolean(tree.truncated), entries });
}

async function createPullRequest(req, res, userId) {
  const body = await readJsonBody(req, { maxBytes: MAX_TOTAL_BYTES + 100_000 });
  const owner = validateRepositoryPart(body.owner, "Repository owner");
  const repo = validateRepositoryPart(body.repo, "Repository name");
  const base = validateGitRef(body.base || "main", "Base branch");
  const branch = validateGitRef(body.branch, "Proposal branch");
  const title = requireString(body.title, "Pull request title", { min: 3, max: 240 });
  const description = requireString(body.description, "Pull request description", { min: 1, max: 10_000 });
  const commitMessage = requireString(body.commitMessage || title, "Commit message", { min: 3, max: 240 });
  const files = validateFiles(body.files);

  const connection = await getGitHubConnection(userId);
  const token = connection.accessToken;
  const root = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const baseRef = await githubApiRequest(`${root}/git/ref/heads/${encodeURIComponent(base)}`, token);
  const baseCommitSha = baseRef?.object?.sha;
  if (!baseCommitSha) throw new ApiError(502, "GitHub did not return the base commit.", "GITHUB_REQUEST_FAILED");
  const baseCommit = await githubApiRequest(`${root}/git/commits/${baseCommitSha}`, token);

  const treeItems = [];
  for (const file of files) {
    const blob = await githubApiRequest(`${root}/git/blobs`, token, {
      method: "POST",
      body: JSON.stringify({ content: file.content, encoding: "utf-8" })
    });
    treeItems.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const tree = await githubApiRequest(`${root}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeItems })
  });
  const commit = await githubApiRequest(`${root}/git/commits`, token, {
    method: "POST",
    body: JSON.stringify({ message: commitMessage, tree: tree.sha, parents: [baseCommitSha] })
  });
  await githubApiRequest(`${root}/git/refs`, token, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha })
  });

  let pull;
  try {
    pull = await githubApiRequest(`${root}/pulls`, token, {
      method: "POST",
      body: JSON.stringify({ title, body: description, head: branch, base, draft: body.draft !== false })
    });
  } catch (error) {
    try {
      await githubApiRequest(`${root}/git/refs/heads/${encodeURIComponent(branch)}`, token, { method: "DELETE" });
    } catch (cleanupError) {
      console.error("GitHub proposal branch cleanup failed:", cleanupError?.message || cleanupError);
    }
    throw error;
  }

  return res.status(201).json({
    pullRequest: {
      id: pull.id,
      number: pull.number,
      state: pull.state,
      draft: Boolean(pull.draft),
      url: pull.html_url,
      branch,
      base
    }
  });
}

function requireMethod(req, expected) {
  if (String(req.method || "").toUpperCase() !== expected) {
    throw new ApiError(405, `Use ${expected} for this GitHub action.`, "METHOD_NOT_ALLOWED");
  }
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function validateGitRef(value, label) {
  const ref = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(ref)
    || ref.includes("..")
    || ref.includes("@{")
    || ref.endsWith(".")
    || ref.endsWith("/")) {
    throw new ApiError(400, `${label} is invalid.`, "VALIDATION_FAILED");
  }
  return ref;
}

function validateFiles(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) {
    throw new ApiError(400, `Include between 1 and ${MAX_FILES} files.`, "VALIDATION_FAILED");
  }
  let totalBytes = 0;
  const paths = new Set();
  return value.map(file => {
    const path = String(file?.path || "").trim();
    const content = typeof file?.content === "string" ? file.content : "";
    if (!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_@+.,()\[\]{} -]+(?:\/[A-Za-z0-9_@+.,()\[\]{} -]+)*$/.test(path)
      || path.length > 500
      || paths.has(path)) {
      throw new ApiError(400, "Each proposed file needs a unique, safe repository path.", "VALIDATION_FAILED");
    }
    paths.add(path);
    totalBytes += Buffer.byteLength(content, "utf8");
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ApiError(413, "The proposed files exceed the 2 MB request limit.", "BODY_TOO_LARGE");
    }
    return { path, content };
  });
}
