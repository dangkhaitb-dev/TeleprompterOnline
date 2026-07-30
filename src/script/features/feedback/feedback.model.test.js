import { describe, expect, it } from 'vitest';
import { FeedbackValidationError, toFeedback } from './feedback.model.js';

function expectValidationError(input, field, code) {
  expect(() => toFeedback(input)).toThrowError(FeedbackValidationError);

  try {
    toFeedback(input);
  } catch (error) {
    expect(error).toMatchObject({ field, code });
  }
}

describe('toFeedback', () => {
  it('trims user input and returns the API-facing feedback shape', () => {
    expect(toFeedback({
      email: '  person+tag@example.com  ',
      content: '  This is genuinely useful.  ',
      domain: '  app.solprompter.com  ',
      ignored: 'not part of the payload',
    })).toEqual({
      email: 'person+tag@example.com',
      content: 'This is genuinely useful.',
      domain: 'app.solprompter.com',
    });
  });

  it.each([
    ['', 'required'],
    ['not-an-email', 'invalid'],
    ['person@', 'invalid'],
    [`${'a'.repeat(244)}@example.com`, 'invalid'],
  ])('rejects an invalid email (%j)', (email, code) => {
    expectValidationError({ email, content: 'Useful', domain: 'solprompter.com' }, 'email', code);
  });

  it('rejects feedback shorter than 3 characters after trimming', () => {
    expectValidationError({
      email: 'person@example.com',
      content: '  ok  ',
      domain: 'solprompter.com',
    }, 'content', 'too_short');
  });

  it('rejects empty feedback as required', () => {
    expectValidationError({
      email: 'person@example.com',
      content: '   ',
      domain: 'solprompter.com',
    }, 'content', 'required');
  });

  it('accepts the content length boundaries', () => {
    expect(toFeedback({
      email: 'person@example.com',
      content: 'abc',
      domain: 'solprompter.com',
    }).content).toHaveLength(3);

    expect(toFeedback({
      email: 'person@example.com',
      content: 'x'.repeat(5000),
      domain: 'solprompter.com',
    }).content).toHaveLength(5000);
  });

  it('rejects feedback longer than 5000 characters', () => {
    expectValidationError({
      email: 'person@example.com',
      content: 'x'.repeat(5001),
      domain: 'solprompter.com',
    }, 'content', 'too_long');
  });

  it('rejects an empty domain', () => {
    expectValidationError({
      email: 'person@example.com',
      content: 'Useful',
      domain: '   ',
    }, 'domain', 'required');
  });

  it.each([
    ['https://solprompter.com'],
    ['bad domain.example'],
    [`${'a'.repeat(250)}.com`],
  ])('rejects an invalid domain (%j)', (domain) => {
    expectValidationError({
      email: 'person@example.com',
      content: 'Useful',
      domain,
    }, 'domain', 'invalid');
  });
});
