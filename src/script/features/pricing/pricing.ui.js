function activateCycle(tabs, activeTab) {
  tabs.forEach((tab) => {
    const selected = tab === activeTab;
    const panel = tab.ownerDocument.getElementById(tab.getAttribute('aria-controls'));
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (panel) panel.hidden = !selected;
  });
}

export function initPricingUI({ root = document } = {}) {
  const tabs = [...root.querySelectorAll('[data-billing-cycle][role="tab"]')];
  if (tabs.length === 0) return;

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateCycle(tabs, tab));
    tab.addEventListener('keydown', (event) => {
      let nextIndex;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex === undefined) return;
      event.preventDefault();
      activateCycle(tabs, tabs[nextIndex]);
      tabs[nextIndex].focus();
    });
  });
}
