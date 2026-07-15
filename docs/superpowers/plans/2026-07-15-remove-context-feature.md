# Remove Context Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Remove Context" button that clears the conversation history sent to the model, preventing 7b models from hallucinating based on stale context instead of using tools.

**Architecture:** Frontend-only change with a single "clear history" action. The backend already accepts `history` parameter in `/api/chat` — we simply send an empty array when the user clicks the button, then continue the conversation with a clean slate. No database changes needed; the saved conversation still retains full history for replay.

**Tech Stack:** Vanilla JS (ES modules), simpui CSS tokens, SSE streaming, Node http server.

## Global Constraints

- Follow `CLAUDE.md` frontend rules: simpui components only, lucide icons, CSS variables from `base.css`, no inline styles.
- Backend API contract unchanged: `POST /api/chat` still receives `{ message, images, model, ollamaHost, projectRoot, history, conversationId, mode }`.
- History trimming is client-side: `state.session` DOM → `history` array in `send()`.
- Conversation persistence unchanged — full history still saved via `saveConversation()`.
- Button must be keyboard-accessible (Enter/Space), have tooltip, use `.simpui-btn` variant.

---

### Task 1: Add "Clear Context" Button to Message Footer

**Files:**
- Create: `public/components/context-actions.html` (reusable component)
- Modify: `public/frontend/js/modules/render.js:319-350` (appendAnswer footer)
- Modify: `public/frontend/css/modules/chat.css` (button styling)

**Interfaces:**
- Consumes: none
- Produces: `<button class="simpui-btn ghost sm context-clear" data-action="clear-context">` in each assistant message footer

- [ ] **Step 1.1: Create reusable component `public/components/context-actions.html`**

```html
<!-- context-actions.html -->
<div class="context-actions" data-context-actions>
  <button
    class="simpui-btn ghost sm context-clear"
    type="button"
    data-action="clear-context"
    title="清除上下文：后续对话不再携带历史记录（本地保留完整记录）"
    aria-label="清除上下文"
  >
    <svg class="context-clear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em">
      <path d="M3 6h18"></path>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <line x1="10" y1="11" x2="10" y2="17"></line>
      <line x1="14" y1="11" x2="14" y2="17"></line>
    </svg>
    <span>清除上下文</span>
  </button>
</div>
```

- [ ] **Step 1.2: Run test to verify component loads**  
  Run: `grep -r "context-actions" public/` — expect 0 matches initially

- [ ] **Step 1.3: Modify `render.js` `appendAnswer()` to inject component into footer**

```javascript
// In appendAnswer(), after creating footer (line ~331), before m.appendChild(footer):
const ctxActions = el('div', 'context-actions');
ctxActions.innerHTML = `
  <button class="simpui-btn ghost sm context-clear" type="button" data-action="clear-context" title="清除上下文：后续对话不再携带历史记录（本地保留完整记录）" aria-label="清除上下文">
    <svg class="context-clear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em">
      <path d="M3 6h18"></path>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <line x1="10" y1="11" x2="10" y2="17"></line>
      <line x1="14" y1="11" x2="14" y2="17"></line>
    </svg>
    <span>清除上下文</span>
  </button>
`;
footer.appendChild(ctxActions);
```

- [ ] **Step 1.4: Add CSS for `.context-actions` and `.context-clear` in `chat.css`**

```css
/* Context actions in answer footer */
.answer-footer .context-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.context-clear {
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--simpui-text-light);
  transition: color var(--fast) var(--ease), background var(--fast) var(--ease);
}

.context-clear:hover {
  color: var(--danger);
  background: var(--danger-dim);
}

.context-clear:focus-visible {
  outline: 2px solid var(--danger);
  outline-offset: 2px;
}

.context-clear-icon {
  width: 1em;
  height: 1em;
  flex-shrink: 0;
}
```

