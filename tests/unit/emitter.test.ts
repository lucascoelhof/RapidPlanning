import { describe, it, expect } from 'vitest';
import { Emitter } from '../../src/utils/emitter';

describe('Emitter', () => {
  it('delivers emissions to subscribers', () => {
    const e = new Emitter<{ ping: [number] }>();
    let received = 0;
    e.on('ping', (n) => (received = n));
    e.emit('ping', 42);
    expect(received).toBe(42);
  });

  it('on() returns an unsubscribe function', () => {
    const e = new Emitter<{ x: [] }>();
    let count = 0;
    const off = e.on('x', () => count++);
    e.emit('x');
    off();
    e.emit('x');
    expect(count).toBe(1);
  });

  it('off() removes a specific listener', () => {
    const e = new Emitter<{ x: [] }>();
    let count = 0;
    const fn = () => count++;
    e.on('x', fn);
    e.emit('x');
    e.off('x', fn);
    e.emit('x');
    expect(count).toBe(1);
  });

  it('once() auto-unsubscribes after one emission', () => {
    const e = new Emitter<{ x: [number] }>();
    let sum = 0;
    e.once('x', (n) => (sum += n));
    e.emit('x', 5);
    e.emit('x', 10);
    expect(sum).toBe(5);
  });

  it('one listener throwing does not block the others', () => {
    const e = new Emitter<{ x: [] }>();
    let second = false;
    e.on('x', () => {
      throw new Error('boom');
    });
    e.on('x', () => {
      second = true;
    });
    // Suppress the expected console.error.
    const original = console.error;
    console.error = () => {};
    e.emit('x');
    console.error = original;
    expect(second).toBe(true);
  });

  it('removeAllListeners() clears one or all events', () => {
    const e = new Emitter<{ a: []; b: [] }>();
    let count = 0;
    e.on('a', () => count++);
    e.on('b', () => count++);
    e.removeAllListeners('a');
    e.emit('a');
    e.emit('b');
    expect(count).toBe(1);
    e.removeAllListeners();
    e.emit('b');
    expect(count).toBe(1);
  });

  it('a listener can safely unsubscribe itself mid-emit', () => {
    const e = new Emitter<{ x: [] }>();
    let count = 0;
    let off: () => void = () => {};
    off = e.on('x', () => {
      count++;
      off();
    });
    e.emit('x');
    e.emit('x');
    expect(count).toBe(1);
  });
});
