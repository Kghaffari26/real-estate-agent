import { describe, expect, it } from 'vitest';
import { friendly, isEmail, signInProblem } from './desk';

describe('sign-in problems', () => {
  it('explains Supabase’s email rate limit (429 / over_email_send_rate_limit) instead of “check the address”', () => {
    for (const e of [
      { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' },
      { status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' },
      { status: 429, message: 'Too Many Requests' },
    ]) {
      const p = signInProblem(e);
      expect(p.kind).toBe('rate-limit');
      expect(p.message).toMatch(/paused sending/);
      expect(p.message).toMatch(/DESK_SETUP/);
    }
  });

  it('says how long to wait when the same address asked again too soon', () => {
    expect(signInProblem({ status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 47 seconds.' })).toEqual({
      kind: 'rate-limit',
      message: expect.stringMatching(/Wait 47 seconds/),
    });
  });

  it('keeps invalid addresses and everything else apart', () => {
    expect(signInProblem({ status: 400, code: 'email_address_invalid', message: 'Email address is invalid' }).kind).toBe('invalid');
    expect(signInProblem({ status: 500, message: 'boom' })).toEqual({ kind: 'other', message: expect.stringMatching(/couldn’t send/) });
  });
});

describe('friendly database errors', () => {
  it('maps the messages people can act on', () => {
    expect(friendly('a team must keep at least one manager')).toMatch(/at least one manager/);
    expect(friendly('new row violates row-level security policy')).toBe('You don’t have access to do that.');
    expect(friendly('weird')).toBe('Something went wrong. Try again.');
    expect(isEmail(' A@b.co ')).toBe(true);
  });
});
