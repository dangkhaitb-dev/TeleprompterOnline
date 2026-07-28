/* eslint-disable no-restricted-properties */
// teleprompter-main.js — entry for the teleprompter record page.
// Reads ?ws=<id>, loads that workspace through the logic layer, then boots the
// record UI via the shared boot module (also used by the in-page overlay).

import '../styles/reset.css';
import '../styles/tokens.css';
import '../styles/components/back-btn.css';
import '../styles/teleprompter.css';

import { bootTeleprompter } from './features/teleprompter/teleprompter-boot.ui.js';
import {
  loadWorkspace,
  createScratchWorkspace,
} from './features/teleprompter/teleprompter.logic.js';
import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';

releasePointerButtonFocus();

const params = new URLSearchParams(window.location.search);

// Seeding logic for demo
if (params.has('seed')) {
  localStorage.setItem('solprompter:folders', JSON.stringify([
    { id: 'folder-1', name: 'Youtube Videos', parentId: null },
    { id: 'folder-2', name: 'Sales Demos', parentId: null },
    { id: 'folder-3', name: 'Online Courses', parentId: null },
  ]));
  localStorage.setItem('solprompter:workspaces', JSON.stringify([
    {
      id: 'ws-demo-1',
      title: 'How to use AI Voice Scroll',
      scriptText: 'Welcome to this tutorial on SolPrompter. Today, we will explore the AI Voice Scroll feature which automatically moves through your script at your natural speaking pace...',
      scriptHtml: 'Welcome to this tutorial on SolPrompter. Today, we will explore the AI Voice Scroll feature which automatically moves through your script at your natural speaking pace...',
      folderId: 'folder-1',
      settings: { pageTheme: 'dark', fontSize: 24 },
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 600000
    },
    {
      id: 'ws-demo-2',
      title: 'Product Launch Keynote 2026',
      scriptText: 'Hello everyone! I am thrilled to introduce our newest updates. We have spent months building a faster, cleaner teleprompter that works on any device...',
      scriptHtml: 'Hello everyone! I am thrilled to introduce our newest updates. We have spent months building a faster, cleaner teleprompter that works on any device...',
      folderId: 'folder-2',
      settings: { pageTheme: 'dark' },
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now() - 3600000
    },
    {
      id: 'ws-demo-3',
      title: 'Course Introduction: Coding 101',
      scriptText: 'Welcome to Coding 101. In this series of lessons, you will learn the fundamentals of web development starting with simple HTML, CSS and Javascript...',
      scriptHtml: 'Welcome to Coding 101. In this series of lessons, you will learn the fundamentals of web development starting with simple HTML, CSS and Javascript...',
      folderId: 'folder-3',
      settings: { pageTheme: 'dark' },
      createdAt: Date.now() - 172800000,
      updatedAt: Date.now() - 86400000
    },
    {
      id: 'ws-demo-4',
      title: 'Shorts: 3 Tips for Better Speeches',
      scriptText: 'Here are 3 tips for presenting like a pro. First, keep your script close to the camera. Second, pause to highlight key details. Third, speak naturally...',
      scriptHtml: 'Here are 3 tips for presenting like a pro. First, keep your script close to the camera. Second, pause to highlight key details. Third, speak naturally...',
      folderId: null,
      settings: { pageTheme: 'dark' },
      createdAt: Date.now() - 259200000,
      updatedAt: Date.now() - 172800000
    }
  ]));
  localStorage.setItem('solprompter:ws-seeded', 'true');
}

const workspaceId = params.get('ws');

// No workspace (opened with no ?ws=, or a stale/deleted id) is not a dead end:
// auto-create a fresh workspace so the studio is immediately usable with no
// content — no blocking empty state. Reflect the new id in the URL so reloads,
// the session lock, and GC all track it like any normal script.
let workspace = loadWorkspace(workspaceId);

if (!workspace) {
  workspace = createScratchWorkspace();
  const next = `${window.location.pathname}?ws=${encodeURIComponent(workspace.id)}`;
  window.history.replaceState(null, '', next);
}

// The standalone page never calls destroy(): teardown runs on pagehide and the
// browser releases the session lock when the page goes away.
bootTeleprompter({ workspace }).catch((error) => {
  // Never turn an initialization failure into a mysteriously inert UI.
  // Storage is normalized before this point; remaining boot failures belong in
  // the console so they can be diagnosed without deleting user data.
  console.error('[Teleprompter] Failed to initialize the studio', error);
});

if (params.has('notch')) {
  setTimeout(() => {
    const control = document.getElementById('notchControl');
    if (control) control.click();
  }, 1000);
}