- [ ] **Step 1.5: Run lint & verify no regressions**  
  Run: `npm run lint` (or `node --check public/frontend/js/modules/render.js`)  
  Expected: PASS

---

### Task 2: Wire Click Handler to Clear History Flag

**Files:**
- Modify: `public/frontend/js/modules/app.js` (add handler + state flag)

**Interfaces:**
- Consumes: `state` module (for `conversationCleared` flag)
- Produces: `state.conversationCleared = true` when button clicked

- [ ] **Step 2.1: Add flag to `state.js`**

```javascript
// In state.js, after line 30 (after bootDone):
conversationCleared: false,  // 标记用户已点击「清除上下文」
```

- [ ] **Step 2.2: Add click delegation in `app.js` mountSession()**

```javascript
// In mountSession(), after messagesEl.appendChild(state.session) (line ~488):
// 事件委托：点击「清除上下文」按钮
state.session.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="clear-context"]');
  if (!btn) return;
  state.conversationCleared = true;
  btn.disabled = true;
  btn.innerHTML = `
    <svg class="context-clear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em">
      <path d="M3 6h18"></path>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      <line x1="10" y1="11" x2="10" y2="17"></line>
      <line x1="14" y1="11" x2="14" y2="17"></line>
    </svg>
    <span>上下文已清除</span>
  `;
  btn.classList.add('cleared');
  btn.title = '已清除：下一条消息将不携带历史记录发送';
  showSimpuiToast('提示', '已清除上下文，下一条消息将不携带历史记录发送');
});
```

- [ ] **Step 2.3: Reset flag on new chat**  
  In `$('#new-chat').onclick` handler (line ~454), add: `state.conversationCleared = false;`

- [ ] **Step 2.4: Run test**  
  Run: `npm run test` — expect PASS (no new tests needed, but ensure no syntax errors)

---

### Task 3: Modify `send()` to Send Empty History When Flag Set

**Files:**
- Modify: `public/frontend/js/modules/app.js:1041-1045` (history collection)

**Interfaces:**
- Consumes: `state.conversationCleared`
- Produces: `history = []` sent to backend when flag is true

- [ ] **Step 3.1: Update history collection in `send()`**

```javascript
// In send(), replace lines 1041-1045 (history collection):
// 收集对话历史（最近 20 条，不含当前输入），供模型感知上下文
let history = [];
if (state.session && !state.conversationCleared) {
  const msgs = state.session.querySelectorAll('.msg');
  for (const m of msgs) {
    if (m.classList.contains('user')) {
      const bubble = m.querySelector('.bubble');
      history.push({ role: 'user', content: bubble ? bubble.textContent.trim() : '' });
    } else {
      const bubble = m.querySelector('.bubble');
      history.push({ role: 'assistant', content: bubble ? bubble.textContent.trim() : '' });
    }
  }
  // 只保留最近 20 条
  if (history.length > 20) history = history.slice(-20);
} else if (state.conversationCleared) {
  // 用户点击了「清除上下文」：发送空历史，发送后重置标志
  history = [];
  state.conversationCleared = false; // 仅影响本次请求
}
```

- [ ] **Step 3.2: Verify the flag resets after one request**  
  The flag is consumed once — next user message will include history again unless user clicks again.

- [ ] **Step 3.3: Run test**  
  Run: `node --check public/frontend/js/modules/app.js` — expect no syntax errors

---

### Task 4: Add Visual Feedback in Status Bar

**Files:**
- Modify: `public/frontend/js/modules/app.js` `renderSessionState()`

**Interfaces:**
- Consumes: `state.conversationCleared`
- Produces: status bar indicator "上下文已清除"

- [ ] **Step 4.1: Add indicator in `renderSessionState()`**

```javascript
// In renderSessionState(), after line 648 (msgCount):
const ctxCleared = state.conversationCleared;
if (ssContextText) {
  if (ctxCleared) {
    ssContextText.textContent = '⚠ 上下文已清除 · 下条消息不带历史';
    ssContextText.style.color = 'var(--warning)';
  } else {
    // existing context bar rendering (lines 654-670)
  }
}
```

