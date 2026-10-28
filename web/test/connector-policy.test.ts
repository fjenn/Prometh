import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, readVerbs, writeVerbs, toolkitFrom, decision, alwaysAllowKey, addingAllowed, containsAllowed, resetAllowed, humanizeAction, actionName, appName, detail, declinedPayload, parseAction, descriptionLine, allowedKeys, alwaysAllowKeyFor } from '../src/engine/connector-policy.ts'

test('policy ports every read/write verb and uses first recognized action verb', () => {
  for (const v of readVerbs) assert.equal(classify(`APP_${v}_THING`), 'read', v)
  for (const v of writeVerbs) assert.equal(classify(`APP_${v}_THING`), 'write', v)
  assert.equal(classify('APP_GET_OR_CREATE'), 'read')
  assert.equal(classify('APP_CREATE_OR_GET'), 'write')
  assert.equal(classify('APP_EXPORT_DATA'), 'write')
  assert.equal(classify('MYSTERY'), 'write')
})
test('destructive tags win over readonly, tags win over action verbs', () => {
  assert.equal(classify('APP_SEND', ['readOnlyHint']), 'read')
  for (const t of ['destructiveHint', 'createHint', 'updateHint', 'deleteHint']) assert.equal(classify('APP_GET', [t, 'readOnlyHint']), 'write')
  assert.equal(decision('APP_GET', { tags: ['updateHint'] }), 'needsCard')
})
test('toolkit extraction, always-allow keys and resetting are case-insensitive', () => {
  assert.equal(toolkitFrom('GOOGLE_DRIVE_LIST_FILES'), 'googledrive')
  assert.equal(toolkitFrom('APP_EXPORT'), 'app')
  assert.equal(toolkitFrom('APP_LIST', ' GitHub '), 'github')
  const key = alwaysAllowKey('GitHub', 'github_create_issue')
  assert.equal(key, 'github:GITHUB_CREATE_ISSUE')
  const keys = addingAllowed(key, ['gmail:GMAIL_SEND'])
  assert.equal(addingAllowed(key.toLowerCase(), keys), keys)
  assert.ok(containsAllowed(key.toLowerCase(), keys))
  assert.equal(decision('GITHUB_CREATE_ISSUE', {}, keys), 'run')
  assert.equal(decision('GITHUB_CREATE_OTHER', {}, keys), 'needsCard')
  assert.deepEqual(resetAllowed('GITHUB', keys), ['gmail:GMAIL_SEND'])
})
test('humanized action, display hints, detail lines and declined payload match Mac behavior', () => {
  assert.equal(humanizeAction('GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER'), 'List repositories')
  assert.equal(humanizeAction('GOOGLE_DRIVE_CREATE_FILE'), 'Create file')
  assert.equal(humanizeAction('X'), 'Run connected-app action')
  assert.equal(actionName('X', { name: '  A\n readable  name ' }), 'A readable name')
  assert.equal(appName('github'), 'GitHub')
  assert.equal(appName('googledrive'), 'Google Drive')
  assert.equal(detail({ owner: 'me', repo: 'test', title: 'A\n title', to: ['a', 'b'] }), 'me/test · A title · a, b')
  assert.equal(detail({ subject: 'a'.repeat(300) }).length, 80) // Individual values include the ellipsis within their 80-character cap.
  assert.deepEqual(declinedPayload('Send mail', 'Gmail'), { ok: false, executed: false, declined: true, error: 'The user chose not to allow Send mail in Gmail. Nothing was sent. Briefly tell them it was not done.' })
})

test('Mac-compatible argument parser and description/allow-list helpers', () => {
  assert.equal(parseAction('invalid'), null)
  assert.equal(parseAction('{"tool":" "}'), null)
  assert.deepEqual(parseAction(JSON.stringify({ tool: ' APP_CREATE ', arguments_json: '{"title":"Test"}' })), { slug: 'APP_CREATE', arguments: { title: 'Test' } })
  assert.deepEqual(parseAction('{"tool":"APP_CREATE","arguments_json":[]}'), { slug: 'APP_CREATE', arguments: {} })
  assert.equal(descriptionLine('APP_CREATE_ISSUE', JSON.stringify({ tool: 'APP_CREATE_ISSUE', arguments_json: { title: 'A title' } })), 'Create issue · A title')
  assert.equal(alwaysAllowKeyFor('GOOGLE_DRIVE_CREATE_FILE'), 'googledrive:GOOGLE_DRIVE_CREATE_FILE')
  assert.deepEqual(allowedKeys('GITHUB', ['github:GITHUB_SEND', 'gmail:GMAIL_SEND']), ['github:GITHUB_SEND'])
})
