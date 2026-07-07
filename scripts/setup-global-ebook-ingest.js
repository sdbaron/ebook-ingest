const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const isWindows = process.platform === 'win32';
const commandName = 'ebook-ingest';

// ── helper ────────────────────────────────────────────────────────────────

const runCommand = (command, args, options = {}) => {
  const { allowFailure = false, captureOutput = false, explanation } = options;

  if (explanation) {
    console.log(explanation);
  }

  const result = spawnSync(command, args, {
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: captureOutput ? 'utf8' : undefined,
    shell: false,
  });

  if (result.error) {
    if (allowFailure) {
      return result;
    }
    throw result.error;
  }

  if (!allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
};

const runPnpm = (args, options = {}) => {
  if (isWindows) {
    return runCommand('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], options);
  }
  return runCommand('pnpm', args, options);
};

const normalizePathForCompare = value =>
  path
    .normalize(value)
    .replace(/[\\/]+$/, '')
    .toLowerCase();

const splitPath = value =>
  value
    .split(path.delimiter)
    .map(item => item.trim())
    .filter(Boolean);

const pathContainsEntry = (pathValue, entry) => {
  const normalizedEntry = normalizePathForCompare(entry);
  return splitPath(pathValue).some(
    item => normalizePathForCompare(item) === normalizedEntry,
  );
};

const writeFile = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
};

// ── pnpm home ─────────────────────────────────────────────────────────────

const resolvePnpmHome = () => {
  if (process.env.PNPM_HOME && process.env.PNPM_HOME.trim() !== '') {
    return process.env.PNPM_HOME.trim();
  }

  const result = runPnpm(['bin', '--global'], {
    allowFailure: true,
    captureOutput: true,
  });

  if (result.status === 0 && result.stdout) {
    const candidate = result.stdout.trim();
    if (candidate) {
      return candidate;
    }
  }

  if (isWindows && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'pnpm');
  }

  return null;
};

// ── CLI entry point ───────────────────────────────────────────────────────

const ensureCliBuildExists = () => {
  const cliEntryPoint = path.resolve(__dirname, '..', 'dist', 'cli.js');
  if (!fs.existsSync(cliEntryPoint)) {
    console.error(
      `[global:${commandName}] Missing build output: ${cliEntryPoint}`,
    );
    process.exit(1);
  }
  return cliEntryPoint;
};

// ── shims ─────────────────────────────────────────────────────────────────

