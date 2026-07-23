// ===== CURSOR GLOW (HERO) =====
const cursorGlow = document.getElementById('cursorGlow');
const hero = document.querySelector('.hero');

hero.addEventListener('mouseenter', () => {
  cursorGlow.classList.add('visible');
});

hero.addEventListener('mouseleave', () => {
  cursorGlow.classList.remove('visible');
});

hero.addEventListener('mousemove', (e) => {
  cursorGlow.style.left = e.clientX + 'px';
  cursorGlow.style.top = e.clientY + 'px';
});

// ===== CUSTOM CURSOR =====
(function () {
  const cursor = document.getElementById('customCursor');
  const cursorLabel = document.getElementById('cursorLabel');
  if (!cursor || window.matchMedia('(hover: none)').matches) return;

  const interactiveSelector = [
    'a',
    'button',
    '.nft-card',
    '.arsenal-card',
    '.filter-btn',
    '.faq-question',
    '.agent-tf-tab',
    '.kagami-chip',
    '.kagami-tf-btn',
    '.inside-vanguard-prompt'
  ].join(', ');

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let cursorX = mouseX;
  let cursorY = mouseY;

  function getCursorLabel(target) {
    if (!target) return 'MOVE';
    if (target.matches('.nft-card, .arsenal-card')) return 'VIEW';
    if (target.matches('.filter-btn, .agent-tf-tab, .kagami-chip, .kagami-tf-btn')) return 'SELECT';
    if (target.matches('.faq-question')) return 'OPEN';
    if (target.matches('button')) return 'PRESS';
    if (target.matches('a')) {
      const href = target.getAttribute('href') || '';
      return href.startsWith('#') ? 'JUMP' : 'OPEN';
    }
    return 'OPEN';
  }

  function setLabel(text) {
    if (cursorLabel) cursorLabel.textContent = text;
  }

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    cursor.classList.add('visible');

    const interactive = e.target.closest(interactiveSelector);
    cursor.classList.toggle('hovering', !!interactive);
    setLabel(getCursorLabel(interactive));
  });

  document.addEventListener('mouseleave', () => {
    cursor.classList.remove('visible', 'hovering', 'clicking');
    setLabel('MOVE');
  });

  window.addEventListener('blur', () => {
    cursor.classList.remove('visible', 'hovering', 'clicking');
    setLabel('MOVE');
  });

  function updateCursor() {
    cursorX += (mouseX - cursorX) * 0.22;
    cursorY += (mouseY - cursorY) * 0.22;
    cursor.style.left = cursorX + 'px';
    cursor.style.top = cursorY + 'px';
    requestAnimationFrame(updateCursor);
  }
  updateCursor();

  document.addEventListener('mousedown', () => cursor.classList.add('clicking'));
  document.addEventListener('mouseup', () => cursor.classList.remove('clicking'));
})();

// ===== CURSOR PARTICLE TRAIL =====
(function () {
  const canvas = document.getElementById('cursorTrail');
  if (!canvas || window.matchMedia('(hover: none)').matches) return;

  const ctx = canvas.getContext('2d');
  let particles = [];
  let mouseX = 0, mouseY = 0;
  let lastX = 0, lastY = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    const dx = mouseX - lastX;
    const dy = mouseY - lastY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 8) {
      particles.push({
        x: mouseX,
        y: mouseY,
        size: Math.random() * 2.5 + 1,
        life: 1,
        decay: 0.02 + Math.random() * 0.02,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5 - 0.3
      });
      lastX = mouseX;
      lastY = mouseY;
    }
  });

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= p.decay;
      p.x += p.vx;
      p.y += p.vy;

      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = `rgba(76, 201, 138, ${p.life * 0.5})`;
      ctx.shadowBlur = 6;
      ctx.shadowColor = 'rgba(76, 201, 138, 0.3)';
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }

    // Cap particles
    if (particles.length > 60) {
      particles = particles.slice(-60);
    }

    requestAnimationFrame(animate);
  }
  animate();
})();