- [ ] **Step 4.2: Add CSS for warning state in `chat.css`**

```css
/* Status bar context warning */
#ss-context-text.warning {
  color: var(--warning) !important;
}
```

- [ ] **Step 4.3: Run test**  
  Run: `npm run lint` — expect PASS

---

### Task 5: Persist "Cleared" State Across Reload (Optional but Recommended)

**Files:**
- Modify: `public/frontend/js/modules/api.js` `saveConversation()` / `loadHistoryConversation()`

**Interfaces:**
- Consumes: `state.conversationCleared` (transient, not persisted)
- Produces: conversation metadata `contextClearedAt` timestamp for UI restore hint

- [ ] **Step 5.1: Save timestamp when cleared**  
  In `saveConversation()`, before POST, add to payload:
  ```javascript
  const payload = { ..., contextClearedAt: state.conversationCleared ? Date.now() : null };
  ```

- [ ] **Step 5.2: Restore hint on load**  
  In `loadHistoryConversation()`, after restoring messages:
  ```javascript
  if (data.contextClearedAt) {
    const ago = Math.round((Date.now() - data.contextClearedAt) / 60000);
    showSimpuiToast('提示', `该对话曾在 ${ago} 分钟前清除上下文，历史记录完整保留`);
  }
  ```

- [ ] **Step 5.3: Run test**  
  Run: `node --check public/frontend/js/modules/api.js` — expect no syntax errors

---

### Task 6: Accessibility & Polish

**Files:**
- Modify: `public/frontend/js/modules/app.js` (keyboard support)
- Modify: `public/frontend/css/modules/chat.css` (focus styles)

**Interfaces:**
- Produces: fully keyboard-accessible button, screen-reader labels

- [ ] **Step 6.1: Ensure button is in tab order and has ARIA**  
  Already has `type="button"`, `aria-label`, `title` — verify in browser DevTools.

- [ ] **Step 6.2: Add focus-visible style** (already in Task 1.4 CSS)

- [ ] **Step 6.3: Test with screen reader** (manual)  
  - Tab to button → announces "清除上下文，按钮"
  - Press Enter → toast appears, button updates to "上下文已清除"

---

### Task 7: End-to-End Verification

**Files:** (manual test steps)

- [ ] **Step 7.1: Start server** `npm start`
- [ ] **Step 7.2: Open http://localhost:3000**
- [ ] **Step 7.3: Send 2-3 messages with tool calls** (verify history builds)
- [ ] **Step 7.4: Click "清除上下文" on latest assistant message**
  - Button disables, shows "上下文已清除"
  - Toast appears
  - Status bar shows warning "⚠ 上下文已清除 · 下条消息不带历史"
- [ ] **Step 7.5: Send new message** — verify backend receives `history: []` (check network tab or agent logs)
- [ ] **Step 7.6: Send another message** — history should be back (flag consumed once)
- [ ] **Step 7.7: Refresh page** — conversation loads, toast shows "曾清除上下文" hint
- [ ] **Step 7.8: Run full test suite** `npm test` — all PASS

---

## Self-Review Checklist

- [ ] **Spec coverage:** Every requirement addressed (button, history clear, visual feedback, persistence hint, accessibility)
- [ ] **No placeholders:** All code blocks complete, no "TBD"
- [ ] **Type consistency:** `state.conversationCleared` boolean used consistently across tasks
- [ ] **File paths exact:** All paths match actual repo structure
- [ ] **Commands runnable:** `npm run lint`, `npm test`, `node --check` all valid

---

**Plan saved to:** `docs/superpowers/plans/2026-07-15-remove-context-feature.md`

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration  
   REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`

2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints  
   REQUIRED SUB-SKILL: `superpowers:executing-plans`

**Which approach?**