window.__ModuleLoader__.load({
  id: '@local/codex-pet',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'codexPet';

    /** Codex spritesheet: 8 cols x 9 rows, 192x208 per frame (model.rs catalog constants). */
    const COLS = 8;
    const ROWS = 9;
    const FRAME_W = 192;
    const FRAME_H = 208;
    const SPRITE_URL = 'https://persistent.oaistatic.com/codex/pets/v1/codex-spritesheet-v4.webp';
    /** Codex ambient.rs: PET_TARGET_HEIGHT_PX=75, PET_COMPOSER_GAP_PX=10. */
    const SPRITE_H = 75;
    const SPRITE_W = (SPRITE_H * FRAME_W) / FRAME_H; // 69.23
    const COMPOSER_GAP = 10;

    const zh = {
      running: '思考中',
      waiting: '需要输入',
      review: '就绪',
      failed: '已阻塞',
    };
    const en = {
      running: 'Thinking',
      waiting: 'Needs input',
      review: 'Ready',
      failed: 'Blocked',
    };

    const css = `
.cxp-root{position:absolute;right:24px;bottom:130px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;pointer-events:none;user-select:none;z-index:30}
.cxp-bubble{max-width:180px;padding:4px 10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap}
.cxp-sprite{width:${SPRITE_W.toFixed(2)}px;height:${SPRITE_H}px;background-image:url("${SPRITE_URL}");background-size:800% 900%;background-repeat:no-repeat;image-rendering:auto;will-change:background-position}
@media (prefers-reduced-motion:reduce){.cxp-sprite{animation:none}}
`;

    const tagId = '@local/codex-pet/codex-pet.css';
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/codex-pet';
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    /** Idle animation: model.rs idle_animation() frames, loop_start=0. */
    const IDLE_FRAMES = [[0, 1680], [1, 660], [2, 660], [3, 840], [4, 840], [5, 1920]];

    /**
     * model.rs app_state_animation(): primary frames (row x frame_count) x3,
     * then idle frames appended; loop_start = primary_frame_count.
     */
    function appStateAnimation(rowIndex, frameCount, frameDurationMs, finalFrameDurationMs) {
      const primary = [];
      for (let col = 0; col < frameCount; col++) {
        const idx = rowIndex * COLS + col;
        const dur = col === frameCount - 1 ? finalFrameDurationMs : frameDurationMs;
        primary.push([idx, dur]);
      }
      const frames = [...primary, ...primary, ...primary, ...IDLE_FRAMES];
      return { frames, loopStart: primary.length * 3 };
    }

    const ANIMATIONS = {
      idle: { frames: IDLE_FRAMES, loopStart: 0 },
      running: appStateAnimation(7, 6, 120, 220),
      waiting: appStateAnimation(6, 6, 150, 260),
      review: appStateAnimation(8, 6, 150, 280),
      failed: appStateAnimation(5, 8, 140, 240),
    };

    function totalDuration(frames) {
      return frames.reduce((sum, [, dur]) => sum + dur, 0);
    }

    function frameAtElapsed(frames, elapsedMs) {
      let remaining = elapsedMs;
      for (const [idx, dur] of frames) {
        const d = Math.max(1, dur);
        if (remaining < d) return idx;
        remaining -= d;
      }
      return frames[frames.length - 1][0];
    }

    /** model.rs current_animation_frame(): prefix once, then loop the tail. */
    function currentFrame(anim, elapsedMs) {
      const frames = anim.frames;
      if (frames.length <= 1) return frames[0][0];
      if (anim.loopStart != null && anim.loopStart < frames.length) {
        const total = totalDuration(frames);
        const prefix = totalDuration(frames.slice(0, anim.loopStart));
        const loop = totalDuration(frames.slice(anim.loopStart));
        let effective = elapsedMs;
        if (elapsedMs >= total && loop > 0) {
          effective = prefix + ((elapsedMs - prefix) % loop);
        }
        return frameAtElapsed(frames, effective);
      }
      if (elapsedMs >= totalDuration(frames)) return frames[frames.length - 1][0];
      return frameAtElapsed(frames, elapsedMs);
    }

    /**
     * Map DSH session state to Codex pet state.
     * Codex PetNotificationKind: Running/Waiting/Review/Failed + idle when no notification.
     * Truth source: dsh-client-ui-workspace/lib/client.js:1066-1068 (sessionNode).
     * - running     -> status?.running ?? row.running
     * - completed   -> status?.completionUnread === true  -> Review (Ready)
     * - pending     -> status?.pendingInteraction?.kind   -> Waiting (Needs input)
     * - Failed has no DSH equivalent (no failed field); do not fabricate it.
     * Priority matches Codex semantics + DSH status: pending > running > completed > idle.
     */
    function resolveState(mainRow, statuses) {
      if (mainRow === undefined) return 'idle';
      const status = statuses.get(mainRow.id);
      const running = (status && status.running !== undefined ? status.running : mainRow.running) === true;
      const pending = status && status.pendingInteraction;
      const completed = status ? status.completionUnread === true : false;
      if (pending !== undefined) return 'waiting';
      if (running) return 'running';
      if (completed) return 'review';
      return 'idle';
    }

    function CodexPet({ useSessions, useSessionStatus, t }) {
      const mainRow = useSessions((s) =>
        Object.values(s.byId).find((row) => (row.retainedBy?.mainView ?? 0) > 0),
      );
      const statuses = useSessionStatus((s) => s);

      const state = resolveState(mainRow, statuses);

      const rootRef = React.useRef(null);
      const spriteRef = React.useRef(null);
      const stateRef = React.useRef(state);
      const startRef = React.useRef(0);

      React.useEffect(() => {
        if (stateRef.current !== state) {
          stateRef.current = state;
          startRef.current = performance.now();
        }
      }, [state]);

      React.useEffect(() => {
        let raf = 0;
        const tick = (now) => {
          const anim = ANIMATIONS[stateRef.current] ?? ANIMATIONS.idle;
          const idx = currentFrame(anim, now - startRef.current);
          const el = spriteRef.current;
          if (el) {
            const row = Math.floor(idx / COLS);
            const col = idx % COLS;
            el.style.backgroundPosition =
              ((col / (COLS - 1)) * 100) + '% ' + ((row / (ROWS - 1)) * 100) + '%';
          }
          raf = requestAnimationFrame(tick);
        };
        startRef.current = performance.now();
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
      }, []);

      React.useEffect(() => {
        const root = rootRef.current;
        const seat = document.querySelector('[data-composer-seat]');
        if (!root || !seat) return;
        const update = () => {
          root.style.bottom = (seat.offsetHeight + COMPOSER_GAP) + 'px';
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(seat);
        return () => ro.disconnect();
      }, []);

      return h('div', { className: 'cxp-root', ref: rootRef },
        state === 'idle' ? null : h('div', { className: 'cxp-bubble' }, t(state)),
        h('div', { className: 'cxp-sprite', ref: spriteRef, role: 'img', 'aria-label': state === 'idle' ? 'Codex pet' : t(state) }),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'codex-pet: dictionaries');
        const t = ctx.locale.bind(NS);

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'codex-pet',
          locale: NS,
          inject: () => ({ t }),
        }, CodexPet));
      },
    };
  },
});
