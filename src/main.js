/**
 * main.js
 * --------
 * Entry point. Boots the Game once the DOM is ready and surfaces any fatal
 * init error to the player instead of failing silently.
 */
import { Game } from './game.js';

function boot() {
  const app = document.getElementById('app');
  try {
    // eslint-disable-next-line no-new
    window.__game = new Game(app);
  } catch (err) {
    console.error('Failed to start Weeping Angels:', err);
    const msg = document.createElement('div');
    msg.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#f38ba8;font-family:monospace;text-align:center;padding:24px;z-index:99;';
    msg.textContent =
      'Could not start the game (WebGL may be unavailable). Check the console.';
    app.appendChild(msg);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
