// Shared by answer extraction and the user-requested, unverified failed-page copy action.
const CHATGPT_ASSISTANT_TURN_SELECTOR = [
  '[data-testid^="conversation-turn-"][data-turn="assistant"]:not([data-turn-key] *)',
  '[data-testid^="conversation-turn-"][data-message-author-role="assistant"]:not([data-turn-key] *)',
  '[data-testid^="conversation-turn-"]:has([data-message-author-role="assistant"]):not([data-turn-key] *)',
  '[data-turn-key]:has([data-conversation-role="assistant"], [data-chatgpt-agent-turn-start])',
].join(", ");
const CHATGPT_ANSWER_ROOT_SELECTOR = '.markdown, [data-message-author-role="assistant"] .puik-root.not-markdown > [class*="_DilResponseRoot"], [data-markdown-text-style="assistant-message"]';

// Runs in the isolated task page. This is manual recovery, not protocol validation: only copy
// the last visible answer root of the last assistant turn, never user messages or activity.
function readUnverifiedAnswerText({ turnSelector, answerSelector }) {
  const turn = [...document.querySelectorAll(turnSelector)].at(-1);
  if (!turn) return "";
  const roots = [...turn.querySelectorAll(answerSelector)].filter(node => {
    if (node.parentElement?.closest(answerSelector) || node.closest('[data-streaming-response-status], [data-testid^="cot-v5"]')) return false;
    if (turn.hasAttribute('data-turn-key')) {
      const unit = node.closest('[data-content-search-unit-key]');
      if (!unit || ![...unit.children].some(child => child.getAttribute('data-conversation-role') === 'assistant')) return false;
    }
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (ancestor.matches('[hidden], [inert], [aria-hidden="true"]') || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return !!node.innerText.trim();
  });
  return roots.at(-1)?.innerText || "";
}
module.exports = { CHATGPT_ASSISTANT_TURN_SELECTOR, CHATGPT_ANSWER_ROOT_SELECTOR, readUnverifiedAnswerText };
