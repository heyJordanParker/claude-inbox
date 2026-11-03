import bash from '@shikijs/langs/bash'
import css from '@shikijs/langs/css'
import go from '@shikijs/langs/go'
import html from '@shikijs/langs/html'
import javascript from '@shikijs/langs/javascript'
import json from '@shikijs/langs/json'
import jsx from '@shikijs/langs/jsx'
import markdown from '@shikijs/langs/markdown'
import php from '@shikijs/langs/php'
import python from '@shikijs/langs/python'
import rust from '@shikijs/langs/rust'
import sql from '@shikijs/langs/sql'
import toml from '@shikijs/langs/toml'
import tsx from '@shikijs/langs/tsx'
import typescript from '@shikijs/langs/typescript'
import yaml from '@shikijs/langs/yaml'
import githubDark from '@shikijs/themes/github-dark'
import githubLight from '@shikijs/themes/github-light'
import { renderMermaidSVGAsync } from 'beautiful-mermaid'
import { useEffect, useState, type ReactNode } from 'react'
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { changeCounts, changeWords, diagramKindOf, diffOf, diffRowsOf, lineRange, statsOf, treeOf, type Mark, type TreeRow } from '../../../src/items/drawings.js'
import { projectName, whereLine, type Change, type Diagram, type Drawing } from '../../../src/items/item.js'

export type OpenFile = (path: string, diff: string | undefined) => void

let highlighter: Promise<HighlighterCore> | undefined

function highlighterOf(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({ themes: [githubLight, githubDark], langs: [bash, css, go, html, javascript, json, jsx, markdown, php, python, rust, sql, toml, tsx, typescript, yaml], engine: createJavaScriptRegexEngine() })
  return highlighter
}

function languageOf(path: string): string | undefined {
  return path.split('.').at(-1)
}

type RowKind = 'add' | 'remove' | 'context' | 'meta'

type Row = { readonly kind: RowKind; readonly text: string; readonly number?: number }

function diffRows(diff: string): Row[] {
  const rows: Row[] = []
  let isInHunk = false
  let oldLine = 0
  let newLine = 0
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk !== null) {
      isInHunk = true
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      rows.push({ kind: 'meta', text: line })
    } else if (!isInHunk || line.startsWith('\\')) rows.push({ kind: 'meta', text: line })
    else if (line.startsWith('+')) rows.push({ kind: 'add', text: line.slice(1), number: newLine++ })
    else if (line.startsWith('-')) rows.push({ kind: 'remove', text: line.slice(1), number: oldLine++ })
    else rows.push({ kind: 'context', text: line.slice(1), number: (oldLine++, newLine++) })
  }
  return rows.at(-1)?.kind === 'meta' && rows.at(-1)?.text === '' ? rows.slice(0, -1) : rows
}

function plainRows(code: string, firstLine: number | undefined): Row[] {
  return code.split('\n').map((text, index) => ({ kind: 'context', text, ...(firstLine === undefined ? {} : { number: firstLine + index }) }))
}

function useTokens(rows: readonly Row[], language: string | undefined): readonly (readonly ThemedToken[])[] | undefined {
  const [tokens, setTokens] = useState<readonly (readonly ThemedToken[])[] | undefined>(undefined)
  const lang = language?.toLowerCase()
  const code = rows.filter((row) => row.kind !== 'meta').map((row) => row.text).join('\n')
  useEffect(() => {
    setTokens(undefined)
    if (lang === undefined) return
    let isCurrent = true
    void highlighterOf().then((ready) => {
      if (isCurrent && ready.getLoadedLanguages().includes(lang)) setTokens(ready.codeToTokens(code, { lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false }).tokens)
    })
    return () => {
      isCurrent = false
    }
  }, [code, lang])
  return tokens
}

