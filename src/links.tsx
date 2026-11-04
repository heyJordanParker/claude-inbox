import type { RenderElement } from 'claude-code'
import type { StyleProps } from '../node_modules/@cmodjs/core/mod.js'
import { Markdown } from '../node_modules/@cmodjs/core/ui/elements.js'
import type { List, Paragraph } from '../node_modules/@cmodjs/core/ui/markdown.js'

export function itemLinks(source: string, items: string): string[] {
  const prefix = `file://${items}/`
  return [...source.matchAll(/\]\(([^)\s]+)\)/g)].map(([, href]) => href ?? '').filter((href) => href.startsWith(prefix) && href.endsWith('.md'))
}

export function idOfLink(href: string, items: string): string {
  return href.slice(`file://${items}/`.length, -'.md'.length)
}

export function LinkedBlock({ props, items, onOpen }: { readonly props: StyleProps<typeof Paragraph> | StyleProps<typeof List>; readonly items: string; readonly onOpen: (id: string) => void }): RenderElement {
  const links = itemLinks(props.source, items)
  if (links.length === 0) return <props.Default />
  return <Markdown key={`links:${props.id ?? ''}:${props.source}`} text={props.source} pressableLinks={links} onLinkPress={({ href }) => onOpen(idOfLink(href, items))} />
}
