(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const revealTargets = document.querySelectorAll(
    '.hero-top, .hero-actions, .featured-project, .tags, .project-showcase, ' +
    '.project-card, .hero-summary, .receipt-showcase, .footer-note'
  );

  revealTargets.forEach((element, index) => {
    element.dataset.reveal = '';
    element.style.setProperty('--reveal-delay', `${Math.min(index * 0.07, 0.42)}s`);
  });

  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach(element => element.classList.add('revealed'));
  } else {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    revealTargets.forEach(element => observer.observe(element));
  }

  if (!finePointer) return;
  document.querySelectorAll('.hero-card, .featured-project, .project-card, .compact-panel, .about-box')
    .forEach(element => {
      element.classList.add('glow-card');
      element.addEventListener('pointermove', event => {
        const rect = element.getBoundingClientRect();
        element.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        element.style.setProperty('--my', `${event.clientY - rect.top}px`);
      });
    });

  if (reducedMotion) return;
  const maxTilt = 3;
  document.querySelectorAll('.project-card, .project-highlight').forEach(element => {
    element.addEventListener('pointermove', event => {
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      element.style.transform =
        `perspective(700px) rotateX(${(-y * maxTilt).toFixed(2)}deg) ` +
        `rotateY(${(x * maxTilt).toFixed(2)}deg) translateY(-2px)`;
    });
    element.addEventListener('pointerleave', () => {
      element.style.transform = '';
    });
  });
})();