function CodeRows({ rows, language, label }: { readonly rows: readonly Row[]; readonly language: string | undefined; readonly label: string }): ReactNode {
  const tokens = useTokens(rows, language)
  let codeIndex = 0
  return (
    <pre className="code" aria-label={label} data-highlighted={tokens !== undefined}>
      {rows.map((row, index) => {
        const lineTokens = row.kind === 'meta' ? undefined : tokens?.[codeIndex++]
        return (
          <span key={index} className="code__row" data-kind={row.kind}>
            <span className="code__number">{row.number ?? ''}</span>
            <span className="code__sign">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ''}</span>
            <span className="code__text">
              {lineTokens === undefined
                ? row.text
                : lineTokens.map((token, n) => (
                    <span key={n} style={token.htmlStyle as Record<string, string>}>
                      {token.content}
                    </span>
                  ))}
            </span>
          </span>
        )
      })}
    </pre>
  )
}

export function DiffCode({ diff, path, language }: { readonly diff: string; readonly path?: string; readonly language?: string }): ReactNode {
  return <CodeRows rows={diffRows(diff)} language={language ?? (path === undefined ? undefined : languageOf(path))} label={path === undefined ? 'diff' : `diff of ${path}`} />
}

export function Code({ code, language, firstLine }: { readonly code: string; readonly language: string | undefined; readonly firstLine?: number }): ReactNode {
  return <CodeRows rows={plainRows(code, firstLine)} language={language} label={language === undefined ? 'code' : `${language} code`} />
}

function themeColors(): { readonly bg: string; readonly fg: string; readonly line: string; readonly accent: string; readonly muted: string } {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string) => style.getPropertyValue(name).trim()
  return { bg: token('--surface'), fg: token('--text'), line: token('--text-secondary'), accent: token('--link'), muted: token('--text-secondary') }
}

const darkScheme = '(prefers-color-scheme: dark)'

function useColorScheme(): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>(() => (matchMedia(darkScheme).matches ? 'dark' : 'light'))
  useEffect(() => {
    const query = matchMedia(darkScheme)
    const changed = (event: MediaQueryListEvent) => setScheme(event.matches ? 'dark' : 'light')
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])
  return scheme
}

