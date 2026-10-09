/* ==========================================================================
   Dot Cursor — version JavaScript pur (adaptée du composant React d'Originkit)
   Un point suit la souris avec une traînée qui s'efface.
   - Grossit en anneau au survol des liens / boutons
   - Souligne l'élément si il porte aria-label="trail{link}"
   - Se désactive sur les écrans tactiles et si "réduire les animations" est actif
   ========================================================================== */
(function () {
  "use strict";

  // 1) On n'active l'effet que sur les appareils avec une vraie souris
  var finePointer = window.matchMedia("(pointer: fine)").matches;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!finePointer || reduceMotion) return;

  /* ---------------------- RÉGLAGES (modifie ici) ---------------------- */
  var CONFIG = {
    headColor: "#1F2039",   // couleur du point
    trailColor: "#1F2039",  // couleur de la traînée
    size: 12,               // diamètre du point (px)
    trailLength: 11,        // longueur de la traînée (x 40 ms de durée de vie)
    trailThickness: 12      // épaisseur de la traînée
  };

  var FOLLOW_TAU = 0.01;    // plus petit = le point colle plus vite à la souris
  var SNAPPINESS = 10;      // vitesse des animations (anneau, soulignement)
  var BORDER_WIDTH = 2;     // épaisseur de l'anneau / du soulignement
  var HOVER_SCALE = 3.3;    // taille de l'anneau au survol d'un lien

  // Éléments spéciaux (identiques à l'original)
  var HIDE_SELECTOR =
    '[aria-label~="trail{hide}"],[data-framer-name~="trail{hide}"]';
  var LINK_SELECTOR =
    '[aria-label~="trail{link}"],[data-framer-name~="trail{link}"]';
  var RING_SELECTOR = 'a,button,[role="button"]';

  /* ------------------------- Outil : couleur + alpha ------------------------- */
  function withAlpha(input, alpha) {
    var a = Math.max(0, Math.min(1, alpha));
    if (typeof input !== "string") return "rgba(0,0,0," + a + ")";
    var s = input.trim();

    var hex = s.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      var h = hex[1];
      if (h.length === 3 || h.length === 4) {
        h = h.split("").map(function (c) { return c + c; }).join("");
      }
      var n = parseInt(h.slice(0, 6), 16);
      if (!isFinite(n)) return "rgba(0,0,0," + a + ")";
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
    }

    var rgb = s.match(/^rgba?\(([^)]+)\)/i);
    if (rgb) {
      var parts = rgb[1].split(",").map(parseFloat);
      if (parts.length >= 3 && parts.slice(0, 3).every(isFinite)) {
        return "rgba(" + parts[0] + "," + parts[1] + "," + parts[2] + "," + a + ")";
      }
    }
    return "rgba(0,0,0," + a + ")";
  }

  /* ------------------- Création du calque + du canvas ------------------- */
  var host = document.createElement("div");
  host.className = "dot-cursor";
  host.setAttribute("aria-hidden", "true");

  var canvas = document.createElement("canvas");
  canvas.className = "dot-cursor__canvas";
  host.appendChild(canvas);
  document.body.appendChild(host);

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var w = 1;
  var h = 1;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, host.clientWidth);
    h = Math.max(1, host.clientHeight);
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  // Convertit les coordonnées de la souris en coordonnées du canvas
  function localize(clientX, clientY) {
    var rect = host.getBoundingClientRect();
    var sx = rect.width > 0 ? host.clientWidth / rect.width : 1;
    var sy = rect.height > 0 ? host.clientHeight / rect.height : 1;
    return {
      x: (clientX - rect.left) * sx,
      y: (clientY - rect.top) * sy,
      over:
        clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom
    };
  }

  // Cache / réaffiche le curseur natif
  var cursorHidden = false;
  function hideNativeCursor(hide) {
    if (hide === cursorHidden) return;
    cursorHidden = hide;
    document.documentElement.classList.toggle("dot-cursor-active", hide);
  }

  /* ------------------------------ État ------------------------------ */
  var ballX = 0, ballY = 0;
  var targetX = 0, targetY = 0;

  var radius = CONFIG.size / 2;
  var fillOpacity = 1;
  var strokeOpacity = 0;
  var lineOpacity = 0;
  var lineWidth = 0;
  var lineTargetWidth = 0;

  var points = [];          // points de la traînée {x, y, age}
  var hitDirty = true;
  var overHide = false;
  var overRing = false;
  var linkEl = null;
  var seeded = false;
  var inside = false;
  var hitX = 0, hitY = 0;

  function seedAt(x, y) {
    seeded = true;
    targetX = x; targetY = y;
    ballX = x;   ballY = y;
    canvas.style.opacity = "1";
    points = [];
  }

  // Quand la souris quitte la fenêtre : on comble le trou avec la traînée
  function exitTo(x, y) {
    if (seeded && inside) {
      var gapX = x - ballX;
      var gapY = y - ballY;
      var gap = Math.hypot(gapX, gapY);
      if (gap > 1) {
        var steps = Math.min(32, Math.ceil(gap / 8));
        for (var i = 1; i <= steps; i++) {
          var t = i / steps;
          points.push({ x: ballX + gapX * t, y: ballY + gapY * t, age: 0 });
        }
      }
      ballX = x; ballY = y;
      targetX = x; targetY = y;
    }
    inside = false;
    hitDirty = false;
    hideNativeCursor(false);
  }

  /* --------------------------- Événements --------------------------- */
  function onMove(e) {
    var pt = localize(e.clientX, e.clientY);
    if (!pt.over) {
      if (inside) exitTo(pt.x, pt.y);
      return;
    }
    if (!seeded || !inside) seedAt(pt.x, pt.y);
    targetX = pt.x;
    targetY = pt.y;
    hitX = e.clientX;
    hitY = e.clientY;
    inside = true;
    hitDirty = true;
    hideNativeCursor(true);
  }

  function onWindowLeave() {
    if (inside) exitTo(targetX, targetY);
  }

  window.addEventListener("pointermove", onMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onWindowLeave);
  window.addEventListener("resize", resize);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(host);
  }

  /* ------------------------ Boucle d'animation ------------------------ */
  var last = performance.now();

  function frame(now) {
    var dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;

    ctx.clearRect(0, 0, w, h);

    if (!seeded) {
      requestAnimationFrame(frame);
      return;
    }

    // Le point rattrape doucement la souris
    var followEase = 1 - Math.exp(-dt / FOLLOW_TAU);
    ballX += (targetX - ballX) * followEase;
    ballY += (targetY - ballY) * followEase;

    // Quel élément est sous la souris ?
    if (hitDirty) {
      var el = document.elementFromPoint(hitX, hitY);
      overHide = !!(el && el.closest(HIDE_SELECTOR));
      linkEl = el ? el.closest(LINK_SELECTOR) : null;
      overRing = !!(el && el.closest(RING_SELECTOR));
      hitDirty = false;
    }

    if (overHide) {
      points = [];
      requestAnimationFrame(frame);
      return;
    }

    var isLink = !!linkEl;
    var trailMs = CONFIG.trailLength * 40;

    /* ---- Traînée ---- */
    if (!isLink) {
      if (inside) points.push({ x: ballX, y: ballY, age: 0 });
      for (var k = 0; k < points.length; k++) points[k].age += dt * 1000;
      points = points.filter(function (pt) { return pt.age < trailMs; });

      var n = points.length;
      if (n > 1) {
        var maxHalf = Math.max(0.5, ((CONFIG.trailThickness / 20) * CONFIG.size) / 2);
        var lx = [], ly = [], rx = [], ry = [];
        var nx = 0, ny = 0;

        for (var i = 0; i < n; i++) {
          var prev = points[Math.max(0, i - 1)];
          var next = points[Math.min(n - 1, i + 1)];
          var dx = next.x - prev.x;
          var dy = next.y - prev.y;
          var len = Math.hypot(dx, dy);
          if (len > 0.0001) {
            nx = -dy / len;
            ny = dx / len;
          }
          var t = Math.max(0, Math.min(1, 1 - points[i].age / trailMs));
          var half = maxHalf * t;
          lx.push(points[i].x + nx * half);
          ly.push(points[i].y + ny * half);
          rx.push(points[i].x - nx * half);
          ry.push(points[i].y - ny * half);
        }

        ctx.beginPath();
        ctx.moveTo(lx[0], ly[0]);
        for (var a = 1; a < n; a++) ctx.lineTo(lx[a], ly[a]);
        for (var b = n - 1; b >= 0; b--) ctx.lineTo(rx[b], ry[b]);
        ctx.closePath();
        ctx.fillStyle = CONFIG.trailColor;
        ctx.fill();
      }
    } else {
      points = [];
    }

    /* ---- Mode "lien" : le point s'accroche sous l'élément ---- */
    var link = null;
    if (linkEl) {
      var r = linkEl.getBoundingClientRect();
      var topLeft = localize(r.left, r.top);
      var bottomRight = localize(r.right, r.bottom);
      link = {
        left: topLeft.x,
        width: bottomRight.x - topLeft.x,
        bottom: bottomRight.y
      };
      ballX = link.left + link.width / 2;
      ballY = link.bottom;
      lineTargetWidth = link.width;
    } else {
      lineTargetWidth = 0;
    }

    /* ---- Animations douces (rayon, opacités, soulignement) ---- */
    var ease = 1 - Math.exp(-dt * (SNAPPINESS * 1.5));
    var targetRadius = (overRing || isLink) ? (CONFIG.size * HOVER_SCALE) / 2 : CONFIG.size / 2;
    radius += (targetRadius - radius) * ease;
    fillOpacity += (((overRing || isLink) ? 0 : 1) - fillOpacity) * ease;
    strokeOpacity += (((overRing && !isLink) ? 1 : 0) - strokeOpacity) * ease;
    lineOpacity += ((isLink ? 1 : 0) - lineOpacity) * ease;
    lineWidth += (lineTargetWidth - lineWidth) * ease;

    if (!inside) {
      requestAnimationFrame(frame);
      return;
    }

    /* ---- Dessin de la tête ---- */
    if (isLink && link && lineOpacity > 0.01) {
      var y = link.bottom + 1;
      var startX = link.left + (link.width - lineWidth) / 2;
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(startX + lineWidth, y);
      ctx.strokeStyle = withAlpha(CONFIG.headColor, lineOpacity);
      ctx.lineWidth = BORDER_WIDTH;
      ctx.lineCap = "round";
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(ballX, ballY, Math.max(0.5, radius), 0, Math.PI * 2);
      if (strokeOpacity > 0.01) {
        ctx.strokeStyle = withAlpha(CONFIG.headColor, strokeOpacity);
        ctx.lineWidth = BORDER_WIDTH;
        ctx.stroke();
      }
      if (fillOpacity > 0.01) {
        ctx.fillStyle = withAlpha(CONFIG.headColor, fillOpacity);
        ctx.fill();
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
