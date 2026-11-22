export type TemplateTask = { readonly title: string; readonly isRequired: boolean }

const taskLine = /^- \[ \] (.*?)( \(required\))?$/

export function templatePaths(project: string, name: string): readonly string[] {
  return [`${project}/.claude/cmods/inbox/templates/${name}.md`, `~/.claude/cmods/inbox/templates/${name}.md`]
}

export function parseTemplate(markdown: string, path: string): TemplateTask[] {
  const tasks = markdown.split('\n').flatMap((line): TemplateTask[] => {
    const [, title, mark] = taskLine.exec(line.trimEnd()) ?? []
    return title === undefined || title.trim() === '' ? [] : [{ title: title.trim(), isRequired: mark !== undefined }]
  })
  if (tasks.length === 0) throw new Error(`${path} holds no task line, such as "- [ ] Run the suite (required)".`)
  return tasks
}
