// Fixture for G4: raw HTML in renderer code.
export function Raw({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
