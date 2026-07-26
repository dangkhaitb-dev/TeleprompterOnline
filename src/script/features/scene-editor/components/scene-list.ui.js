// scene-list.ui.js — sidebar scene rail: index badges, thumbnails (video frame
// or waveform), select/delete, "New Scene", a "More" menu with Delete All, and
// the add-scene placeholder. Talks to the host via callbacks only (no services).

import { formatDuration } from '../scene-editor.model.js';
import { getVideoThumbnail } from '../../../components/video-thumbnail.js';
import {
  ICON_PLUS, ICON_PLUS_THIN, ICON_DELETE, ICON_DOTS, ICON_TRASH,
  ICON_MEDIA_BADGE, waveformSvg,
} from './icons.js';

// createSceneList({ signal, labels, onSelect, onDelete, onAddScene, onDeleteAll })
export function createSceneList({
  signal,
  labels = {},
  onSelect,
  onDelete,
  onAddScene,
  onDeleteAll,
}) {
  // Token so thumbnail draws that resolve after a re-render/teardown no-op.
  let renderToken = 0;
  let scenes = [];
  let selectedIndex = -1;

  const el = document.createElement('aside');
  el.className = 'se-sidebar';
  el.setAttribute('aria-label', labels.scenes || 'Scenes');
  el.innerHTML = `
    <div class="se-scene-toolbar">
      <button class="se-new-scene" type="button" data-role="new-scene">
        ${ICON_PLUS}<span>${labels.newScene || 'New Scene'}</span>
      </button>
      <button class="se-more-button" type="button" data-role="more" aria-haspopup="menu"
        aria-expanded="false" aria-label="${labels.more || 'More options'}">${ICON_DOTS}</button>
      <div class="se-more-dropdown" role="menu" hidden>
        <button class="se-more-dropdown-item" type="button" role="menuitem" data-role="delete-all">
          <span class="se-more-dropdown-icon" aria-hidden="true">${ICON_TRASH}</span>
          <span>${labels.deleteAll || 'Delete All Scenes'}</span>
        </button>
      </div>
    </div>
    <div class="se-scene-scroll">
      <div class="se-scene-list" data-role="scene-list"></div>
    </div>`;

  const listEl = el.querySelector('[data-role="scene-list"]');
  const moreButton = el.querySelector('[data-role="more"]');
  const dropdown = el.querySelector('.se-more-dropdown');

  const setDropdown = (open) => {
    dropdown.hidden = !open;
    moreButton.setAttribute('aria-expanded', String(open));
  };

  // --- render -------------------------------------------------------------
  function render(nextScenes, nextSelected) {
    scenes = nextScenes;
    selectedIndex = nextSelected;
    const token = ++renderToken;

    const items = scenes.map((scene, index) => {
      const item = document.createElement('div');
      item.className = 'se-scene-item';
      item.dataset.index = String(index);
      if (index === selectedIndex) item.classList.add('active');
      item.innerHTML = `
        <span class="se-scene-index">${index + 1}</span>
        <button class="se-scene-card" type="button" data-role="select"
          aria-label="${(labels.scene || 'Scene')} ${index + 1}"></button>
        <button class="se-scene-delete" type="button" data-role="delete"
          aria-label="${(labels.deleteScene || 'Delete scene')} ${index + 1}">${ICON_DELETE}</button>`;
      fillCard(item.querySelector('.se-scene-card'), scene, token);
      return item;
    });

    const recordRow = document.createElement('div');
    recordRow.className = 'se-record-row';
    recordRow.innerHTML = `
      <button class="se-add-scene" type="button" data-role="add-scene"
        aria-label="${labels.addScene || 'Add scene'}">${ICON_PLUS_THIN}</button>`;

    listEl.replaceChildren(...items, recordRow);
  }

  function fillCard(card, scene, token) {
    const timeBadge = document.createElement('span');
    timeBadge.className = 'se-scene-time';
    timeBadge.textContent = formatDuration(scene.duration);

    if (scene.kind === 'video') {
      const badge = document.createElement('span');
      badge.className = 'se-scene-media-badge';
      badge.innerHTML = `${ICON_MEDIA_BADGE}<span>${labels.video || 'Video'}</span>`;
      card.append(badge, timeBadge);
      // Memoized per recording id — re-renders (every scene click) must not
      // spin up a fresh <video> decoder per card.
      getVideoThumbnail(scene.id, scene.blob).then((dataUrl) => {
        if (!dataUrl || token !== renderToken || !badge.isConnected) return;
        const img = document.createElement('img');
        img.alt = '';
        img.src = dataUrl;
        badge.replaceWith(img);
      });
    } else {
      const waveform = document.createElement('div');
      waveform.className = 'se-scene-waveform';
      waveform.innerHTML = waveformSvg('se-scene-waveform-svg');
      card.append(waveform, timeBadge);
    }
  }

  // --- events -------------------------------------------------------------
  listEl.addEventListener('click', (event) => {
    const item = event.target.closest('.se-scene-item');
    if (event.target.closest('[data-role="add-scene"]')) { onAddScene?.(); return; }
    if (!item) return;
    const index = Number(item.dataset.index);
    if (event.target.closest('[data-role="delete"]')) { onDelete?.(index); return; }
    if (event.target.closest('[data-role="select"]')) onSelect?.(index);
  }, { signal });

  el.querySelector('[data-role="new-scene"]').addEventListener('click', () => onAddScene?.(), { signal });

  moreButton.addEventListener('click', (event) => {
    event.stopPropagation();
    setDropdown(dropdown.hidden);
  }, { signal });
  el.querySelector('[data-role="delete-all"]').addEventListener('click', () => {
    setDropdown(false);
    onDeleteAll?.();
  }, { signal });
  document.addEventListener('click', (event) => {
    if (!dropdown.hidden && !dropdown.contains(event.target) && event.target !== moreButton) {
      setDropdown(false);
    }
  }, { signal });

  return { el, render };
}
