import { delimiter, join } from 'node:path'

const windowsPowerShellModulePath = /(?:^|[\\/])WindowsPowerShell(?:[\\/]|$)/i

export function configureWindowsPowerShellEnvironment(): void {
  if (process.platform !== 'win32') return

  const windowsDirectory = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
  const modulePaths = [
    ...(process.env.PSModulePath ?? '').split(delimiter).filter((path) => windowsPowerShellModulePath.test(path)),
    join(windowsDirectory, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'WindowsPowerShell', 'Modules') : undefined,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Documents', 'WindowsPowerShell', 'Modules') : undefined
  ].filter((path): path is string => Boolean(path))

  process.env.PSModulePath = [...new Map(modulePaths.map((path) => [path.toLowerCase(), path])).values()].join(delimiter)
}
