// studio-panels.ui.js — aggregator for the studio controls that aren't needed
// for first paint: the device/ratio popups (hidden until opened) and panel
// drag/resize (nobody drags in the first frames). teleprompter.ui pulls this
// chunk eagerly right *after* mount, so the script is already scrolling while
// these bytes are in flight; early clicks await the load.
//
// settings-theme deliberately stays in the main chunk — it applies the panel
// background theme at init, so deferring it would flash an un-themed panel.

import { initPopups } from './popups.ui.js';
import { initPanelDrag } from './panel-drag.ui.js';

export function initStudioPanels({ popups, panelDrag }) {
  const popupsApi = initPopups(popups);
  const panelDragApi = initPanelDrag(panelDrag);

  let destroyed = false;
  return {
    popups: popupsApi,
    panelDrag: panelDragApi,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      popupsApi.destroy();
      panelDragApi.destroy();
    },
  };
}
