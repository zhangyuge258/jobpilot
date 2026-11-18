import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Execute the production read-only inspection script against synthetic BOSS DOM.
const senderSource = readFileSync(resolve(process.cwd(), '../../executor/sender.py'), 'utf8')
const script = senderSource.match(/PRIOR_OUTBOUND_STATE_JS = """([\s\S]*?)"""/)[1]
function read(records, options = {}, ownHtml = '') {
  document.body.innerHTML = `<div id="chat-input"></div><div class="chat-record">${ownHtml}</div>`
  const root = document.querySelector('.chat-record')
  root.__vue__ = { list$: records, loading: false, history: false, ...options }
  return JSON.parse(new Function(`return (${script})`)())
}
afterEach(() => { document.body.innerHTML = '' })

describe('BOSS pre-send conversation inspection', () => {
  it('recognizes any previous successful own message without matching the new greeting', () => {
    expect(read([{ isSelf: true, status: 1, text: '以前的另一段招呼语' }]).state).toBe('delivered')
    expect(read([{ isSelf: true, status: 1, image: { url: 'old-image' } }]).state).toBe('delivered')
  })
  it('uses a positive DOM receipt even when Vue history is unavailable', () => {
    expect(read([], { list$: undefined }, '<div class="message-item item-myself"><div class="message-content"><img class="message-image" src="old.png"></div><span class="message-status status-delivery"></span></div>').state).toBe('delivered')
  })
  it('does not mistake HR messages for a previous application', () => {
    expect(read([{ isSelf: false, status: 1, text: '你好' }]).state).toBe('empty')
  })
  it('distinguishes pending, failed and unverified own messages from successful sends', () => {
    expect(read([{ isSelf: true, status: 0 }]).state).toBe('pending')
    expect(read([{ isSelf: true, status: 4 }]).state).toBe('failed')
    expect(read([{ isSelf: true }]).state).toBe('unknown')
  })
  it('does not assume that missing, loading or partially loaded history is empty', () => {
    expect(read([], { loading: true }).state).toBe('unknown')
    expect(read([], { history: true }).state).toBe('unknown')
    expect(read([], { list$: undefined }).state).toBe('unknown')
    document.body.innerHTML = ''
    expect(JSON.parse(new Function(`return (${script})`)()).success).toBe(false)
  })
})
