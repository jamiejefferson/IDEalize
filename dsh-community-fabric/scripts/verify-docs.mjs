import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const fail = message => { throw new Error(`verify-fabric-docs: ${message}`) }
const read = path => readFileSync(resolve(packageRoot, path), 'utf8')
const manifest = JSON.parse(read('package.json'))

if (manifest.name !== 'dsh-community-fabric') fail('package name must remain dsh-community-fabric')
if (manifest.private !== true) fail('the Draft scaffold must stay private until a reviewed runtime exists')
for (const field of ['main', 'module', 'types', 'exports', 'bin', 'dsh', 'dependencies', 'optionalDependencies']) {
  if (manifest[field] !== undefined) fail(`documentation scaffold must not declare ${field}`)
}

const publicFiles = [
  'LICENSE',
  'README.md',
  'docs/architecture/compatibility-layer.md',
  'docs/research/dsh-plugin-needs.md',
  'docs/research/community-issue-23-review.md',
  'docs/research/mature-plugin-frameworks.md',
  'docs/research/vscode-extension-model.md',
  'docs/rfcs/0001-plugin-manifest-capabilities-events.md',
  'docs/rfcs/0002-runtime-presentation-invocation-transport.md',
  'docs/rfcs/0003-service-providers-and-composition.md',
  'docs/rfcs/0004-provenance-validation-and-diagnostics.md',
]
for (const path of [...publicFiles, 'scripts/verify-docs.mjs']) {
  if (!existsSync(resolve(packageRoot, path))) fail(`${path} is missing`)
}

const discoverDocs = (directory, prefix) => {
  const paths = []
  for (const entry of readdirSync(resolve(packageRoot, directory), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) paths.push(...discoverDocs(path, path))
    else if (path.endsWith('.md')) paths.push(path)
  }
  return paths
}
const discoveredDocs = [
  ...readdirSync(packageRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name),
  ...discoverDocs('docs', 'docs'),
].sort()
const declaredDocs = publicFiles.filter(path => path.endsWith('.md')).sort()
if (JSON.stringify(discoveredDocs) !== JSON.stringify(declaredDocs)) {
  fail(`documentation inventory differs: declared=${declaredDocs.join(',')} discovered=${discoveredDocs.join(',')}`)
}

const expectedFiles = ['docs/**', 'LICENSE', 'README.md']
if (JSON.stringify(manifest.files) !== JSON.stringify(expectedFiles)) {
  fail('package files must contain only the reviewed documentation surface')
}

const markdownFiles = publicFiles.filter(path => path.endsWith('.md'))
for (const path of markdownFiles) {
  const source = read(path)
  for (const match of source.matchAll(/\]\(([^)]+)\)/gu)) {
    const target = match[1].trim().replace(/^<|>$/gu, '')
    if (/^(?:https?:|mailto:|#)/u.test(target)) continue
    const localPath = decodeURIComponent(target.split('#', 1)[0])
    if (!localPath) continue
    if (!existsSync(resolve(packageRoot, dirname(path), localPath))) {
      fail(`${path} links to missing ${localPath}`)
    }
  }
}

process.stdout.write(`verify-fabric-docs: ${markdownFiles.length} Markdown files are consistent\n`)
