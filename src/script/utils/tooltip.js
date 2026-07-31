export function initCustomTooltips(root = document) {
  let tooltipEl = null;
  let hoverTimeout = null;
  let currentTarget = null;
  let savedTitle = '';

  function createTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'custom-tooltip';
    tooltipEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function getTooltipTarget(el) {
    while (el && el !== root) {
      if (el.nodeType === Node.ELEMENT_NODE) {
        if (el.hasAttribute('title') || el.hasAttribute('data-custom-title') || el.hasAttribute('data-tooltip')) {
          return el;
        }
      }
      el = el.parentNode;
    }
    return null;
  }

  function hideTooltip() {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
    if (tooltipEl) {
      tooltipEl.classList.remove('show');
    }
    if (currentTarget && savedTitle) {
      currentTarget.setAttribute('title', savedTitle);
    }
    currentTarget = null;
    savedTitle = '';
  }

  function showTooltip(target) {
    currentTarget = target;
    savedTitle = target.getAttribute('title') || target.getAttribute('data-custom-title') || target.getAttribute('data-tooltip');
    
    if (!savedTitle) return;

    // Temporarily remove title to avoid native tooltip
    if (target.hasAttribute('title')) {
      target.setAttribute('data-custom-title', savedTitle);
      target.removeAttribute('title');
    }

    hoverTimeout = setTimeout(() => {
      const tooltip = createTooltip();
      tooltip.textContent = savedTitle;

      // Position calculations
      const targetRect = target.getBoundingClientRect();
      
      // Temporary display to read offsets
      tooltip.style.left = '0px';
      tooltip.style.top = '0px';
      tooltip.classList.add('show');
      const tooltipRect = tooltip.getBoundingClientRect();
      tooltip.classList.remove('show');

      // Default position: above the element, centered horizontally
      let left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
      let top = targetRect.top - tooltipRect.height - 8;

      // Overflow protection: Left & Right viewport boundaries
      const padding = 10;
      if (left < padding) {
        left = padding;
      } else if (left + tooltipRect.width > window.innerWidth - padding) {
        left = window.innerWidth - tooltipRect.width - padding;
      }

      // Overflow protection: Top viewport boundary (flip to bottom)
      if (top < padding) {
        top = targetRect.bottom + 8;
      }

      // Apply coordinates
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.classList.add('show');
    }, 500); // 0.5s delay
  }

  const handleMouseOver = (e) => {
    const target = getTooltipTarget(e.target);
    if (!target) return;
    if (target === currentTarget) return;

    hideTooltip();
    showTooltip(target);
  };

  const handleMouseOut = (e) => {
    if (!currentTarget) return;
    // Check if moving to a child of currentTarget
    const related = e.relatedTarget;
    if (related && currentTarget.contains(related)) return;

    hideTooltip();
  };

  const handleTriggerClose = () => {
    hideTooltip();
  };

  root.addEventListener('mouseover', handleMouseOver, { passive: true });
  root.addEventListener('mouseout', handleMouseOut, { passive: true });
  root.addEventListener('click', handleTriggerClose, { passive: true });
  window.addEventListener('scroll', handleTriggerClose, { passive: true });

  return () => {
    hideTooltip();
    root.removeEventListener('mouseover', handleMouseOver);
    root.removeEventListener('mouseout', handleMouseOut);
    root.removeEventListener('click', handleTriggerClose);
    window.removeEventListener('scroll', handleTriggerClose);
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  };
}
