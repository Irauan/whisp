/**
 * The variables of Aether's own environment that an agent process may get (architecture, Agent
 * environment). The list holds what a program needs to run on Windows, the proxy settings and the
 * certificate settings. It holds no Claude, Anthropic, GH or GitHub variable: Aether sets those
 * itself, from the settings of the provider and the GitHub account of the profile.
 */
export const ALLOWED_VARIABLES: readonly string[] = [
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'PATH',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'USERNAME',
  'USERDOMAIN',
  'COMPUTERNAME',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'LANG',
  'LC_ALL',
  'TZ',
  'TERM',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS'
]

const ALLOWED = new Set(ALLOWED_VARIABLES.map((name) => name.toLowerCase()))

/**
 * The part of an environment that an agent process may get. Names match without case, as on
 * Windows. A variable without a value is skipped. The result keeps the name of the source.
 */
export function allowedEnvironment(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && ALLOWED.has(name.toLowerCase())) result[name] = value
  }
  return result
}
