import { describe, it, expect, beforeEach } from '@jest/globals';
import { ChatSession, ChatMessage } from '../src/chat-engine.js';

describe('ChatSession', () => {
  let session: ChatSession;

  beforeEach(() => {
    session = new ChatSession(5);
  });

  it('starts with empty history', () => {
    expect(session.getHistory()).toEqual([]);
  });

  it('adds user messages', () => {
    session.addUserMessage('Hello');
    const history = session.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('adds assistant messages', () => {
    session.addAssistantMessage('Hi there!');
    const history = session.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual({ role: 'assistant', content: 'Hi there!' });
  });

  it('maintains message order', () => {
    session.addUserMessage('Q1');
    session.addAssistantMessage('A1');
    session.addUserMessage('Q2');
    session.addAssistantMessage('A2');

    expect(session.getHistory()).toHaveLength(4);
    expect(session.getHistory()[0].content).toBe('Q1');
    expect(session.getHistory()[3].content).toBe('A2');
  });

  it('trims history to maxHistory pairs', () => {
    // maxHistory = 5 → 10 messages max
    for (let i = 0; i < 10; i++) {
      session.addUserMessage(`Q${i}`);
      session.addAssistantMessage(`A${i}`);
    }

    const history = session.getHistory();
    expect(history.length).toBeLessThanOrEqual(10);
    // Should have discarded the first pair
    expect(history[0].content).toBe('Q5'); // 5 pairs = index 5
  });

  it('clear empties the history', () => {
    session.addUserMessage('test');
    session.addAssistantMessage('answer');
    session.clear();
    expect(session.getHistory()).toEqual([]);
  });

  it('does not modify returned history array', () => {
    session.addUserMessage('test');
    const history = session.getHistory();
    history.push({ role: 'user', content: 'injected' });
    expect(session.getHistory()).toHaveLength(1);
  });
});
