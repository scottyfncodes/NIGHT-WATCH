import { describe, it, expect } from 'vitest';
import { Director } from '../src/director';

describe('clock', () => {
  it('formats minutes after 10 PM as a wristwatch time', () => {
    expect(Director.clockString(0)).toEqual({ time: '10:00', ampm: 'PM' });
    expect(Director.clockString(125)).toEqual({ time: '12:05', ampm: 'AM' });
    expect(Director.clockString(480)).toEqual({ time: '6:00', ampm: 'AM' });
  });
});