function MermaidImage({ diagram }: { readonly diagram: Diagram }): ReactNode {
  const scheme = useColorScheme()
  const [drawn, setDrawn] = useState<{ readonly url: string } | { readonly error: string } | undefined>(undefined)
  useEffect(() => {
    let url: string | undefined
    let isCurrent = true
    renderMermaidSVGAsync(diagram.mermaid, { ...themeColors(), transparent: true })
      .then((svg) => {
        url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        if (isCurrent) setDrawn({ url })
      })
      .catch((error: unknown) => {
        if (isCurrent) setDrawn({ error: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      isCurrent = false
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [diagram.mermaid, scheme])
  if (drawn === undefined) return <p className="drawing__note">Drawing the diagram…</p>
  if ('error' in drawn) return <Code code={diagram.mermaid} language={undefined} />
  return (
    <div className="diagram">
      <img className="diagram__image" src={drawn.url} alt={`${diagramKindOf(diagram)} diagram`} />
    </div>
  )
}

function Stats({ diffs }: { readonly diffs: readonly string[] }): ReactNode {
  if (diffs.length === 0) return null
  const { added, removed } = statsOf(diffs)
  return (
    <span className="stats">
      <span className="stats__added">+{added}</span> <span className="stats__removed">−{removed}</span>
    </span>
  )
}

function Counted({ changes }: { readonly changes: readonly (Change | undefined)[] }): ReactNode {
  return changeCounts(changes).map(({ change, count }) => (
    <span key={change} className="change" data-change={change}>
      {count} {changeWords[change]}
    </span>
  ))
}

function Opener({ path, onOpen }: { readonly path: string; readonly onOpen: () => void }): ReactNode {
  return (
    <button type="button" className="opener" onClick={onOpen}>
      {path}
    </button>
  )
}

export function DrawingSubject({ drawing, project, onFile }: { readonly drawing: Drawing; readonly project: string; readonly onFile: OpenFile }): ReactNode {
  if (drawing.kind === 'files')
    return (
      <>
        <span>{projectName(project)}</span>
        <Counted changes={drawing.files.map((file) => file.change)} />
        <Stats diffs={drawing.files.flatMap((file) => (file.diff === undefined ? [] : [file.diff]))} />
      </>
    )
  if (drawing.kind === 'api')
    return (
      <>
        <Opener path={drawing.path} onOpen={() => onFile(drawing.path, undefined)} />
        <Counted changes={drawing.changes.map((change) => change.change)} />
      </>
    )
  if (drawing.kind === 'diff')
    return (
      <>
        <Opener path={drawing.path} onOpen={() => onFile(drawing.path, undefined)} />
        <span className="drawing__note">{lineRange(drawing)}</span>
        <Stats diffs={[diffOf(drawing)]} />
      </>
    )
  if (drawing.kind === 'table')
    return (
      <>
        <span>{drawing.table}</span>
        <Counted changes={drawing.columns.map((column) => column.change)} />
      </>
    )
  if (drawing.kind === 'diagram') return <span>{diagramKindOf(drawing)}</span>
  return <span className="drawing__note">{drawing.language}</span>
}

const markKinds: Readonly<Record<Mark, RowKind>> = { '+': 'add', '-': 'remove', ' ': 'context' }

function Marked({ rows, label, onFile }: { readonly rows: readonly TreeRow[]; readonly label: string; readonly onFile: OpenFile }): ReactNode {
  return (
    <pre className="code code--marked" aria-label={label}>
      {rows.map(({ mark, line, path, diff }, index) => (
        <span key={index} className="code__row" data-kind={markKinds[mark]}>
          <span className="code__sign">{mark === '-' ? '−' : mark}</span>
          <span className="code__text">
            {path === undefined ? (
              line
            ) : (
              <button type="button" className="code__opener" onClick={() => onFile(path, diff)}>
                {line}
              </button>
            )}
          </span>
        </span>
      ))}
    </pre>
  )
}

export function DrawingView({ drawing, onFile }: { readonly drawing: Drawing; readonly onFile: OpenFile }): ReactNode {
  if (drawing.kind === 'files') return <Marked rows={treeOf(drawing)} label="files" onFile={onFile} />
  if (drawing.kind === 'api') return <Marked rows={treeOf(drawing)} label={`API of ${drawing.path}`} onFile={onFile} />
  if (drawing.kind === 'diff') return <DiffCode diff={diffOf(drawing)} path={drawing.path} />
  if (drawing.kind === 'table') return <DiffCode diff={diffOf(drawing)} language="typescript" />
  if (drawing.kind === 'diagram') return <MermaidImage diagram={drawing} />
  if (drawing.language === 'diff') return <Marked rows={diffRowsOf(drawing.code)} label="diff" onFile={onFile} />
  return <Code code={drawing.code} language={drawing.language} />
}

export type ShownFile = { readonly id: string; readonly project: string; readonly path: string; readonly diff: string | undefined }

export function FileView({ file, read, onClose }: { readonly file: ShownFile; readonly read: (id: string, path: string) => Promise<string>; readonly onClose: () => void }): ReactNode {
  const [text, setText] = useState<{ readonly text: string } | { readonly error: string } | undefined>(file.diff === undefined ? undefined : { text: file.diff })
  useEffect(() => {
    if (file.diff !== undefined) return setText({ text: file.diff })
    setText(undefined)
    let isCurrent = true
    read(file.id, file.path)
      .then((read) => isCurrent && setText({ text: read }))
      .catch((error: unknown) => isCurrent && setText({ error: error instanceof Error ? error.message : String(error) }))
    return () => {
      isCurrent = false
    }
  }, [file, read])
  return (
    <article className="file" aria-label={file.path}>
      <header className="file__header">
        <button type="button" className="button" onClick={onClose}>
          ← Back to the item
        </button>
        <div className="file__title">
          <h2 className="file__path">{file.path}</h2>
          <p className="file__where">{whereLine(file.project, file.diff !== undefined)}</p>
        </div>
      </header>
      {text === undefined ? <p className="drawing__note">Reading {file.path}…</p> : 'error' in text ? <p className="notice__text" data-tone="error">{text.error}</p> : file.diff === undefined ? <Code code={text.text} language={languageOf(file.path)} firstLine={1} /> : <DiffCode diff={text.text} path={file.path} />}
    </article>
  )
}
