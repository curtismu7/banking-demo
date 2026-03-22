const { parseHeuristic } = require('../../services/nlIntentParser');

describe('nlIntentParser', () => {
  it('routes show my accounts to banking', () => {
    const r = parseHeuristic('show my accounts');
    expect(r.kind).toBe('banking');
    expect(r.banking.action).toBe('accounts');
  });

  it('routes token exchange question to education', () => {
    const r = parseHeuristic('what is token exchange');
    expect(r.kind).toBe('education');
    expect(r.education.panel).toBe('token-exchange');
  });

  it('routes CIBA mention to ciba panel', () => {
    const r = parseHeuristic('explain ciba');
    expect(r.kind).toBe('education');
    expect(r.ciba).toBe(true);
  });
});
