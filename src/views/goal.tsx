import { sessions, type Mod, type View, type ViewInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Box, Button, Input, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { countsIn, goalsIn, goalTextIn } from '../actions.js'
import { setTyped } from '../answers.js'
import { Fold } from '../components/fold.js'
import { isMet, type Goals, type Requirement } from '../goals/goal.js'
import { plural, senderOf } from '../items/item.js'
import { addRequirement, changeGoal, correct, isUnfolded, submitField, toggleField } from '../requirements.js'
import type { InboxState } from '../state.js'

type Focus = View['focus']

const goalField = 'goal:text'

const addField = 'goal:add'

const capabilityInput = `${addField}:capability`

const correctField = (requirement: Requirement) => `goal:correct:${requirement.id}`

function summaryLine(mod: Mod<InboxState>): string {
  const { met, requirements, waitingOnYou } = countsIn(mod)
  return [requirements === 0 ? 'No requirements yet' : `${met} of ${plural(requirements, 'requirement')} met`, ...(waitingOnYou === 0 ? [] : [`${waitingOnYou} waits on you`])].join(' · ')
}

function GoalField({ mod, goal }: { readonly mod: Mod<InboxState>; readonly goal: string }): JSX.Element {
  const agent = sessions.current.agentType ?? 'Claude'
  const save = (text: string) => submitField(mod, () => changeGoal(mod, text))
  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      <Input key={goalField} value={goal} placeholder="What this session is for" submitLabel="save" rows={3} onInput={(text) => setTyped(mod, goalField, text)} onSubmit={save} />
      <Box>
        <Button key="goal:save" label={`Save and tell ${agent}`} onPress={() => save(mod.state.session.typed[goalField] ?? goal)} />
      </Box>
    </Box>
  )
}

function quoted(words: string): string {
  return `"${words}"`
}

function RequirementRow({ mod, goals, requirement, focus }: { readonly mod: Mod<InboxState>; readonly goals: Goals; readonly requirement: Requirement; readonly focus: Focus }): JSX.Element {
  const isDone = isMet(requirement, goals)
  const foldKey = `quotes:${requirement.id}`
  const [first, ...more] = requirement.quotes
  const field = correctField(requirement)
  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        <Text {...(isDone ? { color: 'success' } : { dimColor: true })}>{isDone ? '✓' : '○'}</Text>
        <Text wrap="wrap">{requirement.line}</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {first === undefined ? null : <Fold mod={mod} foldKey={foldKey} label={isUnfolded(mod, foldKey) ? quoted(first.words) : quoted(first.words.replaceAll('\n', ' '))} />}
        {isUnfolded(mod, foldKey) ? (
          <Box flexDirection="column" gap={1} paddingLeft={2}>
            {more.map((quote) => (
              <Text dimColor wrap="wrap">
                {quoted(quote.words)}
              </Text>
            ))}
            <Box>
              <Button key={`${field}:open`} label="Correct…" onPress={() => toggleField(mod, field, focus)} />
            </Box>
            {mod.state.session.openField === field ? (
              <Input key={field} placeholder="What to change, in your words" submitLabel="send" rows={3} onSubmit={(words) => submitField(mod, () => correct(mod, { requirement: requirement.id }, words))} />
            ) : null}
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

function capabilitiesOf(goals: Goals): string[] {
  return [...new Set(goals.requirements.map((each) => each.capability))]
}

function Requirements({ mod, goals, focus }: { readonly mod: Mod<InboxState>; readonly goals: Goals; readonly focus: Focus }): JSX.Element {
  return (
    <Box flexDirection="column" gap={1}>
      {capabilitiesOf(goals).map((capability) => (
        <Box flexDirection="column">
          <Text bold wrap="wrap">
            {capability}
          </Text>
          <Box flexDirection="column" paddingLeft={2}>
            {goals.requirements
              .filter((each) => each.capability === capability)
              .map((requirement) => (
                <RequirementRow mod={mod} goals={goals} requirement={requirement} focus={focus} />
              ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function AddRequirement({ mod, goals, focus }: { readonly mod: Mod<InboxState>; readonly goals: Goals | undefined; readonly focus: Focus }): JSX.Element {
  const last = goals === undefined ? undefined : capabilitiesOf(goals).at(-1)
  const capability = () => mod.state.session.typed[capabilityInput] ?? last ?? ''
  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        <Button key={`${addField}:open`} label="Add a requirement" onPress={() => toggleField(mod, addField, focus, last === undefined ? capabilityInput : addField)} />
      </Box>
      {mod.state.session.openField === addField ? (
        <Box flexDirection="column" gap={1}>
          <Input
            key={capabilityInput}
            {...(last === undefined ? {} : { value: last })}
            placeholder="The capability, such as Progress view"
            submitLabel="next"
            onInput={(text) => setTyped(mod, capabilityInput, text)}
            onSubmit={(text) => {
              setTyped(mod, capabilityInput, text)
              return focus(addField)
            }}
          />
          <Input key={addField} placeholder="The requirement, in your words" submitLabel="add" rows={3} onSubmit={(words) => submitField(mod, () => addRequirement(mod, capability(), words))} />
        </Box>
      ) : null}
    </Box>
  )
}

function unfiledLine(count: number): string {
  return `${plural(count, 'prompt')} of yours ${count === 1 ? 'is' : 'are'} not filed yet`
}

export function goalView(focus: Focus): ViewInit<InboxState> {
  return {
    id: 'goal',
    title: 'Goal',
    render: (mod) => {
      const goals = goalsIn(mod)
      const goal = goalTextIn(mod)
      const { title } = senderOf({ session: sessions.current.id }, sessions.current.project, mod.state.memory.senders)
      const unfiled = mod.state.session.unfiled.length
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Box justifyContent="space-between" columnGap={2}>
              <Box flexShrink={1}>
                <Text bold wrap="truncate-end">{`Goal · ${title}`}</Text>
              </Box>
              <Button key="goal:edit" label="Edit" onPress={() => toggleField(mod, goalField, focus)} />
            </Box>
            {mod.state.session.openField === goalField ? (
              <GoalField mod={mod} goal={goal} />
            ) : (
              <Text wrap="wrap" {...(goal === '' ? { dimColor: true } : {})}>
                {goal === '' ? 'No goal yet' : goal}
              </Text>
            )}
            <Text dimColor wrap="wrap">
              {summaryLine(mod)}
            </Text>
          </Box>
          {goals === undefined || goals.requirements.length === 0 ? null : <Requirements mod={mod} goals={goals} focus={focus} />}
          <AddRequirement mod={mod} goals={goals} focus={focus} />
          {unfiled === 0 ? null : <Text dimColor>{unfiledLine(unfiled)}</Text>}
        </Box>
      )
    },
  }
}
