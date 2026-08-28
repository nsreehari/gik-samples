import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function resolveAzureCliCommand(env) {
  const override = typeof env.AZURE_CLI_COMMAND === 'string' ? env.AZURE_CLI_COMMAND.trim() : '';
  if (override) {
    return override;
  }

  if (process.platform !== 'win32') {
    return 'az';
  }

  const candidates = [
    env['ProgramFiles(x86)']
      ? path.join(env['ProgramFiles(x86)'], 'Microsoft SDKs', 'Azure', 'CLI2', 'wbin', 'az.cmd')
      : '',
    env.ProgramFiles
      ? path.join(env.ProgramFiles, 'Microsoft SDKs', 'Azure', 'CLI2', 'wbin', 'az.cmd')
      : '',
    env.LocalAppData
      ? path.join(env.LocalAppData, 'Programs', 'Azure CLI', 'wbin', 'az.cmd')
      : '',
    'az.cmd',
  ].filter(Boolean);

  return candidates.find((candidate) => path.isAbsolute(candidate) && fs.existsSync(candidate)) || candidates[0];
}

export function runAzureCli(commandArgs, { inherit = false, env = process.env } = {}) {
  const command = resolveAzureCliCommand(env);

  if (process.platform === 'win32') {
    return execFileSync(env.ComSpec || 'cmd.exe', ['/d', '/c', command, ...commandArgs], {
      encoding: 'utf-8',
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: !inherit,
    });
  }

  return execFileSync(command, commandArgs, {
    encoding: 'utf-8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    windowsHide: !inherit,
  });
}