// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirstVisitTour } from './first-visit-tour.ui.js';

describe('createFirstVisitTour', () => {
  let controller;
  let targets;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="first">First action</button>
      <button id="second">Second action</button>
      <button id="third">Third action</button>
    `;
    targets = ['first', 'second', 'third'].map((id) => document.getElementById(id));
    targets[0].getBoundingClientRect = () => ({
      left: 80, top: 60, right: 200, bottom: 104, width: 120, height: 44,
    });
    targets[1].getBoundingClientRect = () => ({
      left: 300, top: 180, right: 460, bottom: 224, width: 160, height: 44,
    });
    targets[2].getBoundingClientRect = () => ({
      left: 520, top: 300, right: 700, bottom: 344, width: 180, height: 44,
    });
  });

  afterEach(() => {
    controller?.destroy();
    controller = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('renders safe copy while clicked controls keep their normal action', () => {
    const onComplete = vi.fn();
    const targetActions = targets.map(() => vi.fn());
    targets.forEach((target, index) => target.addEventListener('click', targetActions[index]));
    const steps = [
      { target: targets[0], text: '<img src=x onerror=alert(1)> Start here' },
      { target: targets[1], text: 'Then configure the pace' },
      { target: targets[2], text: 'Finally, begin presenting' },
    ];

    controller = createFirstVisitTour({
      root: document,
      steps,
      skipLabel: 'Skip tour',
      ariaLabel: 'Teleprompter quick tour',
      onComplete,
    });
    controller.start();

    const overlay = document.querySelector('.first-visit-tour-overlay');
    const popup = document.querySelector('.first-visit-tour-popup');
    expect(overlay).not.toBeNull();
    expect(document.querySelector('.first-visit-tour-spotlight')).toBeNull();
    expect(popup.textContent).toContain('<img src=x onerror=alert(1)> Start here');
    expect(popup.getAttribute('aria-label')).toBe('Teleprompter quick tour');
    expect(popup.querySelector('img')).toBeNull();
    expect(popup.querySelector('.first-visit-tour-skip').textContent).toBe('Skip tour');
    expect(popup.querySelector('.first-visit-tour-arrow')).not.toBeNull();
    expect(popup.dataset.placement).toBe('below');
    expect(popup.style.top).toBe('116px');

    targets[0].click();
    expect(popup.textContent).toContain('Then configure the pace');
    expect(popup.style.top).toBe('236px');
    expect(targetActions[0]).toHaveBeenCalledOnce();

    targets[1].click();
    expect(popup.textContent).toContain('Finally, begin presenting');
    expect(popup.style.top).toBe('356px');
    expect(targetActions[1]).toHaveBeenCalledOnce();

    popup.click();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();
    expect(targetActions[2]).not.toHaveBeenCalled();

    overlay.click();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('stops Skip clicks from advancing and completes only once', () => {
    const onComplete = vi.fn();
    controller = createFirstVisitTour({
      steps: targets.map((target, index) => ({ target, text: `Step ${index + 1}` })),
      skipLabel: 'Not now',
      onComplete,
    });
    controller.start();

    const overlay = document.querySelector('.first-visit-tour-overlay');
    const skip = document.querySelector('.first-visit-tour-skip');
    const overlayClick = vi.fn();
    overlay.addEventListener('click', overlayClick);
    skip.click();

    expect(overlayClick).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();

    skip.click();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('uses Escape as Skip and safely centers a step whose target has no layout box', () => {
    const onComplete = vi.fn();
    targets[0].getBoundingClientRect = () => ({
      left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0,
    });
    controller = createFirstVisitTour({
      steps: targets.map((target, index) => ({ target, text: `Step ${index + 1}` })),
      onComplete,
    });
    controller.start();

    const popup = document.querySelector('.first-visit-tour-popup');
    expect(popup.style.left).toBe('50%');
    expect(popup.style.top).toBe('50%');
    expect(popup.style.transform).toBe('translate(-50%, -50%)');
    expect(popup.dataset.placement).toBe('center');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('positions the popup arrow from a native DOMRect', () => {
    targets[0].getBoundingClientRect = () => new DOMRect(120, 90, 140, 48);
    controller = createFirstVisitTour({
      steps: targets.map((target, index) => ({ target, text: `Step ${index + 1}` })),
    });

    controller.start();

    const popup = document.querySelector('.first-visit-tour-popup');
    expect(popup.dataset.placement).toBe('below');
    expect(popup.style.top).toBe('150px');
    expect(popup.style.getPropertyValue('--first-visit-tour-arrow-left')).toBe('160px');
  });

  it('stays non-modal so background controls remain keyboard-accessible', () => {
    controller = createFirstVisitTour({
      steps: targets.map((target, index) => ({ target, text: `Step ${index + 1}` })),
    });
    controller.start();

    expect(document.querySelector('.first-visit-tour-popup').hasAttribute('aria-modal')).toBe(false);
    expect(targets.every((target) => !target.hasAttribute('inert'))).toBe(true);
    targets[0].focus();
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(targets[0]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(targets.every((target) => !target.hasAttribute('inert'))).toBe(true);
  });

  it('resolves a dynamic target again after viewport changes', () => {
    let currentTarget = targets[0];
    controller = createFirstVisitTour({
      steps: [{ target: () => currentTarget, text: 'Responsive target' }],
    });
    controller.start();

    const popup = document.querySelector('.first-visit-tour-popup');
    expect(popup.style.top).toBe('116px');
    currentTarget = targets[1];
    window.dispatchEvent(new Event('resize'));
    expect(popup.style.top).toBe('236px');
  });

  it('lets a real final target click act and closes synchronously', () => {
    const onComplete = vi.fn();
    const targetAction = vi.fn();
    targets[0].addEventListener('click', targetAction);
    controller = createFirstVisitTour({
      steps: [{ target: targets[0], text: 'Only step' }],
      onComplete,
    });
    controller.start();

    targets[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(targetAction).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();
  });

  it('does not cancel native control behavior while advancing', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.append(checkbox);
    checkbox.getBoundingClientRect = targets[0].getBoundingClientRect;
    controller = createFirstVisitTour({
      steps: [{ target: checkbox, text: 'Toggle normally' }],
    });
    controller.start();

    checkbox.click();
    expect(checkbox.checked).toBe(true);
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();
  });

  it('is idempotent and destroy removes the active tour without completing it', () => {
    const onComplete = vi.fn();
    controller = createFirstVisitTour({
      steps: targets.map((target, index) => ({ target, text: `Step ${index + 1}` })),
      onComplete,
    });

    controller.start();
    controller.start();
    expect(document.querySelectorAll('.first-visit-tour-overlay')).toHaveLength(1);

    controller.destroy();
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onComplete).not.toHaveBeenCalled();
  });
});
