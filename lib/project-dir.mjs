import fs from 'node:fs';

function firstWorkspaceRoot(input) {
  const [root] = Array.isArray(input?.workspace_roots) ? input.workspace_roots : [];
  return typeof root === 'string' && root ? root : null;
}

// Plugin hooks run from the plugin's own folder (stop from the workspace root), so the project is named by the
// environment and payload Cursor gives every hook rather than by the working directory.
export function projectDirOf(input, env = process.env) {
  const candidate = env.CURSOR_PROJECT_DIR || firstWorkspaceRoot(input) || process.cwd();
  try {
    return fs.realpathSync(candidate);
  } catch {
    return candidate;
  }
}
