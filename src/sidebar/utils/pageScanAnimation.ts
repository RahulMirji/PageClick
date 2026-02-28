/**
 * Vignette edge glow animation — injected into the active tab.
 * A soft cyan glow around all 4 edges of the viewport that pulses
 * with an animated light sweep traveling the perimeter.
 * Runs indefinitely until stopPageScan() is called.
 */
export async function triggerPageScan(): Promise<() => void> {
  let stopFn = () => {};

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) return stopFn;

    const url = tab.url || "";
    const isRestricted =
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("about:") ||
      url.startsWith("edge://") ||
      url.startsWith("brave://");

    if (isRestricted) return stopFn;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectVignetteOverlay,
    });

    // The injected function returns a cleanup message port ID
    // We'll stop it by injecting a stop call
    const tabId = tab.id;
    stopFn = () => {
      chrome.scripting
        .executeScript({
          target: { tabId },
          func: () => {
            const canvas = document.getElementById(
              "__pc-vignette",
            ) as HTMLCanvasElement | null;
            const pill = document.getElementById("__pc-status-pill");
            const style = document.getElementById("__pc-vignette-style");

            // Restore scrolling
            document.documentElement.style.overflow = "";
            document.body.style.overflow = "";

            if (canvas) canvas.classList.add("fade-out");
            if (pill) pill.classList.add("fade-out");

            setTimeout(() => {
              if (canvas) canvas.remove();
              if (pill) pill.remove();
              if (style) style.remove();
            }, 800);
          },
        })
        .catch(() => {});
    };
  } catch (err) {
    console.warn("PageScan: could not inject animation", err);
  }

  return stopFn;
}