const writeWindowsShims = (pnpmHome, cliEntryPoint) => {
  const escapedForCmd = cliEntryPoint.replace(/"/g, '""');
  const escapedForPowerShell = cliEntryPoint.replace(/'/g, "''");

  const cmdShim =
    '@ECHO OFF\r\n' +
    'SETLOCAL\r\n' +
    `SET "TARGET=${escapedForCmd}"\r\n` +
    'IF NOT EXIST "%TARGET%" (\r\n' +
    `  ECHO [global:${commandName}] Target script not found: %TARGET%\r\n` +
    '  EXIT /B 1\r\n' +
    ')\r\n' +
    'node "%TARGET%" %*\r\n';

  const psShim =
    `$Target = '${escapedForPowerShell}'\n` +
    'if (-not (Test-Path $Target)) {\n' +
    `  Write-Error '[global:${commandName}] Target script not found: ' + $Target\n` +
    '  exit 1\n' +
    '}\n' +
    '& node $Target @args\n';

  const shimDirs = [pnpmHome, path.join(pnpmHome, 'bin')];
  for (const shimDir of shimDirs) {
    writeFile(path.join(shimDir, `${commandName}.CMD`), cmdShim);
    writeFile(path.join(shimDir, `${commandName}.ps1`), psShim);
  }

  console.log(
    `Wrote Windows shims in ${pnpmHome} and ${path.join(pnpmHome, 'bin')}.`,
  );
};

const writePosixShims = (pnpmHome, cliEntryPoint) => {
  const escapedTarget = cliEntryPoint.replace(/'/g, "'\\''");
  const shShim =
    '#!/usr/bin/env sh\n' +
    `TARGET='${escapedTarget}'\n` +
    'if [ ! -f "$TARGET" ]; then\n' +
    `  echo "[global:${commandName}] Target script not found: $TARGET" >&2\n` +
    '  exit 1\n' +
    'fi\n' +
    'exec node "$TARGET" "$@"\n';

  const shimDirs = [pnpmHome, path.join(pnpmHome, 'bin')];
  for (const shimDir of shimDirs) {
    const shimPath = path.join(shimDir, commandName);
    writeFile(shimPath, shShim);
    fs.chmodSync(shimPath, 0o755);
  }

  console.log(
    `Wrote POSIX shims in ${pnpmHome} and ${path.join(pnpmHome, 'bin')}.`,
  );
};

// ── PATH ──────────────────────────────────────────────────────────────────

const ensureWindowsUserPathIncludes = pnpmHome => {
  const currentProcessPath = process.env.Path ?? process.env.PATH ?? '';
  if (!pathContainsEntry(currentProcessPath, pnpmHome)) {
    const updatedPath = currentProcessPath
      ? `${pnpmHome}${path.delimiter}${currentProcessPath}`
      : pnpmHome;
    process.env.Path = updatedPath;
    process.env.PATH = updatedPath;
  }

  const escapedPnpmHome = pnpmHome.replace(/'/g, "''");
  const powershellScript = [
    `$pnpmHome='${escapedPnpmHome}'`,
    "$userPath=[Environment]::GetEnvironmentVariable('Path','User')",
    "if (-not $userPath) { $userPath = '' }",
    "$parts=@($userPath -split ';' | Where-Object { $_ -and $_.Trim() -ne '' })",
    '$exists=$false',
    'foreach($part in $parts){ if($part.Trim().ToLower() -eq $pnpmHome.Trim().ToLower()){ $exists=$true; break } }',
    'if(-not $exists){',
    "  $newPath = (@($parts + $pnpmHome) -join ';')",
    "  [Environment]::SetEnvironmentVariable('Path',$newPath,'User')",
    '  Write-Host "Added PNPM_HOME to user PATH: $pnpmHome"',
    '} else {',
    '  Write-Host "PNPM_HOME already present in user PATH: $pnpmHome"',
    '}',
    "[Environment]::SetEnvironmentVariable('PNPM_HOME',$pnpmHome,'User')",
  ].join(';');

  runCommand(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', powershellScript],
    { allowFailure: true },
  );
};

// ── verify ────────────────────────────────────────────────────────────────

const verifyGlobalCommand = pnpmHome => {
  const whichCommand = isWindows ? 'where' : 'which';
  const lookupResult = runCommand(whichCommand, [commandName], {
    allowFailure: true,
    captureOutput: true,
  });

  if (
    lookupResult.status === 0 &&
    lookupResult.stdout &&
    lookupResult.stdout.trim() !== ''
  ) {
    console.log('Global command available:');
    console.log(lookupResult.stdout.trim());
    return;
  }

  if (isWindows) {
    const fallbackShim = path.join(pnpmHome, `${commandName}.CMD`);
    if (fs.existsSync(fallbackShim)) {
      console.log(
        'Global shim created but not resolvable in current shell PATH.',
      );
      console.log(`Use fallback command path: ${fallbackShim}`);
      return;
    }
  }

  const shimFileName = isWindows ? `${commandName}.CMD` : commandName;
  const fallbackShims = [
    path.join(pnpmHome, shimFileName),
    path.join(pnpmHome, 'bin', shimFileName),
  ];
  const existingFallbackShims = fallbackShims.filter(candidate =>
    fs.existsSync(candidate),
  );

  console.warn(
    'Global command could not be resolved automatically in the current shell PATH.',
  );
  console.warn(
    `Add PNPM_HOME to PATH and re-open the terminal. PNPM_HOME: ${pnpmHome}`,
  );

  if (existingFallbackShims.length > 0) {
    console.warn('Detected shim path(s):');
    for (const shimPath of existingFallbackShims) {
      console.warn(`  - ${shimPath}`);
    }
  }

  if (!isWindows) {
    console.warn('PATH fallback (POSIX shells):');
    console.warn(`  export PNPM_HOME="${pnpmHome}"`);
    console.warn('  export PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"');
  }
};

// ── main ──────────────────────────────────────────────────────────────────

const main = () => {
  console.log(`Preparing global ${commandName} command…`);

  runPnpm(['setup'], {
    allowFailure: true,
    explanation: 'Running pnpm setup (best effort)…',
  });

  const buildResult = runPnpm(['build'], {
    allowFailure: true,
    explanation: 'Building ebook-ingest…',
  });

  if (buildResult.status !== 0) {
    console.warn(
      'Build step failed. Continuing with existing dist output if available.',
    );
  }

  const cliEntryPoint = ensureCliBuildExists();

  const pnpmHome = resolvePnpmHome();
  if (!pnpmHome) {
    console.error(
      'Could not resolve PNPM_HOME. Global shim creation aborted.',
    );
    process.exit(1);
  }

  console.log(`Detected PNPM_HOME: ${pnpmHome}`);

  if (isWindows) {
    writeWindowsShims(pnpmHome, cliEntryPoint);
    ensureWindowsUserPathIncludes(pnpmHome);
  } else {
    writePosixShims(pnpmHome, cliEntryPoint);
  }

  verifyGlobalCommand(pnpmHome);
  console.log('Done.');
};

main();