function injectVignetteOverlay() {
  // Cleanup existing
  const existing = document.getElementById("__pc-vignette");
  if (existing) existing.remove();
  const existingPill = document.getElementById("__pc-status-pill");
  if (existingPill) existingPill.remove();
  const existingStyle = document.getElementById("__pc-vignette-style");
  if (existingStyle) existingStyle.remove();

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // Disable scrolling
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";

  const COLOR = { r: 0, g: 212, b: 255 }; // Cyan only

  // ── Style ──
  const style = document.createElement("style");
  style.id = "__pc-vignette-style";
  style.textContent = `
        #__pc-vignette {
            position: fixed; top: 0; left: 0;
            width: 100vw; height: 100vh;
            z-index: 2147483646;
            pointer-events: auto;
            cursor: wait;
            opacity: 0;
            transition: opacity 0.4s ease-out;
        }
        #__pc-vignette.visible { opacity: 1; }
        #__pc-vignette.fade-out { opacity: 0; transition: opacity 0.8s ease-in; }

        #__pc-status-pill {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            z-index: 2147483647;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border: 1px solid rgba(0, 212, 255, 0.3);
            border-radius: 12px;
            padding: 12px 20px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3), 0 0 15px rgba(0, 212, 255, 0.2);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            opacity: 0;
            transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
        }
        #__pc-status-pill.visible {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        #__pc-status-pill.fade-out {
            opacity: 0;
            transform: translateX(-50%) translateY(10px);
            transition: all 0.5s ease-in;
        }
        
        #__pc-text-container {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        
        #__pc-status-text {
            color: #fff;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.2;
        }
        #__pc-status-subtext {
            color: rgba(255, 255, 255, 0.6);
            font-size: 12px;
            font-weight: 400;
            line-height: 1.2;
        }
        
        #__pc-spinner {
            width: 18px;
            height: 18px;
            border: 2px solid rgba(0, 212, 255, 0.3);
            border-top-color: #00D4FF;
            border-radius: 50%;
            animation: __pc-spin 1s linear infinite;
            flex-shrink: 0;
        }
        
        @keyframes __pc-spin {
            to { transform: rotate(360deg); }
        }
    `;
  document.head.appendChild(style);

  // ── Canvas ──
  const canvas = document.createElement("canvas");
  canvas.id = "__pc-vignette";
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  document.body.appendChild(canvas);

  // ── Status Pill ──
  const pill = document.createElement("div");
  pill.id = "__pc-status-pill";
  pill.innerHTML = `
        <div id="__pc-spinner"></div>
        <div id="__pc-text-container">
            <span id="__pc-status-text">PageClick is working</span>
            <span id="__pc-status-subtext">You can't click or modify here</span>
        </div>
    `;
  document.body.appendChild(pill);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    pill.remove();
    style.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  // Reveal animation
  requestAnimationFrame(() => {
    canvas.classList.add("visible");
    setTimeout(() => pill.classList.add("visible"), 100);
  });

  const { r, g, b } = COLOR;

  // ── Render vignette frame ──
  function renderVignette(breathAlpha: number, sweepAngle: number) {
    ctx!.clearRect(0, 0, W, H);

    // === LAYER 1: Soft edge vignette gradients on all 4 sides ===
    const edgeDepth = Math.min(W, H) * 0.35;
    const baseAlpha = 0.3 * breathAlpha;

    // Top edge
    const topGrad = ctx!.createLinearGradient(0, 0, 0, edgeDepth);
    topGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${baseAlpha})`);
    topGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx!.fillStyle = topGrad;
    ctx!.fillRect(0, 0, W, edgeDepth);

    // Bottom edge
    const botGrad = ctx!.createLinearGradient(0, H, 0, H - edgeDepth);
    botGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${baseAlpha})`);
    botGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx!.fillStyle = botGrad;
    ctx!.fillRect(0, H - edgeDepth, W, edgeDepth);

    // Left edge
    const leftGrad = ctx!.createLinearGradient(0, 0, edgeDepth, 0);
    leftGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${baseAlpha})`);
    leftGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx!.fillStyle = leftGrad;
    ctx!.fillRect(0, 0, edgeDepth, H);

    // Right edge
    const rightGrad = ctx!.createLinearGradient(W, 0, W - edgeDepth, 0);
    rightGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${baseAlpha})`);
    rightGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx!.fillStyle = rightGrad;
    ctx!.fillRect(W - edgeDepth, 0, edgeDepth, H);

    // === LAYER 2: Corner glow intensifiers ===
    const cornerRadius = edgeDepth * 1.2;
    const cornerAlpha = 0.2 * breathAlpha;
    const corners = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ];
    for (const c of corners) {
      const cGrad = ctx!.createRadialGradient(
        c.x,
        c.y,
        0,
        c.x,
        c.y,
        cornerRadius,
      );
      cGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${cornerAlpha})`);
      cGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx!.fillStyle = cGrad;
      ctx!.fillRect(
        c.x - cornerRadius,
        c.y - cornerRadius,
        cornerRadius * 2,
        cornerRadius * 2,
      );
    }

    // === LAYER 3: Traveling light sweep along the edges ===
    const perimeter = 2 * (W + H);
    const sweepPos = ((sweepAngle % (Math.PI * 2)) / (Math.PI * 2)) * perimeter;
    let sx: number, sy: number;

    if (sweepPos < W) {
      sx = sweepPos;
      sy = 0;
    } else if (sweepPos < W + H) {
      sx = W;
      sy = sweepPos - W;
    } else if (sweepPos < 2 * W + H) {
      sx = W - (sweepPos - W - H);
      sy = H;
    } else {
      sx = 0;
      sy = H - (sweepPos - 2 * W - H);
    }

    const sweepRadius = Math.min(W, H) * 0.18;
    const sweepAlpha = 0.25 * breathAlpha;
    const sweepGrad = ctx!.createRadialGradient(sx, sy, 0, sx, sy, sweepRadius);
    sweepGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${sweepAlpha})`);
    sweepGrad.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${sweepAlpha * 0.4})`);
    sweepGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx!.fillStyle = sweepGrad;
    ctx!.fillRect(
      sx - sweepRadius,
      sy - sweepRadius,
      sweepRadius * 2,
      sweepRadius * 2,
    );

    // Second sweep (offset by half)
    const sweep2Pos =
      (((sweepAngle + Math.PI) % (Math.PI * 2)) / (Math.PI * 2)) * perimeter;
    let sx2: number, sy2: number;

    if (sweep2Pos < W) {
      sx2 = sweep2Pos;
      sy2 = 0;
    } else if (sweep2Pos < W + H) {
      sx2 = W;
      sy2 = sweep2Pos - W;
    } else if (sweep2Pos < 2 * W + H) {
      sx2 = W - (sweep2Pos - W - H);
      sy2 = H;
    } else {
      sx2 = 0;
      sy2 = H - (sweep2Pos - 2 * W - H);
    }

    const sweep2Grad = ctx!.createRadialGradient(
      sx2,
      sy2,
      0,
      sx2,
      sy2,
      sweepRadius * 0.8,
    );
    sweep2Grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${sweepAlpha * 0.6})`);
    sweep2Grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${sweepAlpha * 0.2})`);
    sweep2Grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx!.fillStyle = sweep2Grad;
    ctx!.fillRect(
      sx2 - sweepRadius,
      sy2 - sweepRadius,
      sweepRadius * 2,
      sweepRadius * 2,
    );
  }

  // ── Main loop — runs indefinitely until canvas is removed ──
  let startTime = 0;

  function animate(timestamp: number) {
    // Stop if canvas was removed (stopPageScan was called)
    if (!document.getElementById("__pc-vignette")) return;

    if (startTime === 0) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const t = elapsed / 1000;

    // Breathing pulse
    const breathAlpha = 0.7 + 0.3 * Math.sin(t * 1.8);

    // Fade in during first 400ms
    let globalAlpha = 1;
    if (elapsed < 400) {
      globalAlpha = elapsed / 400;
    }

    // Continuous sweep rotation (~8s per full loop)
    const sweepAngle = (t / 8) * Math.PI * 2;

    ctx!.globalAlpha = globalAlpha;
    renderVignette(breathAlpha, sweepAngle);
    ctx!.globalAlpha = 1;

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}
